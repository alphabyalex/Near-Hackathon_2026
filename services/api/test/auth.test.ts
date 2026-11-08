import { ed25519 } from "@noble/curves/ed25519.js";
import { canonicalJson } from "@redline/agent";
import { PayeeCheckResult, PayeeResolveResult } from "@redline/schemas";
import { createRedline, seedEvmAddress } from "@redline/sdk";
import { base58 } from "@scure/base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createApiKey, OWNER_LOGIN_RECIPIENT, PAYMENT_RECORD_RECIPIENT, paymentRecordMessage, sha256Hex } from "../src/auth.js";
import { bootstrap } from "../src/bootstrap.js";
import { createOwnerApp } from "../src/owner-app.js";
import { NEP413_RECIPIENT, signNep413, type NearKeyLookup } from "../src/payee/proofs.js";
import { serverConfigFromEnv } from "../src/server-config.js";
import { authWith, LOCAL_AUTH } from "./helpers.js";

const DOMAIN = "northwind.example";
const START = Date.parse("2026-11-08T12:00:00Z");

interface Signer {
  account: string;
  secret: Uint8Array;
  publicKey: string;
}
const signer = (account: string): Signer => {
  const secret = ed25519.utils.randomSecretKey();
  return { account, secret, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
};

const owner = signer("owner-a.testnet");
const approver = signer("approver-a.testnet");
const outsider = signer("outsider.testnet");
const payerA = signer("acme.testnet");
const payerB = signer("globex.testnet");
const limitedKeys = new Set<string>();

const lookupKeys: NearKeyLookup = async (_network, accountId) =>
  [owner, approver, outsider, payerA, payerB]
    .filter((s) => s.account === accountId)
    .map((s) => ({ publicKey: s.publicKey, fullAccess: !limitedKeys.has(s.account) }));

let now = START;
const clock = () => BigInt(now) * 1_000_000n;

function setup(auth = authWith({ owners: new Set([owner.account]), approvers: new Set([approver.account]) })) {
  const deps = bootstrap(":memory:", clock, { lookupKeys }, auth);
  return { deps, app: createApp(deps) };
}

type App = ReturnType<typeof createApp>;

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function challenge(app: App, account: string) {
  return (await (await app.request("/owner/auth/challenge", json({ account }))).json()) as { message: string; nonce: string; recipient: string; expiresAt: string };
}

async function login(app: App, who: Signer, options: { as?: string; recipient?: string } = {}) {
  const account = options.as ?? who.account;
  const ch = await challenge(app, account);
  const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), who.secret, options.recipient ?? ch.recipient);
  return app.request("/owner/auth/login", json({ account, publicKey: who.publicKey, signature, nonce: ch.nonce }));
}

async function token(app: App, who: Signer): Promise<string> {
  const res = await login(app, who);
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

beforeEach(() => {
  now = START;
  limitedKeys.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("owner sign-in", () => {
  it("signs in an owner with a NEP-413 challenge and sets an HttpOnly, SameSite=Strict cookie", async () => {
    const { app } = setup();
    const ch = await challenge(app, owner.account);
    expect(ch.recipient).toBe(OWNER_LOGIN_RECIPIENT);
    expect(Date.parse(ch.expiresAt) - START).toBe(5 * 60_000);
    const res = await login(app, owner);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; role: string; account: string };
    expect(body).toMatchObject({ role: "owner", account: owner.account });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/redline_session=rs_/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect((await app.request("/owner/invoices", { headers: bearer(body.token) })).status).toBe(200);
    expect((await app.request("/owner/invoices", { headers: { cookie: `redline_session=${body.token}` } })).status).toBe(200);
    expect(await (await app.request("/owner/auth/session", { headers: bearer(body.token) })).json()).toEqual({ account: owner.account, role: "owner" });
  });

  it("refuses a replayed challenge", async () => {
    const { app } = setup();
    const ch = await challenge(app, owner.account);
    const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), owner.secret, ch.recipient);
    const attempt = () => app.request("/owner/auth/login", json({ account: owner.account, publicKey: owner.publicKey, signature, nonce: ch.nonce }));
    expect((await attempt()).status).toBe(200);
    expect((await attempt()).status).toBe(401);
  });

  it("refuses an expired challenge", async () => {
    const { app } = setup();
    const ch = await challenge(app, owner.account);
    const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), owner.secret, ch.recipient);
    now = START + 5 * 60_000 + 1;
    expect((await app.request("/owner/auth/login", json({ account: owner.account, publicKey: owner.publicKey, signature, nonce: ch.nonce }))).status).toBe(401);
  });

  it("spends a challenge on a failed attempt, so it cannot be retried", async () => {
    const { app } = setup();
    const ch = await challenge(app, owner.account);
    const nonce = Buffer.from(ch.nonce, "base64");
    const bad = signNep413("something else", nonce, owner.secret, ch.recipient);
    expect((await app.request("/owner/auth/login", json({ account: owner.account, publicKey: owner.publicKey, signature: bad, nonce: ch.nonce }))).status).toBe(401);
    const good = signNep413(ch.message, nonce, owner.secret, ch.recipient);
    expect((await app.request("/owner/auth/login", json({ account: owner.account, publicKey: owner.publicKey, signature: good, nonce: ch.nonce }))).status).toBe(401);
  });

  it.each<[string, () => Promise<Response>]>([
    ["an account that is not listed", () => login(setup().app, outsider)],
    ["a signature for another recipient", () => login(setup().app, owner, { recipient: NEP413_RECIPIENT })],
    [
      "a challenge issued to another account",
      async () => {
        const { app } = setup();
        const ch = await challenge(app, outsider.account);
        const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), owner.secret, ch.recipient);
        return app.request("/owner/auth/login", json({ account: owner.account, publicKey: owner.publicKey, signature, nonce: ch.nonce }));
      },
    ],
    ["a key that is not on the account", () => login(setup().app, outsider, { as: owner.account })],
    [
      "a function-call key",
      () => {
        limitedKeys.add(owner.account);
        return login(setup().app, owner);
      },
    ],
    [
      "an unknown nonce",
      () => setup().app.request("/owner/auth/login", json({ account: owner.account, publicKey: owner.publicKey, signature: "AAAA", nonce: Buffer.alloc(32).toString("base64") })),
    ],
  ])("refuses %s", async (_name, attempt) => {
    expect((await attempt()).status).toBe(401);
  });

  it("ends the session on logout and after it expires", async () => {
    const { app } = setup();
    const t = await token(app, owner);
    expect((await app.request("/owner/auth/logout", { method: "POST", headers: bearer(t) })).status).toBe(200);
    expect((await app.request("/owner/invoices", { headers: bearer(t) })).status).toBe(401);

    const t2 = await token(app, owner);
    now = START + 30 * 60_000 + 1;
    expect((await app.request("/owner/invoices", { headers: bearer(t2) })).status).toBe(401);
  });

  it("keeps only the hash of a session token", async () => {
    const { app, deps } = setup();
    const t = await token(app, owner);
    expect(deps.store.getSession(sha256Hex(t), now)).not.toBeNull();
    expect(deps.store.getSession(t, now)).toBeNull();
  });
});

describe("owner routes", () => {
  const ROUTES: [string, string][] = [
    ["GET", "/owner/invoices"],
    ["GET", "/owner/invoices/int_1001"],
    ["GET", "/owner/review-queue"],
    ["GET", "/owner/history"],
    ["GET", "/owner/agent/simulation"],
    ["POST", "/owner/intake"],
    ["POST", "/owner/review/rev_1002/owner-pay"],
    ["POST", "/owner/review/rev_1002/reject"],
    ["POST", "/owner/vault/pause"],
    ["POST", "/owner/vault/unpause"],
    ["POST", "/owner/agent/simulation"],
    ["GET", "/owner/api-keys"],
    ["POST", "/owner/api-keys"],
    ["POST", "/owner/api-keys/key_1/revoke"],
    ["POST", "/owner/payees/approve"],
    ["GET", "/owner/auth/session"],
  ];

  it.each(ROUTES)("%s %s needs a session", async (method, path) => {
    const { app, deps } = setup();
    const before = deps.world.vaults.get("vault-a.redline.testnet")?.balance_atomic;
    const body = { source_text: "Invoice INV-1003 from Fernhill. Total 800.00 REDL.", payer: "acme.testnet", account: "northwind.testnet", compromised: true };
    const res = await app.request(path, method === "POST" ? json(body) : {});
    expect(res.status).toBe(401);
    expect(deps.world.vaults.get("vault-a.redline.testnet")?.balance_atomic).toBe(before);
  });

  it("removes the old unprefixed owner paths from the public app", async () => {
    const { app } = setup();
    for (const path of ["/intake", "/review/rev_1002/owner-pay", "/vault/pause", "/agent/simulation"]) {
      expect((await app.request(path, json({}))).status).toBe(404);
    }
  });

  it("lets an approver pause but not unpause, simulate or manage keys", async () => {
    const { app } = setup();
    const t = await token(app, approver);
    expect((await app.request("/owner/vault/pause", json({}, bearer(t)))).status).toBe(200);
    expect((await app.request("/owner/vault/unpause", json({}, bearer(t)))).status).toBe(403);
    expect((await app.request("/owner/api-keys", json({ payer: "acme.testnet" }, bearer(t)))).status).toBe(403);
    expect((await app.request("/owner/agent/simulation", json({ compromised: true }, bearer(t)))).status).toBe(403);
    const ownerToken = await token(app, owner);
    expect((await app.request("/owner/vault/unpause", json({}, bearer(ownerToken)))).status).toBe(200);
  });

  it("serves the owner app on its own, and the public app without /owner", async () => {
    const { deps } = setup();
    const publicOnly = createApp(deps, { mountOwner: false });
    expect((await publicOnly.request("/owner/auth/challenge", json({ account: owner.account }))).status).toBe(404);
    expect((await publicOnly.request("/v1/vendors")).status).toBe(200);
    const ownerOnly = createOwnerApp(deps);
    expect((await ownerOnly.request("/invoices")).status).toBe(401);
    expect((await ownerOnly.request("/v1/vendors")).status).toBe(401);
  });

  it("acts as a local owner when auth is off", async () => {
    const app = createApp(bootstrap(":memory:", clock, {}, LOCAL_AUTH));
    expect((await app.request("/owner/invoices")).status).toBe(200);
  });
});

describe("API keys", () => {
  async function ownerKey(app: App, payer: string) {
    const t = await token(app, owner);
    const res = await app.request("/owner/api-keys", json({ payer, scopes: ["check", "record"] }, bearer(t)));
    expect(res.status).toBe(201);
    return { t, ...((await res.json()) as { id: string; key: string }) };
  }

  it("an owner creates a key; only its hash is stored and the list never shows it", async () => {
    const { app, deps } = setup();
    const { key, t } = await ownerKey(app, payerA.account);
    expect(key).toMatch(/^rk_/);
    expect(deps.store.findApiKey(sha256Hex(key))?.payer).toBe(payerA.account);
    expect(deps.store.findApiKey(key)).toBeNull();
    expect(JSON.stringify(await (await app.request("/owner/api-keys", { headers: bearer(t) })).json())).not.toContain(key);
  });

  it("writes its own payer's history and nobody else's", async () => {
    const { app } = setup();
    const { key } = await ownerKey(app, payerA.account);
    const record = (payer: string) => app.request("/v1/payments/record", json({ payer, domain: DOMAIN, account: "northwind.testnet" }, bearer(key)));
    expect((await record(payerA.account)).status).toBe(201);
    expect((await record(payerB.account)).status).toBe(403);
  });

  it("defaults to a check-only key, which cannot record payments", async () => {
    const { app } = setup();
    const t = await token(app, owner);
    const created = (await (await app.request("/owner/api-keys", json({ payer: payerA.account }, bearer(t)))).json()) as { key: string; scopes: string[] };
    expect(created.scopes).toEqual(["check"]);
    const record = await app.request("/v1/payments/record", json({ payer: payerA.account, domain: DOMAIN, account: "northwind.testnet" }, bearer(created.key)));
    expect(record.status).toBe(403);
    expect(((await record.json()) as { error: string }).error).toBe("SCOPE_REQUIRED");
    const check = await app.request("/v1/check", json({ payee: "northwind.testnet", vendor: { domain: DOMAIN }, payer: payerA.account }, bearer(created.key)));
    expect(check.status).toBe(200);
  });

  it("refuses unknown and revoked keys", async () => {
    const { app } = setup();
    const { key, id, t } = await ownerKey(app, payerA.account);
    expect((await app.request("/v1/vendors", { headers: bearer("rk_unknownkey") })).status).toBe(401);
    expect((await app.request(`/owner/api-keys/${id}/revoke`, json({}, bearer(t)))).status).toBe(200);
    expect((await app.request("/v1/vendors", { headers: bearer(key) })).status).toBe(401);
  });

  it("has its own daily limit, and keyed calls do not use the IP free tier", async () => {
    const { deps } = setup();
    deps.payee.freeCallsPerDay = 1;
    const app = createApp(deps);
    const { key } = createApiKey(deps.store, { payer: payerA.account, label: null, callsPerDay: 2, scopes: ["check", "record"], createdBy: "test", createdAt: "now" });
    expect((await app.request("/v1/vendors", { headers: bearer(key) })).status).toBe(200);
    expect((await app.request("/v1/vendors", { headers: bearer(key) })).status).toBe(200);
    const limited = await app.request("/v1/vendors", { headers: bearer(key) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("86400");
    expect((await app.request("/v1/vendors")).status).toBe(200);
    expect((await app.request("/v1/vendors")).status).toBe(402);
  });
});

describe("payment records", () => {
  const body = { payer: payerA.account, domain: DOMAIN, account: "northwind.testnet" };
  const signedRecord = (who: Signer, signedBody: Record<string, unknown>, options: { timestamp?: string; sentNonce?: Buffer; sent?: Record<string, unknown> } = {}) => {
    const timestamp = options.timestamp ?? new Date(now).toISOString();
    const nonce = Buffer.from(ed25519.utils.randomSecretKey());
    const signature = signNep413(paymentRecordMessage(timestamp, canonicalJson(signedBody)), nonce, who.secret, PAYMENT_RECORD_RECIPIENT);
    return json(options.sent ?? signedBody, {
      "x-redline-public-key": who.publicKey,
      "x-redline-signature": signature,
      "x-redline-nonce": (options.sentNonce ?? nonce).toString("base64"),
      "x-redline-timestamp": timestamp,
    });
  };

  it("refuses an unauthenticated write", async () => {
    const { app } = setup();
    expect((await app.request("/v1/payments/record", json(body))).status).toBe(401);
  });

  it("accepts a write signed by the payer's own NEAR account", async () => {
    const { app } = setup();
    expect((await app.request("/v1/payments/record", signedRecord(payerA, body))).status).toBe(201);
  });

  it.each<[string, () => RequestInit]>([
    ["signed by another account", () => signedRecord(payerB, body)],
    ["for another payer than the signer", () => signedRecord(payerA, { ...body, payer: payerB.account })],
    ["with the body changed after signing", () => signedRecord(payerA, body, { sent: { ...body, account: "northw1nd.testnet" } })],
    ["with an old timestamp", () => signedRecord(payerA, body, { timestamp: new Date(now - 6 * 60_000).toISOString() })],
    ["with a short nonce", () => signedRecord(payerA, body, { sentNonce: Buffer.alloc(8) })],
  ])("refuses a write %s", async (_name, request) => {
    const { app } = setup();
    expect((await app.request("/v1/payments/record", request())).status).toBe(401);
  });

  it("refuses a replayed signature", async () => {
    const { app } = setup();
    const request = signedRecord(payerA, body);
    expect((await app.request("/v1/payments/record", request)).status).toBe(201);
    expect((await app.request("/v1/payments/record", request)).status).toBe(401);
  });

  it("cannot write another payer's history, with or without a key", async () => {
    const { app, deps } = setup();
    const { key } = createApiKey(deps.store, { payer: payerA.account, label: null, callsPerDay: 100, scopes: ["check", "record"], createdBy: "test", createdAt: "now" });
    const evil = `eip155:84532:0x${"ab".repeat(20)}`;
    const forged = { payer: payerB.account, domain: DOMAIN, account: evil };
    expect((await app.request("/v1/payments/record", json(forged))).status).toBe(401);
    expect((await app.request("/v1/payments/record", json(forged, bearer(key)))).status).toBe(403);
    expect(deps.store.lastPaidAccount(payerB.account, DOMAIN, "eip155:84532")).toBeNull();
  });
});

describe("payer-scoped checks and T3", () => {
  const evm = `eip155:84532:${seedEvmAddress(DOMAIN)}`;
  const keyFor = (deps: ReturnType<typeof setup>["deps"], payer: string) =>
    createApiKey(deps.store, { payer, label: null, callsPerDay: 100, scopes: ["check", "record"], createdBy: "test", createdAt: "now" }).key;

  it("needs the payer's key to pass a payer, so nobody reads another payer's relationships", async () => {
    const { app, deps } = setup();
    expect((await app.request("/v1/check", json({ payee: evm, vendor: { domain: DOMAIN }, payer: payerA.account }))).status).toBe(403);
    expect((await app.request("/v1/resolve", json({ domain: DOMAIN, chain: "eip155:84532", payer: payerA.account }))).status).toBe(403);
    const otherKey = keyFor(deps, payerB.account);
    expect((await app.request("/v1/check", json({ payee: evm, vendor: { domain: DOMAIN }, payer: payerA.account }, bearer(otherKey)))).status).toBe(403);
  });

  it("is T2 without a relationship, and T3 after a recorded payment", async () => {
    const { app, deps } = setup();
    const key = keyFor(deps, payerA.account);
    const check = async () =>
      PayeeCheckResult.parse(await (await app.request("/v1/check", json({ payee: evm, vendor: { domain: DOMAIN }, payer: payerA.account }, bearer(key)))).json());
    expect((await check()).evidenceTier).toBe("T2_DOMAIN_LINKED");
    await app.request("/v1/payments/record", json({ payer: payerA.account, domain: DOMAIN, account: evm }, bearer(key)));
    expect(await check()).toMatchObject({ verdict: "PAY", evidenceTier: "T3_RELATIONSHIP" });
  });

  it("is T3 after an owner approves the account, which must be active", async () => {
    const { app, deps } = setup();
    const ownerToken = await token(app, owner);
    const key = keyFor(deps, payerA.account);
    expect((await app.request("/owner/payees/approve", json({ payer: payerA.account, account: evm }, bearer(ownerToken)))).status).toBe(201);
    const resolved = PayeeResolveResult.parse(await (await app.request("/v1/resolve", json({ domain: DOMAIN, chain: "eip155:84532", payer: payerA.account }, bearer(key)))).json());
    expect(resolved.evidenceTier).toBe("T3_RELATIONSHIP");
    expect((await app.request("/owner/payees/approve", json({ payer: payerA.account, account: "nobody-known.testnet" }, bearer(ownerToken)))).status).toBe(409);
  });

  it("sends the hosted SDK's API key", async () => {
    const { app, deps } = setup();
    const key = keyFor(deps, payerA.account);
    const redline = createRedline({
      mode: "hosted",
      baseUrl: "http://api.local",
      apiKey: key,
      fetch: ((input: string | URL | Request, init?: RequestInit) => app.request(String(input), init)) as typeof fetch,
    });
    await redline.recordPayment({ payer: payerA.account, domain: DOMAIN, account: evm });
    expect((await redline.check({ payee: evm, vendor: { domain: DOMAIN }, payer: payerA.account })).evidenceTier).toBe("T3_RELATIONSHIP");
  });
});

describe("binding", () => {
  const auth = authWith({ owners: new Set([owner.account]) });

  it("binds to localhost by default and to all interfaces only with the flag", () => {
    expect(serverConfigFromEnv({}, auth)).toEqual({ port: 8787, host: "127.0.0.1", ownerPort: null, ownerHost: "127.0.0.1" });
    expect(serverConfigFromEnv({ REDLINE_BIND_PUBLIC: "true" }, auth).host).toBe("0.0.0.0");
    expect(serverConfigFromEnv({ REDLINE_BIND_PUBLIC: "true", REDLINE_OWNER_PORT: "8788" }, auth)).toMatchObject({ host: "0.0.0.0", ownerPort: 8788, ownerHost: "127.0.0.1" });
  });

  it("refuses public owner routes with auth off or nobody listed, and a clashing port", () => {
    expect(() => serverConfigFromEnv({ REDLINE_BIND_PUBLIC: "true" }, LOCAL_AUTH)).toThrow(/only allowed/);
    expect(() => serverConfigFromEnv({ REDLINE_OWNER_PORT: "8788", REDLINE_OWNER_BIND_PUBLIC: "true" }, authWith({}))).toThrow(/empty/);
    expect(() => serverConfigFromEnv({ REDLINE_OWNER_PORT: "8787" }, auth)).toThrow(/differ/);
    expect(serverConfigFromEnv({ REDLINE_BIND_PUBLIC: "true", REDLINE_OWNER_PORT: "8788" }, LOCAL_AUTH).ownerHost).toBe("127.0.0.1");
  });
});
