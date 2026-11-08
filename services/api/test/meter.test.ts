import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import {
  createCheapAi,
  createHangingProvider,
  createReplayProvider,
  createSimTee,
  demoBaseUrl,
  demoFetch,
  loadRecording,
  RECORDED,
  SIM_MODEL,
  type Handler,
} from "@wardline/demo-provider";
import { createWardline, sha256Hex, verifyProviderProof, WardlineAiError } from "@wardline/sdk";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { createChain, defaultSimSeed, GROUP_BUDGET, type SimChainSeed } from "../src/chain/index.js";
import type { RouteTable } from "../src/meter/models.js";
import { toDateClock, type Clock } from "../src/time.js";
import { LOCAL_AUTH } from "./helpers.js";

const NOW = BigInt(Date.UTC(2026, 10, 9, 12)) * 1_000_000n;
const clock: Clock = () => NOW;
const EXPENSIVE = loadRecording(RECORDED.expensive);
const CHEAP = loadRecording(RECORDED.cheap);
const GATEWAY_ONLY = loadRecording(RECORDED.gatewayOnly);

/** The exact body each recording was made with. Re-serializing it gives the recorded bytes. */
const bodyOf = (rec: typeof EXPENSIVE) => JSON.parse(Buffer.from(rec.requestBytes).toString("utf8")) as Record<string, unknown>;

interface Setup {
  /** Which demo provider serves the expensive model. */
  expensive?: string;
  seed?: SimChainSeed;
  handlers?: Record<string, Handler>;
  timeoutMs?: number;
}

function setup({ expensive = "replay", seed = defaultSimSeed(), handlers = {}, timeoutMs = 300 }: Setup = {}) {
  const hits: Record<string, number> = {};
  const counted = (name: string, h: Handler): Handler => async (req) => {
    if (req.method === "POST") hits[name] = (hits[name] ?? 0) + 1;
    return h(req);
  };
  const all: Record<string, Handler> = {
    replay: createReplayProvider(),
    cheapai: createCheapAi("wrong-model"),
    nosig: createCheapAi("no-signature"),
    tamper: createReplayProvider({ tamper: true }),
    slowsig: createReplayProvider({ signature404s: 2 }),
    simtee: createSimTee(),
    imposter: createSimTee(),
    hang: createHangingProvider(),
    ...handlers,
  };
  const providers = Object.keys(all).map((id) => ({ id, baseUrl: demoBaseUrl(id), payTo: `${id}.testnet` }));
  const routes: RouteTable = {
    providers,
    models: [
      { id: EXPENSIVE.model, provider: expensive, label: "DeepSeek", inputPerM: 300_000, outputPerM: 1_200_000, defaultMaxTokens: 1024 },
      { id: CHEAP.model, provider: "replay", label: "GLM Flash", inputPerM: 80_000, outputPerM: 500_000, defaultMaxTokens: 1024 },
      { id: GATEWAY_ONLY.model, provider: "replay", label: "GLM", inputPerM: 1_800_000, outputPerM: 5_750_000, defaultMaxTokens: 1024 },
      { id: SIM_MODEL, provider: "simtee", label: "Sim", inputPerM: 0, outputPerM: 0, perCall: 2_000, defaultMaxTokens: 256 },
    ],
  };
  const fetchImpl = demoFetch(Object.fromEntries(Object.entries(all).map(([k, h]) => [k, counted(k, h)])));
  const deps = bootstrap(":memory:", clock, {}, LOCAL_AUTH, {
    chain: createChain("sim", toDateClock(clock), seed),
    routes,
    fetch: fetchImpl,
    gateway: { signatureDelaysMs: [0, 0, 0], upstreamTimeoutMs: timeoutMs },
    env: { WARDLINE_CHAIN_MODE: "sim" },
  });
  const app = createApp(deps);
  const keyFor = (member = "alice.testnet", models: string[] | null = null) =>
    deps.ai.meter.createKey({ budgetId: GROUP_BUDGET, member, label: "test", models, createdBy: "owner.testnet", now: new Date() }).key;
  const chat = (key: string, body: Record<string, unknown>) =>
    app.request("/v1/ai/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { app, deps, keyFor, chat, hits };
}

const budget = async (deps: ReturnType<typeof setup>["deps"]) => (await deps.ai.chain.meter.getBudget(GROUP_BUDGET))!;

describe("meter gateway, recorded NEAR AI proofs", () => {
  it("pays a verified call: exact bytes back, proof headers, one settlement, coverage fee to the pool", async () => {
    const { chat, keyFor, deps } = setup();
    const feesBefore = BigInt((await deps.ai.chain.pool.getPool()).fees_earned);
    const res = await chat(keyFor(), bodyOf(EXPENSIVE));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(EXPENSIVE.responseBytes);
    expect(res.headers.get("x-wardline-proof")).toBe("verified");
    expect(res.headers.get("x-wardline-model-proven")).toBe(EXPENSIVE.model);
    expect(res.headers.get("x-wardline-settlement")).toMatch(/^sim-settle-/);
    const call = deps.ai.meter.getCall(res.headers.get("x-wardline-call")!)!;
    expect(call).toMatchObject({ status: "verified", modelClaimed: EXPENSIVE.model, modelProven: EXPENSIVE.model, requestHash: EXPENSIVE.requestHash, responseHash: EXPENSIVE.responseHash, chatId: EXPENSIVE.chatId });
    expect(BigInt(call.amount)).toBeGreaterThan(0n);
    expect(BigInt(call.amount) + BigInt(call.refund)).toBe(BigInt(call.reserved));
    const b = await budget(deps);
    expect(b.spent).toBe(call.amount);
    expect(b.reserved).toBe("0");
    expect(BigInt((await deps.ai.chain.pool.getPool()).fees_earned)).toBeGreaterThan(feesBefore);
  });

  it("refuses and refunds a swapped model: cheapai passes off the cheap model's real signature", async () => {
    const { chat, keyFor, deps } = setup({ expensive: "cheapai" });
    const res = await chat(keyFor(), bodyOf(EXPENSIVE));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("MODEL_MISMATCH");
    expect(body.error.message).toContain(`names ${CHEAP.model}, not ${EXPENSIVE.model}`);
    expect(body.error.message).toContain("You were not charged");
    expect(res.headers.get("x-wardline-proof")).toBe("refused");
    expect(res.headers.get("x-wardline-model-proven")).toBe(CHEAP.model);
    expect(res.headers.get("x-wardline-settlement")).toMatch(/^sim-release-/);
    const call = deps.ai.meter.getCall(res.headers.get("x-wardline-call")!)!;
    expect(call).toMatchObject({ status: "refused", reason: "MODEL_MISMATCH", amount: "0", refund: call.reserved, modelProven: CHEAP.model });
    expect(await budget(deps)).toMatchObject({ spent: "0", reserved: "0" });
  });

  it("refuses a response with no signature", async () => {
    const { chat, keyFor, deps } = setup({ expensive: "nosig" });
    const res = await chat(keyFor(), bodyOf(EXPENSIVE));
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SIGNATURE_MISSING");
    expect(await budget(deps)).toMatchObject({ spent: "0", reserved: "0" });
  });

  it("refuses a response changed after signing", async () => {
    const { chat, keyFor, deps } = setup({ expensive: "tamper" });
    const res = await chat(keyFor(), bodyOf(EXPENSIVE));
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RESPONSE_HASH_MISMATCH");
    expect((await budget(deps)).spent).toBe("0");
  });

  it("refuses to pay twice for the same signed response", async () => {
    const { chat, keyFor, deps } = setup();
    const key = keyFor();
    const first = await chat(key, bodyOf(EXPENSIVE));
    expect(first.status).toBe(200);
    const second = await chat(key, bodyOf(EXPENSIVE));
    expect(second.status).toBe(502);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("REPLAYED");
    const paid = deps.ai.meter.getCall(first.headers.get("x-wardline-call")!)!.amount;
    expect((await budget(deps)).spent).toBe(paid);
  });

  it("refuses a gateway-only signature, which no model TEE made", async () => {
    const { chat, keyFor } = setup();
    const res = await chat(keyFor(), bodyOf(GATEWAY_ONLY));
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BAD_SIGNATURE_KIND");
  });

  it("retries the signature endpoint while it answers 404", async () => {
    const { chat, keyFor } = setup({ expensive: "slowsig" });
    const res = await chat(keyFor(), bodyOf(EXPENSIVE));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-wardline-proof")).toBe("verified");
  });

  it("lets anyone re-check a call later from what GET /v1/ai/calls/:id returns", async () => {
    const { app, chat, keyFor, deps } = setup();
    const key = keyFor();
    const res = await chat(key, bodyOf(EXPENSIVE));
    const call = (await (await app.request(`/v1/ai/calls/${res.headers.get("x-wardline-call")}`, { headers: { authorization: `Bearer ${key}` } })).json()) as { proof: { text: string; signature: string; signing_address: string; signing_algo: string }; model_claimed: string; request_hash: string; response_hash: string };
    expect(call.response_hash).toBe(sha256Hex(EXPENSIVE.responseBytes));
    const check = await verifyProviderProof({ model: call.model_claimed, requestHash: call.request_hash, responseHash: call.response_hash, signature: call.proof, isAttested: (m, s) => deps.ai.chain.registry.isAttested(m, s) });
    expect(check.ok).toBe(true);
  });
});

describe("meter gateway, limits and failures", () => {
  it("stops at the member allowance with 402 and sends nothing upstream", async () => {
    const { chat, keyFor, deps, hits } = setup();
    await deps.ai.chain.meter.setAllowance(GROUP_BUDGET, "bob.testnet", "5000");
    const key = keyFor("bob.testnet");
    const body = { model: SIM_MODEL, messages: [{ role: "user", content: "hello" }] };
    expect((await chat(key, body)).status).toBe(200);
    expect((await chat(key, { ...body, messages: [{ role: "user", content: "again" }] })).status).toBe(200);
    const refused = await chat(key, { ...body, messages: [{ role: "user", content: "third" }] });
    expect(refused.status).toBe(402);
    const err = ((await refused.json()) as { error: { type: string; code: string; message: string } }).error;
    expect(err).toMatchObject({ type: "spend_limit_reached", code: "ALLOWANCE_EXHAUSTED" });
    expect(err.message).toMatch(/^Spend limit reached/);
    expect(hits.simtee).toBe(2);
    expect((await budget(deps)).members.find((m) => m.member === "bob.testnet")!.used).toBe("4000");
  });

  it("stops at the budget's deposit, the hard cap, across members", async () => {
    const seed = defaultSimSeed();
    seed.budgets = [{ budget_id: GROUP_BUDGET, name: "Tiny", owner: "dao.testnet", deposit: "5000", period: "week", members: [{ member: "alice.testnet", allowance: "4000" }, { member: "bob.testnet", allowance: "4000" }] }];
    const { chat, keyFor, deps } = setup({ seed });
    const msg = (n: number) => ({ model: SIM_MODEL, messages: [{ role: "user", content: `m${n}` }] });
    const alice = keyFor("alice.testnet");
    const bob = keyFor("bob.testnet");
    expect((await chat(alice, msg(1))).status).toBe(200);
    expect((await chat(alice, msg(2))).status).toBe(200);
    const res = await chat(bob, msg(3));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BUDGET_EXHAUSTED");
    expect((await budget(deps)).spent).toBe("4000");
  });

  it("releases the reservation when the provider times out", async () => {
    const { chat, keyFor, deps } = setup({ expensive: "hang", timeoutMs: 50 });
    const res = await chat(keyFor(), bodyOf(EXPENSIVE));
    expect(res.status).toBe(504);
    const call = deps.ai.meter.getCall(res.headers.get("x-wardline-call")!)!;
    expect(call).toMatchObject({ status: "failed", reason: "UPSTREAM_TIMEOUT", amount: "0" });
    expect(call.refund).toBe(call.reserved);
    expect(await budget(deps)).toMatchObject({ spent: "0", reserved: "0" });
  });

  it("refuses a signer the registry does not attest for that model", async () => {
    const { chat, keyFor } = setup({ expensive: "imposter" });
    const res = await chat(keyFor(), { model: EXPENSIVE.model, messages: [{ role: "user", content: "hi" }] });
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SIGNER_NOT_ATTESTED");
  });

  it("checks keys, scopes, streaming and unknown models before reserving anything", async () => {
    const { app, chat, keyFor, deps } = setup();
    expect((await chat("wk_nope", bodyOf(EXPENSIVE))).status).toBe(401);
    const key = keyFor();
    const id = deps.ai.meter.listKeys()[0]!.id;
    expect((await chat(key, { ...bodyOf(EXPENSIVE), stream: true })).status).toBe(400);
    expect((await chat(key, { model: "nope/model", messages: [] })).status).toBe(404);
    expect((await chat(keyFor("alice.testnet", [SIM_MODEL]), bodyOf(EXPENSIVE))).status).toBe(403);
    const models = (await (await app.request("/v1/ai/models", { headers: { authorization: `Bearer ${key}` } })).json()) as { data: { id: string }[] };
    expect(models.data.map((m) => m.id)).toContain(EXPENSIVE.model);
    deps.ai.meter.revokeKey(id, new Date());
    expect((await chat(key, bodyOf(EXPENSIVE))).status).toBe(401);
    expect((await budget(deps)).reserved).toBe("0");
  });

  it("rate-limits per key", async () => {
    const { chat, keyFor, deps } = setup();
    const key = keyFor();
    deps.ai.gateway = undefined;
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) statuses.push((await chat(key, { model: "nope/model", messages: [] })).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("works unchanged with the official OpenAI client: one base URL change", async () => {
    const { app, keyFor } = setup();
    const client = new OpenAI({ baseURL: "http://wardline.test/v1/ai", apiKey: keyFor(), fetch: ((url: string, init: RequestInit) => app.request(url, init)) as unknown as typeof fetch });
    const { data, response } = await client.chat.completions.create(bodyOf(EXPENSIVE) as never).withResponse();
    expect((data as { choices: { message: { content: string } }[] }).choices[0]!.message.content.length).toBeGreaterThan(0);
    expect(response.headers.get("x-wardline-proof")).toBe("verified");
    const models = await client.models.list();
    expect(models.data.map((m) => m.id)).toContain(SIM_MODEL);
  });

  it("surfaces spend limits to the OpenAI client as a 402 with a readable message", async () => {
    const { app, keyFor, deps } = setup();
    await deps.ai.chain.meter.setAllowance(GROUP_BUDGET, "alice.testnet", "1");
    const client = new OpenAI({ baseURL: "http://wardline.test/v1/ai", apiKey: keyFor(), maxRetries: 0, fetch: ((url: string, init: RequestInit) => app.request(url, init)) as unknown as typeof fetch });
    await expect(client.chat.completions.create({ model: SIM_MODEL, messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ status: 402, message: expect.stringContaining("Spend limit reached") });
  });
});

describe("SDK against the gateway", () => {
  const sdk = (app: ReturnType<typeof setup>["app"], meterKey: string) =>
    createWardline({ mode: "hosted", baseUrl: "http://wardline.test", meterKey, fetch: ((url: string, init?: RequestInit) => app.request(String(url), init)) as unknown as typeof fetch });

  it("openai(OpenAI) returns a configured official client, and getCall plus verifyProof re-check the proof", async () => {
    const { app, keyFor } = setup();
    const wardline = sdk(app, keyFor());
    const client = wardline.openai(OpenAI);
    const { response } = await client.chat.completions.create(bodyOf(EXPENSIVE) as never).withResponse();
    const call = await wardline.getCall(response.headers.get("x-wardline-call")!);
    expect(call).toMatchObject({ status: "verified", model_proven: EXPENSIVE.model });
    expect(await wardline.verifyProof(call, { responseBytes: EXPENSIVE.responseBytes })).toMatchObject({ ok: true, modelProven: EXPENSIVE.model });
    expect(await wardline.verifyProof(call, { responseBytes: new TextEncoder().encode("not it") })).toMatchObject({ ok: false, problem: "RESPONSE_HASH_MISMATCH" });
    expect(await wardline.getAiSpend(GROUP_BUDGET)).toMatchObject({ spend: { verifiedCalls: 1 } });
  });

  it("the built-in client returns proof headers, and throws a typed error on a refused proof", async () => {
    const { app, keyFor } = setup({ expensive: "cheapai" });
    const ai = sdk(app, keyFor()).openai();
    const err = await ai.chat.completions.create(bodyOf(EXPENSIVE)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WardlineAiError);
    expect(err).toMatchObject({ status: 502, code: "MODEL_MISMATCH", wardline: { proof: "refused", modelProven: CHEAP.model } });
    const ok = await ai.chat.completions.create({ model: SIM_MODEL, messages: [{ role: "user", content: "hi" }] });
    expect(ok.wardline).toMatchObject({ proof: "verified", modelProven: SIM_MODEL });
  });
});

