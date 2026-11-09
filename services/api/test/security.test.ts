import { createSimTee, demoBaseUrl, demoFetch, SIM_MODEL } from "@wardline/demo-provider";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { BODY_LIMITS } from "../src/security.js";
import { LOCAL_AUTH } from "./helpers.js";

const START = Date.parse("2026-11-09T12:00:00Z");
let nowMs = START;
const clock = () => BigInt(nowMs) * 1_000_000n;
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function setup(env: Record<string, string> = {}) {
  nowMs = START;
  const deps = bootstrap(":memory:", clock, {}, LOCAL_AUTH, {
    env: { WARDLINE_CHAIN_MODE: "sim", ...env },
    routes: { providers: [{ id: "simtee", baseUrl: demoBaseUrl("simtee"), payTo: "sim-provider.testnet" }], models: [{ id: SIM_MODEL, provider: "simtee", label: "Sim Echo", inputPerM: 0, outputPerM: 0, perCall: 500_000, defaultMaxTokens: 256 }] },
    fetch: demoFetch({ simtee: createSimTee() }),
    gateway: { signatureDelaysMs: [0], ratePerMinute: 100_000 },
  });
  const key = deps.ai.meter.createKey({ budgetId: "bgt_aurora", member: "alice.testnet", label: "t", models: null, createdBy: "t", now: new Date(START) }).key;
  return { app: createApp(deps), key };
}

describe("security headers", () => {
  it("every response says nosniff, no framing, no loading; HSTS only when served over HTTPS", async () => {
    const { app } = setup();
    const res = await app.request("/v1/mutual");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    const hsts = await setup({ WARDLINE_HSTS: "true" }).app.request("/v1/mutual");
    expect(hsts.headers.get("strict-transport-security")).toContain("max-age=31536000");
    // Public JSON stays readable cross-origin; cookies are never involved on these routes.
    expect((await app.request("/v1/mutual", { headers: { origin: "https://elsewhere.example" } })).headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("limits", () => {
  it("refuses bodies over 64 KB on public routes and over 1 MB on /v1/ai, before parsing", async () => {
    const { app, key } = setup();
    const big = "x".repeat(BODY_LIMITS.other + 10);
    const check = await app.request("/v1/check", json({ payee: big }));
    expect(check.status).toBe(413);
    expect(await check.json()).toMatchObject({ error: "PAYLOAD_TOO_LARGE" });
    const ai = await app.request("/v1/ai/chat/completions", { ...json({ model: SIM_MODEL, messages: [{ role: "user", content: "y".repeat(BODY_LIMITS.ai + 10) }] }), headers: { "content-type": "application/json", authorization: `Bearer ${key}` } });
    expect(ai.status).toBe(413);
  });

  it("rate limits public routes per IP, with Retry-After", async () => {
    const { app } = setup();
    let last = 0;
    for (let i = 0; i < 13; i++) last = (await app.request("/v1/demo/invoice", { method: "POST" })).status;
    expect(last).toBe(429);
    const res = await app.request("/v1/demo/invoice", { method: "POST" });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ error: "RATE_LIMITED" });
    // Reads have their own, larger allowance.
    expect((await app.request("/v1/mutual")).status).toBe(200);
  });

  it("validates every path parameter and caps pagination", async () => {
    const { app } = setup();
    expect((await app.request("/v1/pool/positions/NOT%20OK")).status).toBe(400);
    expect((await app.request("/v1/reputation/..%2Fetc")).status).toBe(400);
    expect((await app.request("/v1/mutual/proposals/abc/weight/alice.testnet")).status).toBe(400);
    expect((await app.request("/v1/mutual/proposals/1/weight/Bad!")).status).toBe(400);
    expect((await app.request("/v1/mutual/proposals/-1/execute", { method: "POST" })).status).toBe(400);
    expect((await app.request("/v1/proofs?limit=500")).status).toBe(400);
    expect((await app.request("/v1/proofs?limit=50")).status).toBe(200);
    expect((await app.request("/v1/demo/nope", { method: "POST" })).status).toBe(404);
  });
});

describe("what public routes expose", () => {
  it("the latest-proofs feed has no members, keys or request content", async () => {
    const { app, key } = setup();
    await app.request("/v1/ai/chat/completions", { ...json({ model: SIM_MODEL, messages: [{ role: "user", content: "my secret prompt text" }] }), headers: { "content-type": "application/json", authorization: `Bearer ${key}` } });
    const body = (await (await app.request("/v1/proofs")).json()) as { proofs: Record<string, unknown>[] };
    // The real call comes first; in sim mode seeded rows follow it, with the same fields.
    expect(body.proofs[0]!.call_id).not.toMatch(/^call_sim_seed_/);
    for (const p of body.proofs) expect(Object.keys(p).sort()).toEqual(Object.keys(body.proofs[0]!).sort());
    expect(Object.keys(body.proofs[0]!).sort()).toEqual(["amount", "budget_id", "call_id", "created_at", "group", "model_claimed", "model_proven", "reason", "refund", "side", "status"]);
    const text = JSON.stringify(body);
    for (const leak of ["alice.testnet", "secret prompt", key, "wk_", "key_id", "request_hash", "signature"]) expect(text).not.toContain(leak);
  });

  it("the Mutual summary and groups name DAOs and counts, never members", async () => {
    const { app } = setup();
    for (const path of ["/v1/mutual", "/v1/groups"]) {
      const text = await (await app.request(path)).text();
      for (const member of ["alice.testnet", "bob.testnet", "ci-agent.testnet", "dana.testnet"]) expect(text).not.toContain(member);
    }
  });
});

describe("gateway request parsing, fuzzed", () => {
  const send = async (app: ReturnType<typeof setup>["app"], key: string, body: string) =>
    app.request("/v1/ai/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body });

  it("malformed JSON, non-objects, stream: true and unknown models are refused with the right status", async () => {
    const { app, key } = setup();
    expect((await send(app, key, "{not json")).status).toBe(400);
    expect((await send(app, key, "[1,2,3]")).status).toBe(400);
    expect((await send(app, key, "null")).status).toBe(400);
    expect((await send(app, key, '"a string"')).status).toBe(400);
    const stream = await send(app, key, JSON.stringify({ model: SIM_MODEL, stream: true, messages: [] }));
    expect(stream.status).toBe(400);
    expect(((await stream.json()) as { error: { code: string } }).error.code).toBe("STREAMING_NOT_SUPPORTED");
    expect((await send(app, key, JSON.stringify({ model: "evil/model", messages: [] }))).status).toBe(404);
    expect((await send(app, key, JSON.stringify({ model: { $ne: 1 }, messages: [] }))).status).toBe(404);
    expect((await send(app, "wk_not_a_key", JSON.stringify({ model: SIM_MODEL }))).status).toBe(401);
  });

  it("random bodies never cause a 500", async () => {
    const { app, key } = setup();
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pieces = ["{", "}", "[", "]", '"model"', ":", ",", '"stream"', "true", "null", "1e999", '"\\u0000"', `"${SIM_MODEL}"`, '"max_tokens"', "-1", '"messages"', "ÿ", "\\"];
    for (let i = 0; i < 120; i++) {
      const body = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => pieces[Math.floor(rand() * pieces.length)]).join("");
      const res = await send(app, key, body);
      expect(res.status, body).toBeLessThan(500);
    }
  });
});

describe("owner session cookie", () => {
  it("is Secure when the API is served over HTTPS behind a tunnel, not only on a public bind", async () => {
    const { ownerAuthFromEnv } = await import("../src/auth.js");
    expect(ownerAuthFromEnv({ WARDLINE_OWNER_ACCOUNTS: "o.testnet" }).secureCookie).toBe(false);
    expect(ownerAuthFromEnv({ WARDLINE_OWNER_ACCOUNTS: "o.testnet", WARDLINE_HSTS: "true" }).secureCookie).toBe(true);
    expect(ownerAuthFromEnv({ WARDLINE_OWNER_ACCOUNTS: "o.testnet", WARDLINE_SECURE_COOKIE: "true" }).secureCookie).toBe(true);
    expect(ownerAuthFromEnv({ WARDLINE_OWNER_ACCOUNTS: "o.testnet", WARDLINE_BIND_PUBLIC: "true" }).secureCookie).toBe(true);
  });
});

describe("max_tokens", () => {
  // Found in the A8 security pass: 1.5 or 1e999 reached BigInt() in reservationFor and answered 500.
  it("refuses anything but a whole number in range with 400, before reserving", async () => {
    const { app, key } = setup();
    for (const mt of ["1.5", "1e999", "0", "-5", "131073", '"256"', "true"]) {
      const res = await app.request("/v1/ai/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: `{"model":"${SIM_MODEL}","max_tokens":${mt},"messages":[{"role":"user","content":"x"}]}` });
      expect(res.status, `max_tokens ${mt}`).toBe(400);
      expect(await res.json(), `max_tokens ${mt}`).toMatchObject({ error: { type: "invalid_request_error", code: "INVALID_MAX_TOKENS", message: "max_tokens must be a whole number from 1 to 131072." } });
    }
    for (const mt of ["256", "null"]) {
      const res = await app.request("/v1/ai/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: `{"model":"${SIM_MODEL}","max_tokens":${mt},"messages":[{"role":"user","content":"x"}]}` });
      expect(res.status, `max_tokens ${mt}`).toBe(200);
    }
  });
});
