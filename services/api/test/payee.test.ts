import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PayeeCheckResult, PayeeResolveResult } from "@wardline/schemas";
import { createWardline, hashRequest, seedEvmAddress, verifyReceipt } from "@wardline/sdk";
import { base58 } from "@scure/base";
import { KeyPair, KeyPairSigner } from "near-api-js";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { createApiKey } from "../src/auth.js";
import { createAttestor, ensureAttestorKey, requestHash } from "../src/payee/attestor.js";
import { LOCAL_AUTH } from "./helpers.js";
import { buildProofFile, createNearKeyLookup, nep413Hash, type NearKeyLookup, type PayeeProofFile } from "../src/payee/proofs.js";
import { createPayeeRuntime, loadPayeeBackends, nearRegistry, type PayeeOverrides } from "../src/payee/runtime.js";
import { evidenceHash, MERCHANT_IDENTITY_PATH, PAYEE_FILE_PATH } from "../src/payee/verify-vendor.js";
import { isPublicAddress, type WellKnownFetcher } from "../src/payee/well-known.js";

const DOMAIN = "northwind.example";
const NOW_NS = BigInt(Date.parse("2026-11-07T12:00:00Z")) * 1_000_000n;
const ISSUED_AT = "2026-11-07T00:00:00Z";

function makeApp(overrides: PayeeOverrides = {}, clock: () => bigint = () => NOW_NS) {
  const deps = bootstrap(":memory:", clock, overrides);
  return { deps, app: createApp(deps) };
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, key?: string) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });

const keyFor = (deps: ReturnType<typeof makeApp>["deps"], payer: string): string =>
  createApiKey(deps.store, { payer, label: null, callsPerDay: 10_000, scopes: ["check", "record"], createdBy: "test", createdAt: "now" }).key;

const codes = (result: { reasons: { code: string }[] }) => result.reasons.map((r) => r.code);

describe("POST /v1/check and /v1/resolve", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    app = makeApp().app;
  });

  it("answers a schema-valid PAY with a receipt for a verified account", async () => {
    const res = await post(app, "/v1/check", { payee: "northwind.testnet", vendor: { domain: DOMAIN } });
    expect(res.status).toBe(200);
    const result = PayeeCheckResult.parse(await res.json());
    expect(result).toMatchObject({ verdict: "PAY", payee: "near:testnet:northwind.testnet" });
    expect(result.receipt?.id).toMatch(/^rcpt_/);
  });

  it("BLOCKs a look-alike and HOLDs an unknown account", async () => {
    const blocked = PayeeCheckResult.parse(await (await post(app, "/v1/check", { payee: "northw1nd.testnet", vendor: { domain: DOMAIN } })).json());
    expect(blocked.verdict).toBe("BLOCK");
    expect(codes(blocked)).toContain("LOOKALIKE_ACCOUNT");
    const held = PayeeCheckResult.parse(await (await post(app, "/v1/check", { payee: "nobody-known.testnet" })).json());
    expect(held.verdict).toBe("HOLD");
  });

  it("resolves a domain per chain and holds on an unverified chain", async () => {
    const res = await post(app, "/v1/resolve", { domain: DOMAIN, chain: "eip155:84532" });
    const result = PayeeResolveResult.parse(await res.json());
    expect(result).toMatchObject({ verdict: "PAY", account: `eip155:84532:${seedEvmAddress(DOMAIN)}` });
    const held = PayeeResolveResult.parse(await (await post(app, "/v1/resolve", { domain: DOMAIN, chain: "eip155:1" })).json());
    expect(held).toMatchObject({ verdict: "HOLD", account: null });
    expect(codes(held)).toEqual(["CHAIN_NOT_VERIFIED"]);
  });

  it.each([
    ["/v1/check", { payee: "eip155:1:0x123" }],
    ["/v1/check", { payee: "northwind.testnet", vendor: { domain: "https://northwind.example" } }],
    ["/v1/check", { nope: true }],
    ["/v1/resolve", { domain: DOMAIN, chain: "not a chain" }],
    ["/v1/resolve", { domain: "localhost", chain: "near:testnet" }],
  ])("answers 400 on bad input to %s", async (path, body) => {
    expect((await post(app, path, body)).status).toBe(400);
  });

  it("answers 400 on a body that is not JSON", async () => {
    const res = await app.request("/v1/check", { method: "POST", body: "{" });
    expect(res.status).toBe(400);
  });

  it("gives no verdict when the engine fails", async () => {
    const failing = makeApp({ engine: { check: () => Promise.reject(new Error("boom")), resolve: () => Promise.reject(new Error("boom")) } }).app;
    const res = await post(failing, "/v1/check", { payee: "northwind.testnet" });
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("verdict");
  });
});

describe("payment history", () => {
  it("raises PAYEE_CHANGED after a recorded payment to a different account, and persists through the store", async () => {
    const { app, deps } = makeApp();
    const payer = "acme.testnet";
    const key = keyFor(deps, payer);
    const account = `eip155:84532:0x${"ab".repeat(20)}`;
    const recorded = await post(app, "/v1/payments/record", { payer, domain: DOMAIN, account }, key);
    expect(recorded.status).toBe(201);
    const result = PayeeCheckResult.parse(
      await (await post(app, "/v1/check", { payee: `eip155:84532:${seedEvmAddress(DOMAIN)}`, vendor: { domain: DOMAIN }, payer }, key)).json(),
    );
    expect(result.verdict).toBe("HOLD");
    expect(codes(result)).toEqual(["VERIFIED_MATCH", "PAYEE_CHANGED"]);
  });

  it("stays PAY when the recorded account is the same one", async () => {
    const { app, deps } = makeApp();
    const key = keyFor(deps, "acme.testnet");
    await post(app, "/v1/payments/record", { payer: "acme.testnet", domain: DOMAIN, account: "northwind.testnet" }, key);
    const result = PayeeCheckResult.parse(await (await post(app, "/v1/check", { payee: "northwind.testnet", vendor: { domain: DOMAIN }, payer: "acme.testnet" }, key)).json());
    expect(result.verdict).toBe("PAY");
  });

  it("rejects a malformed record", async () => {
    const { app, deps } = makeApp();
    const key = keyFor(deps, "p");
    expect((await post(app, "/v1/payments/record", { payer: "p", domain: DOMAIN, account: "eip155:1:0x1" }, key)).status).toBe(400);
    expect((await post(app, "/v1/payments/record", { domain: DOMAIN }, key)).status).toBe(400);
  });
});

describe("vendors", () => {
  it("lists the 4 seeded vendors, each with three chains", async () => {
    const { app } = makeApp();
    const { vendors } = (await (await app.request("/v1/vendors")).json()) as { vendors: { domain: string; accounts: { account: string }[] }[] };
    expect(vendors).toHaveLength(4);
    for (const vendor of vendors) {
      expect(vendor.accounts.map((a) => a.account.split(":").slice(0, 2).join(":"))).toEqual(["near:testnet", "eip155:84532", "solana:devnet"]);
    }
  });

  it("gets one vendor, 404s an unknown one, 400s a bad domain", async () => {
    const { app } = makeApp();
    expect(await (await app.request(`/v1/vendors/${DOMAIN}`)).json()).toMatchObject({ domain: DOMAIN, name: "Northwind Trading" });
    expect((await app.request("/v1/vendors/not-listed.example")).status).toBe(404);
    expect((await app.request("/v1/vendors/localhost")).status).toBe(400);
  });
});

describe("free tier", () => {
  it("allows 200 calls per day, then answers an x402-style 402", async () => {
    const payTo = `0x${"cd".repeat(20)}`;
    const { app } = makeApp({ x402: { enabled: false, payTo, network: "eip155:84532", asset: "0xusdc" } });
    for (let i = 0; i < 200; i++) {
      const ok = await app.request("/v1/vendors");
      expect(ok.status).toBe(200);
    }
    const res = await post(app, "/v1/check", { payee: "northwind.testnet" });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { x402Version: number; accepts: Record<string, unknown>[]; error: string };
    expect(body).toMatchObject({ x402Version: 2, error: "FREE_TIER_EXCEEDED" });
    expect(body.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:84532", amount: "10000", payTo, extra: { name: "USDC" } });
    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(JSON.parse(Buffer.from(header ?? "", "base64").toString())).toEqual(body);
  });

  it("resets on the next day", async () => {
    let now = NOW_NS;
    const { app } = makeApp({ freeCallsPerDay: 1 }, () => now);
    expect((await app.request("/v1/vendors")).status).toBe(200);
    expect((await app.request("/v1/vendors")).status).toBe(402);
    now += 24n * 3_600_000_000_000n;
    expect((await app.request("/v1/vendors")).status).toBe(200);
  });

  it("cannot be dodged with a forged header unless a proxy is trusted", async () => {
    const { app } = makeApp({ freeCallsPerDay: 1 });
    const call = (ip: string) => app.request("/v1/vendors", { headers: { "x-forwarded-for": ip } });
    expect((await call("1.1.1.1")).status).toBe(200);
    expect((await call("2.2.2.2")).status).toBe(402);

    const proxied = makeApp({ freeCallsPerDay: 1, trustProxy: true }).app;
    const via = (ip: string) => proxied.request("/v1/vendors", { headers: { "x-forwarded-for": ip } });
    expect((await via("1.1.1.1")).status).toBe(200);
    expect((await via("1.1.1.1")).status).toBe(402);
    // The caller controls everything before the last entry, so changing it must not reset the count.
    expect((await via("9.9.9.9, 2.2.2.2")).status).toBe(200);
    expect((await via("8.8.8.8, 2.2.2.2")).status).toBe(402);
  });

  it("does not limit the owner routes or the attestor key", async () => {
    const app = createApp(bootstrap(":memory:", () => NOW_NS, { freeCallsPerDay: 0 }, LOCAL_AUTH));
    expect((await app.request("/owner/review-queue")).status).toBe(200);
    expect((await app.request("/.well-known/wardline-attestor.json")).status).toBe(200);
    expect((await app.request("/v1/vendors")).status).toBe(402);
  });
});

describe("timing", () => {
  it("answers registry-hit calls on the stub engine with p95 under 300 ms", async () => {
    const { app } = makeApp({ freeCallsPerDay: 10_000 });
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const started = performance.now();
      const res =
        i % 2 === 0
          ? await post(app, "/v1/check", { payee: "northwind.testnet", vendor: { domain: DOMAIN } })
          : await post(app, "/v1/resolve", { domain: DOMAIN, chain: "near:testnet" });
      samples.push(performance.now() - started);
      expect(res.status).toBe(200);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(300);
  });
});

describe("signed receipts", () => {
  it("verifies with the published key through the SDK, and the signature covers the verdict", async () => {
    const { app } = makeApp();
    const { public_key: publicKey, alg } = (await (await app.request("/.well-known/wardline-attestor.json")).json()) as { public_key: string; alg: string };
    expect(alg).toBe("ed25519");

    const request = { payee: "near:testnet:northwind.testnet", vendor: { domain: DOMAIN }, context: "Invoice 1001" };
    const check = PayeeCheckResult.parse(await (await post(app, "/v1/check", request)).json());
    expect(verifyReceipt(check, publicKey, { request })).toBe(true);
    expect(verifyReceipt({ ...check, verdict: "BLOCK" }, publicKey)).toBe(false);

    const resolveRequest = { domain: DOMAIN, chain: "near:testnet" };
    const resolve = PayeeResolveResult.parse(await (await post(app, "/v1/resolve", resolveRequest)).json());
    expect(verifyReceipt(resolve, publicKey, { request: resolveRequest })).toBe(true);
    expect(verifyReceipt({ ...resolve, account: "near:testnet:evil.testnet" }, publicKey)).toBe(false);
  });

  it("signs a HOLD too, including a vendor that is not in the registry", async () => {
    const { app } = makeApp();
    const { public_key: publicKey } = (await (await app.request("/.well-known/wardline-attestor.json")).json()) as { public_key: string };
    const result = PayeeCheckResult.parse(await (await post(app, "/v1/check", { payee: "nobody-known.testnet", vendor: { domain: "not-listed.example" } })).json());
    expect(result.vendor).toBeNull();
    expect(verifyReceipt(result, publicKey)).toBe(true);
  });

  it("hashes requests the same way in the API helper and the SDK", () => {
    const requests = [
      { payee: "a.testnet" },
      { payee: "a.testnet", context: "some invoice text", source: "x402" as const, vendor: { domain: DOMAIN, name: "N" } },
      { domain: DOMAIN, chain: "near:testnet", payer: "p" },
    ];
    for (const request of requests) expect(requestHash(request)).toBe(hashRequest(request));
  });

  it("does not store raw context in the hash input", () => {
    const a = requestHash({ payee: "a.testnet", context: "x" });
    expect(a).not.toBe(requestHash({ payee: "a.testnet", context: "y" }));
    expect(a).not.toBe(requestHash({ payee: "a.testnet" }));
  });

  it("never claims TEE signing", async () => {
    const { app } = makeApp();
    const text = await (await app.request("/.well-known/wardline-attestor.json")).text();
    expect(text.toLowerCase()).not.toContain("tee");
  });

  it("refuses a malformed key without echoing it", () => {
    expect(() => createAttestor("secret-looking-value")).toThrow(/32-byte/);
    try {
      createAttestor("secret-looking-value");
    } catch (error) {
      expect(String(error)).not.toContain("secret-looking-value");
    }
  });
});

describe("attestor key setup", () => {
  it("writes a missing dev key to the env file without logging it, then leaves it alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "wardline-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, "OTHER=1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env: NodeJS.ProcessEnv = {};
    ensureAttestorKey(env, file);
    const seed = env.WARDLINE_ATTESTOR_KEY ?? "";
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(file, "utf8")).toBe(`OTHER=1\nWARDLINE_ATTESTOR_KEY=${seed}\n`);
    expect(JSON.stringify(log.mock.calls)).not.toContain(seed);
    ensureAttestorKey(env, file);
    expect(readFileSync(file, "utf8").match(/WARDLINE_ATTESTOR_KEY/g)).toHaveLength(1);
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to generate a key in production", () => {
    const dir = mkdtempSync(join(tmpdir(), "wardline-env-"));
    const file = join(dir, ".env");
    expect(() => ensureAttestorKey({ NODE_ENV: "production" }, file)).toThrow(/required/);
    expect(existsSync(file)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("backend modes", () => {
  it("defaults to the stub and memory", async () => {
    await expect(loadPayeeBackends({})).resolves.toEqual({});
  });

  it("refuses to start in a mode it cannot meet, rather than falling back to the stub", async () => {
    await expect(loadPayeeBackends({ WARDLINE_PAYEE_ENGINE: "live" })).rejects.toThrow(/payee-check/);
    await expect(loadPayeeBackends({ WARDLINE_PAYEE_ENGINE: "other" })).rejects.toThrow(/Unknown/);
    await expect(loadPayeeBackends({ WARDLINE_REGISTRY_MODE: "other" })).rejects.toThrow(/Unknown/);
  });

  it("near registry mode reads the payee registry contract, with the SDK's tier names", async () => {
    const backends = await loadPayeeBackends({ WARDLINE_REGISTRY_MODE: "near" });
    expect(backends.registry).toBeDefined();
    const contract = { getVendor: async () => ({ domain: "northwind.example", accounts: [{ account: "near:testnet:northwind.testnet", evidenceTier: "T2" }] }), listVendors: async () => [], findByAccount: async () => null, attestVendor: async () => ({}) };
    const vendor = (await nearRegistry(contract as never).getVendor("northwind.example")) as unknown as { accounts: Array<{ evidenceTier: string }> };
    expect(vendor.accounts[0]!.evidenceTier).toBe("T2_DOMAIN_LINKED");
  });

  it("reads free tier and x402 settings from env", () => {
    const deps = bootstrap(":memory:", () => NOW_NS);
    const runtime = createPayeeRuntime(deps.store, () => NOW_NS, {}, { WARDLINE_FREE_CALLS_PER_DAY: "5", WARDLINE_X402_PAY_TO: "0xabc", WARDLINE_X402: "off" });
    expect(runtime.freeCallsPerDay).toBe(5);
    expect(runtime.x402).toMatchObject({ enabled: false, payTo: "0xabc", network: "eip155:84532" });
  });
});

describe("vendor verification", () => {
  const nearSecret = ed25519.utils.randomSecretKey();
  const nearPublic = `ed25519:${base58.encode(ed25519.getPublicKey(nearSecret))}`;
  const nearPrivate = `ed25519:${base58.encode(nearSecret)}`;
  const evmPrivate = `0x${"11".repeat(32)}` as const;
  const evmAddress = privateKeyToAccount(evmPrivate).address;
  const solanaSecret = ed25519.utils.randomSecretKey();
  const solanaAddress = base58.encode(ed25519.getPublicKey(solanaSecret));
  const domain = "newvendor.example";

  const near = `near:testnet:newvendor.testnet`;
  const evm = `eip155:84532:${evmAddress.toLowerCase()}`;
  const solana = `solana:devnet:${solanaAddress}`;

  const proofFile = (issuedAt = ISSUED_AT) =>
    buildProofFile({
      domain,
      name: "New Vendor",
      issuedAt,
      accounts: [
        { account: near, privateKey: nearPrivate },
        { account: evm, privateKey: evmPrivate },
        { account: solana, privateKey: base58.encode(solanaSecret) },
      ],
    });

  const lookupKeys: NearKeyLookup = async () => [{ publicKey: nearPublic, fullAccess: true }];

  const serving = (files: Record<string, unknown>): WellKnownFetcher => async (_domain, path) => {
    const file = files[path];
    if (file === undefined) return { status: 404, body: new Uint8Array() };
    return { status: 200, body: new TextEncoder().encode(typeof file === "string" ? file : JSON.stringify(file)) };
  };

  const verify = async (file: unknown, overrides: PayeeOverrides = {}) => {
    const made = makeApp({ fetchFile: serving({ [PAYEE_FILE_PATH]: file }), lookupKeys, ...overrides });
    const res = await post(made.app, "/v1/vendors/verify", { domain });
    return { ...made, res, body: (await res.json()) as Record<string, unknown> };
  };

  it("accepts all three proof types and the vendor becomes payable", async () => {
    const file = await proofFile();
    const { res, body, app } = await verify(file);
    expect(res.status).toBe(200);
    expect(body.verified).toBe(true);
    expect(body.evidenceHash).toBe(evidenceHash(new TextEncoder().encode(JSON.stringify(file)), null));
    for (const chain of ["near:testnet", "eip155:84532", "solana:devnet"]) {
      const result = PayeeResolveResult.parse(await (await post(app, "/v1/resolve", { domain, chain })).json());
      expect(result.verdict).toBe("PAY");
    }
    expect(PayeeCheckResult.parse(await (await post(app, "/v1/check", { payee: solana, vendor: { domain } })).json()).verdict).toBe("PAY");
  });

  it("uses the NEP-413 payload layout", async () => {
    // An independent signer: near-api-js signs a NEP-413 message, and our hash must verify it.
    const nonce = new Uint8Array(32).fill(7);
    const signer = new KeyPairSigner(KeyPair.fromString(nearPrivate as `ed25519:${string}`));
    const signed = await signer.signNep413Message("newvendor.testnet", { message: "hello", recipient: "wardline-payee-registry", nonce });
    expect(ed25519.verify(signed.signature, nep413Hash("hello", nonce), ed25519.getPublicKey(nearSecret))).toBe(true);
    expect(ed25519.verify(signed.signature, nep413Hash("other", nonce), ed25519.getPublicKey(nearSecret))).toBe(false);
  });

  type Mutate = (file: PayeeProofFile) => void;
  const entry = (file: PayeeProofFile, index: number) => {
    const found = file.accounts[index];
    if (!found) throw new Error("no such entry");
    return found;
  };
  const flip = (signature: string) => (signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`);

  it.each<[string, Mutate]>([
    ["a tampered NEAR signature", (f) => void (entry(f, 0).proof.signature = flip(entry(f, 0).proof.signature))],
    ["a tampered EVM signature", (f) => void (entry(f, 1).proof.signature = `0x${"00".repeat(65)}`)],
    ["a tampered Solana signature", (f) => void (entry(f, 2).proof.signature = flip(entry(f, 2).proof.signature))],
    ["a swapped payout account", (f) => void (entry(f, 1).account = `eip155:84532:0x${"99".repeat(20)}`)],
    ["a swapped Solana account", (f) => void (entry(f, 2).account = `solana:devnet:${base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))}`)],
    ["a changed issued_at", (f) => void (f.issued_at = "2026-11-06T00:00:00Z")],
    ["a NEAR proof with a different nonce", (f) => void (entry(f, 0).proof.nonce = Buffer.alloc(32, 9).toString("base64"))],
    ["a mismatched proof type", (f) => void (entry(f, 2).proof.type = "eip191")],
    ["a duplicated account", (f) => void f.accounts.push(entry(f, 1))],
  ])("rejects %s and attests nothing", async (_name, mutate) => {
    const file = await proofFile();
    mutate(file);
    const { res, body, app } = await verify(file);
    expect(res.status).toBe(422);
    expect(body.error).toBe("VERIFICATION_FAILED");
    expect((await app.request(`/v1/vendors/${domain}`)).status).toBe(404);
  });

  it("rejects a file naming another domain, a future or very old date, and a bad shape", async () => {
    expect((await verify({ ...(await proofFile()), domain: "other.example" })).res.status).toBe(422);
    expect((await verify(await proofFile("2026-11-08T00:00:00Z"))).res.status).toBe(422);
    expect((await verify(await proofFile("2025-01-01T00:00:00Z"))).res.status).toBe(422);
    expect((await verify({ version: 1 })).res.status).toBe(422);
    expect((await verify("not json {")).res.status).toBe(422);
  });

  it("requires the NEAR key to be a current full-access key", async () => {
    const file = await proofFile();
    const removed = await verify(file, { lookupKeys: async () => [] });
    expect(removed.res.status).toBe(422);
    expect(JSON.stringify(removed.body)).toContain("not on the account");
    const limited = await verify(file, { lookupKeys: async () => [{ publicKey: nearPublic, fullAccess: false }] });
    expect(limited.res.status).toBe(422);
    expect(JSON.stringify(limited.body)).toContain("not a full-access key");
    const down = await verify(file, { lookupKeys: () => Promise.reject(new Error("rpc down")) });
    expect(down.res.status).toBe(422);
  });

  it("parses the RPC key list and treats function-call keys as limited", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          result: {
            keys: [
              { public_key: "ed25519:full", access_key: { permission: "FullAccess" } },
              { public_key: "ed25519:limited", access_key: { permission: { FunctionCall: {} } } },
            ],
          },
        }),
      )) as typeof fetch;
    const lookup = createNearKeyLookup("https://rpc.invalid", "testnet", fetchImpl);
    await expect(lookup("testnet", "a.testnet")).resolves.toEqual([
      { publicKey: "ed25519:full", fullAccess: true },
      { publicKey: "ed25519:limited", fullAccess: false },
    ]);
    await expect(lookup("mainnet", "a.near")).rejects.toThrow(/testnet only/);
  });

  it("stores the merchant legal name and hashes both files", async () => {
    const file = await proofFile();
    const merchant = { version: 1, subject: domain, legalName: "New Vendor Holdings LLC" };
    const { app } = makeApp({ fetchFile: serving({ [PAYEE_FILE_PATH]: file, [MERCHANT_IDENTITY_PATH]: merchant }), lookupKeys });
    const body = (await (await post(app, "/v1/vendors/verify", { domain })).json()) as { vendor: { legalName: string }; evidenceHash: string };
    expect(body.vendor.legalName).toBe("New Vendor Holdings LLC");
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(body.evidenceHash).toBe(evidenceHash(encode(file), encode(merchant)));
  });

  it("ignores a merchant file for a different subject", async () => {
    const file = await proofFile();
    const { app } = makeApp({ fetchFile: serving({ [PAYEE_FILE_PATH]: file, [MERCHANT_IDENTITY_PATH]: { subject: "other.example", legalName: "Other Inc" } }), lookupKeys });
    const body = (await (await post(app, "/v1/vendors/verify", { domain })).json()) as { vendor: { legalName: string | null }; evidenceHash: string };
    expect(body.vendor.legalName).toBeNull();
    expect(body.evidenceHash).toBe(evidenceHash(new TextEncoder().encode(JSON.stringify(file)), null));
  });

  it("puts a later account into cooling off, and refuses an older proof", async () => {
    const fileV1 = await buildProofFile({ domain, name: "New Vendor", issuedAt: ISSUED_AT, accounts: [{ account: evm, privateKey: evmPrivate }] });
    const fileV2 = await proofFile("2026-11-07T06:00:00Z");
    let served: unknown = fileV1;
    const { app } = makeApp({ fetchFile: async () => ({ status: 200, body: new TextEncoder().encode(JSON.stringify(served)) }), lookupKeys });

    expect((await post(app, "/v1/vendors/verify", { domain })).status).toBe(200);
    served = fileV2;
    expect((await post(app, "/v1/vendors/verify", { domain })).status).toBe(200);
    const added = PayeeCheckResult.parse(await (await post(app, "/v1/check", { payee: solana, vendor: { domain } })).json());
    expect(added.verdict).toBe("HOLD");
    expect(codes(added)).toEqual(["COOLING_OFF"]);
    expect(PayeeCheckResult.parse(await (await post(app, "/v1/check", { payee: evm, vendor: { domain } })).json()).verdict).toBe("PAY");

    served = fileV1;
    expect((await post(app, "/v1/vendors/verify", { domain })).status).toBe(422);
  });

  it("answers 422 when the file cannot be fetched and 400 on a bad domain", async () => {
    const failing = makeApp({ fetchFile: () => Promise.reject(new Error("dns")), lookupKeys }).app;
    expect((await post(failing, "/v1/vendors/verify", { domain })).status).toBe(422);
    const missing = makeApp({ fetchFile: serving({}), lookupKeys }).app;
    expect((await post(missing, "/v1/vendors/verify", { domain })).status).toBe(422);
    expect((await post(missing, "/v1/vendors/verify", { domain: "169.254.169.254" })).status).toBe(400);
    expect((await post(missing, "/v1/vendors/verify", { domain: "localhost" })).status).toBe(400);
  });

  it.each([
    ["127.0.0.1", 4, false],
    ["10.1.2.3", 4, false],
    ["172.20.0.1", 4, false],
    ["192.168.1.1", 4, false],
    ["169.254.169.254", 4, false],
    ["::1", 6, false],
    ["fd00::1", 6, false],
    ["fe80::1", 6, false],
    ["::ffff:10.0.0.1", 6, false],
    ["8.8.8.8", 4, true],
    ["2606:4700:4700::1111", 6, true],
    ["::ffff:8.8.8.8", 6, true],
  ])("treats %s as public: %s", (address, family, expected) => {
    expect(isPublicAddress(address as string, family as number)).toBe(expected);
  });
});

describe("hosted SDK against the real routes", () => {
  it("resolves, checks, gets a vendor and records a payment", async () => {
    const { app, deps } = makeApp();
    const wardline = createWardline({
      mode: "hosted",
      baseUrl: "http://api.local",
      apiKey: keyFor(deps, "p"),
      fetch: ((input: string | URL | Request, init?: RequestInit) => app.request(String(input), init)) as typeof fetch,
    });
    expect((await wardline.resolve({ domain: DOMAIN, chain: "near:testnet" })).account).toBe("near:testnet:northwind.testnet");
    const check = await wardline.check({ payee: "northwind.testnet", vendor: { domain: DOMAIN } });
    expect(check.receipt).not.toBeNull();
    expect((await wardline.getVendor(DOMAIN))?.name).toBe("Northwind Trading");
    await expect(wardline.getVendor("not-listed.example")).resolves.toBeNull();
    await expect(wardline.recordPayment({ payer: "p", domain: DOMAIN, account: "northwind.testnet" })).resolves.toBeUndefined();
  });
});
