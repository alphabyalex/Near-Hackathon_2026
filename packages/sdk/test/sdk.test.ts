import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { PayeeCheckResult } from "@redline/schemas";
import { base58, base64 } from "@scure/base";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileHistory } from "../src/history-file.js";
import {
  assertPayable,
  createIndexedDbHistory,
  createMemoryHistory,
  createMemoryRegistry,
  createRedline,
  createStubSignals,
  hashRequest,
  meetsTier,
  normalizeAccount,
  normalizeDomain,
  receiptSigningText,
  RedlineApiError,
  RedlineBlockedError,
  seedEvmAddress,
  seedSolanaAddress,
  STUB_VENDORS,
  verifyReceipt,
  type PayeeHistoryStore,
  type Redline,
} from "../src/index.js";

const NORTHWIND_EVM = `eip155:84532:${seedEvmAddress("northwind.example")}`;
const NORTHWIND_SOL = `solana:devnet:${seedSolanaAddress("northwind.example")}`;
const domain = "northwind.example";

const direct = (overrides: Partial<Parameters<typeof createRedline>[0]> = {}): Redline =>
  createRedline({
    mode: "direct",
    nearRpcUrl: "https://rpc.invalid",
    registryAccount: "registry.invalid",
    registry: createMemoryRegistry({ vendors: STUB_VENDORS }),
    ...overrides,
  } as Parameters<typeof createRedline>[0]);

const codes = (result: { reasons: { code: string }[] }) => result.reasons.map((r) => r.code);

describe("normalization", () => {
  it("expands a bare NEAR id and lowercases EVM addresses", () => {
    expect(normalizeAccount("northwind.testnet")).toBe("near:testnet:northwind.testnet");
    expect(normalizeAccount("northwind.near", "mainnet")).toBe("near:mainnet:northwind.near");
    expect(normalizeAccount(`eip155:84532:0x${"AB".repeat(20)}`)).toBe(`eip155:84532:0x${"ab".repeat(20)}`);
  });

  it.each(["eip155:1:0x123", "solana:devnet:notbase58!", "near:testnet:UP PER", "a:b", "x:y:z:w", "has space"])("rejects %s", (bad) => {
    expect(() => normalizeAccount(bad)).toThrow();
  });

  it.each(["https://northwind.example", "northwind.example/pay", "localhost", "127.0.0.1", "northwind.example:443", "-bad.example"])("rejects domain %s", (bad) => {
    expect(() => normalizeDomain(bad)).toThrow();
  });
});

describe("check verdicts", () => {
  it.each([
    ["NEAR", "near:testnet:northwind.testnet"],
    ["bare NEAR", "northwind.testnet"],
    ["EVM", NORTHWIND_EVM],
    ["Solana", NORTHWIND_SOL],
  ])("PAY for a verified %s account", async (_label, payee) => {
    const result = await direct().check({ payee, vendor: { domain } });
    expect(result.verdict).toBe("PAY");
    expect(codes(result)).toEqual(["VERIFIED_MATCH"]);
    expect(result.receipt).toBeNull();
  });

  it("identifies the vendor when no domain is claimed", async () => {
    const result = await direct().check({ payee: "northwind.testnet" });
    expect(result.verdict).toBe("PAY");
    expect(result.vendor?.domain).toBe(domain);
  });

  it("BLOCKs a NEAR look-alike", async () => {
    const result = await direct().check({ payee: "northw1nd.testnet", vendor: { domain } });
    expect(result.verdict).toBe("BLOCK");
    expect(codes(result)).toContain("LOOKALIKE_ACCOUNT");
    expect(result.signals.lookalikeOf).toBe("near:testnet:northwind.testnet");
  });

  it("BLOCKs a poisoned EVM address and skips signals for it", async () => {
    const real = seedEvmAddress(domain);
    const poisoned = `${real.slice(0, 6)}${"0".repeat(32)}${real.slice(-4)}`;
    const result = await direct().check({ payee: `eip155:84532:${poisoned}`, vendor: { domain } });
    expect(result.verdict).toBe("BLOCK");
    expect(codes(result)).toEqual(["LOOKALIKE_ACCOUNT"]);
    expect(result.signals.supported).toBe(false);
  });

  it("BLOCKs an unrelated account claimed for a vendor", async () => {
    const result = await direct().check({ payee: "someone-else.testnet", vendor: { domain } });
    expect(result.verdict).toBe("BLOCK");
    expect(codes(result)).toEqual(["ACCOUNT_NOT_VENDORS"]);
  });

  it("BLOCKs another vendor's verified account claimed for this vendor", async () => {
    const result = await direct().check({ payee: "fernhillcloud.testnet", vendor: { domain } });
    expect(result.verdict).toBe("BLOCK");
    expect(codes(result)).toEqual(["ACCOUNT_NOT_VENDORS"]);
  });

  it("BLOCKs a vendor name claim that does not match the account", async () => {
    const result = await direct().check({ payee: "someone-else.testnet", vendor: { name: "Northwind Trading" } });
    expect(result.verdict).toBe("BLOCK");
  });

  it("BLOCKs a missing account", async () => {
    const result = await direct().check({ payee: "vanished-vendor.testnet" });
    expect(result.verdict).toBe("BLOCK");
    expect(codes(result)).toContain("ACCOUNT_MISSING");
  });

  it("HOLDs an unknown account and an unknown domain", async () => {
    expect(codes(await direct().check({ payee: "nobody-known.testnet" }))).toEqual(["NOT_IN_REGISTRY"]);
    const result = await direct().check({ payee: "northwind.testnet", vendor: { domain: "not-listed.example" } });
    expect(result.verdict).toBe("HOLD");
    expect(codes(result)).toEqual(["NOT_IN_REGISTRY"]);
  });

  it("HOLDs a chain the vendor has not verified", async () => {
    const result = await direct().check({ payee: `eip155:1:${seedEvmAddress("elsewhere")}`, vendor: { domain } });
    expect(result.verdict).toBe("HOLD");
    expect(codes(result)).toEqual(["CHAIN_NOT_VERIFIED"]);
  });

  it.each([
    ["NEW_ACCOUNT", { ageDays: 1 }],
    ["RECENT_FULL_ACCESS_KEY", { fullAccessKeysAddedLast7d: 2 }],
    ["RECENT_CODE_CHANGE", { codeChangedLast7d: true }],
  ])("HOLDs a verified NEAR account with %s", async (code, signal) => {
    const signals = createStubSignals({ "near:testnet:northwind.testnet": signal });
    const result = await direct({ signals } as never).check({ payee: "northwind.testnet", vendor: { domain } });
    expect(result.verdict).toBe("HOLD");
    expect(codes(result)).toEqual(["VERIFIED_MATCH", code]);
  });

  it("HOLDs when supported signals cannot be read", async () => {
    const signals = createStubSignals({ "near:testnet:northwind.testnet": null });
    const result = await direct({ signals } as never).check({ payee: "northwind.testnet", vendor: { domain } });
    expect(result.verdict).toBe("HOLD");
    expect(codes(result)).toContain("SIGNALS_UNAVAILABLE");
  });

  it("HOLDs during cooling off, then PAYs after it", async () => {
    let now = new Date("2026-11-07T00:00:00Z");
    const registry = createMemoryRegistry({ vendors: STUB_VENDORS, now: () => now });
    const redline = direct({ registry } as never);
    const added = `eip155:84532:0x${"12".repeat(20)}`;
    await registry.attestVendor({
      domain,
      name: "Northwind Trading",
      accounts: ["near:testnet:northwind.testnet", added],
      evidenceHash: "sha256:x",
      issuedAt: now.toISOString(),
    });
    expect(codes(await redline.check({ payee: added, vendor: { domain } }))).toEqual(["COOLING_OFF"]);
    now = new Date("2026-11-10T00:00:01Z");
    expect((await redline.check({ payee: added, vendor: { domain } })).verdict).toBe("PAY");
  });

  it("refuses a proof older than the one on record", async () => {
    const registry = createMemoryRegistry({ vendors: STUB_VENDORS });
    await expect(
      registry.attestVendor({ domain, name: "Northwind Trading", accounts: ["near:testnet:rolled-back.testnet"], evidenceHash: "sha256:x", issuedAt: "2020-01-01T00:00:00Z" }),
    ).rejects.toThrow(/older/);
    expect((await registry.findByAccount("near:testnet:rolled-back.testnet"))).toBeNull();
  });

  it("HOLDs when this payer last paid a different account on the same chain", async () => {
    const registry = createMemoryRegistry({ vendors: STUB_VENDORS });
    const added = `eip155:84532:0x${"34".repeat(20)}`;
    const redline = direct({ registry } as never);
    await redline.recordPayment({ payer: "acme.testnet", domain, account: added });
    const changed = await redline.check({ payee: NORTHWIND_EVM, vendor: { domain }, payer: "acme.testnet" });
    expect(changed.verdict).toBe("HOLD");
    expect(codes(changed)).toEqual(["VERIFIED_MATCH", "PAYEE_CHANGED"]);
    expect((await redline.check({ payee: NORTHWIND_EVM, vendor: { domain }, payer: "other.testnet" })).verdict).toBe("PAY");
    expect((await redline.check({ payee: NORTHWIND_SOL, vendor: { domain }, payer: "acme.testnet" })).verdict).toBe("PAY");
  });

  it("gives the same verdict for the same input", async () => {
    const redline = direct();
    const request = { payee: "northw1nd.testnet", vendor: { domain } };
    expect(await redline.check(request)).toEqual(await redline.check(request));
  });
});

describe("resolve", () => {
  it.each([
    ["near:testnet", "near:testnet:northwind.testnet"],
    ["eip155:84532", NORTHWIND_EVM],
    ["solana:devnet", NORTHWIND_SOL],
  ])("PAYs with the verified account on %s", async (chain, account) => {
    const result = await direct().resolve({ domain: "NORTHWIND.example", chain });
    expect(result).toMatchObject({ verdict: "PAY", domain, account, receipt: null });
  });

  it("HOLDs for an unknown domain or an unverified chain", async () => {
    const unknown = await direct().resolve({ domain: "not-listed.example", chain: "near:testnet" });
    expect(unknown).toMatchObject({ verdict: "HOLD", account: null });
    expect(codes(unknown)).toEqual(["NOT_IN_REGISTRY"]);
    const chain = await direct().resolve({ domain, chain: "eip155:1" });
    expect(chain).toMatchObject({ verdict: "HOLD", account: null });
    expect(codes(chain)).toEqual(["CHAIN_NOT_VERIFIED"]);
  });

  it("HOLDs with COOLING_OFF when the only account is pending", async () => {
    const registry = createMemoryRegistry({ vendors: STUB_VENDORS });
    const added = `eip155:1:0x${"56".repeat(20)}`;
    await registry.attestVendor({ domain, name: "Northwind Trading", accounts: ["near:testnet:northwind.testnet", added], evidenceHash: "sha256:x", issuedAt: new Date().toISOString() });
    const result = await direct({ registry } as never).resolve({ domain, chain: "eip155:1" });
    expect(result).toMatchObject({ verdict: "HOLD", account: null });
    expect(codes(result)).toEqual(["COOLING_OFF"]);
  });
});


describe("evidence tiers", () => {
  it("is T2 for a domain-linked match, T0 otherwise, and T3 once this payer has paid the account", async () => {
    const redline = direct();
    expect((await redline.check({ payee: "northwind.testnet", vendor: { domain } })).evidenceTier).toBe("T2_DOMAIN_LINKED");
    expect((await redline.check({ payee: "northw1nd.testnet", vendor: { domain } })).evidenceTier).toBe("T0_NONE");
    expect((await redline.check({ payee: "nobody-known.testnet" })).evidenceTier).toBe("T0_NONE");
    await redline.recordPayment({ payer: "acme.testnet", domain, account: NORTHWIND_EVM });
    expect((await redline.check({ payee: NORTHWIND_EVM, vendor: { domain }, payer: "acme.testnet" })).evidenceTier).toBe("T3_RELATIONSHIP");
    expect((await redline.check({ payee: NORTHWIND_EVM, vendor: { domain }, payer: "other.testnet" })).evidenceTier).toBe("T2_DOMAIN_LINKED");
    expect((await redline.resolve({ domain, chain: "eip155:84532", payer: "acme.testnet" })).evidenceTier).toBe("T3_RELATIONSHIP");
    expect((await redline.resolve({ domain: "not-listed.example", chain: "near:testnet" })).evidenceTier).toBe("T0_NONE");
  });

  it("does not raise a pending account to T3", async () => {
    const registry = createMemoryRegistry({ vendors: STUB_VENDORS });
    const added = `eip155:84532:0x${"9a".repeat(20)}`;
    await registry.attestVendor({ domain, name: "Northwind Trading", accounts: ["near:testnet:northwind.testnet", added], evidenceHash: "sha256:x", issuedAt: new Date().toISOString() });
    const redline = direct({ registry } as never);
    await redline.recordPayment({ payer: "acme.testnet", domain, account: added });
    expect((await redline.check({ payee: added, vendor: { domain }, payer: "acme.testnet" })).evidenceTier).toBe("T2_DOMAIN_LINKED");
  });

  it("lists every registry account as T2", async () => {
    const vendor = await direct().getVendor(domain);
    expect(vendor?.accounts.every((a) => a.evidenceTier === "T2_DOMAIN_LINKED")).toBe(true);
  });

  it("assertPayable can require a minimum tier", async () => {
    const result = await direct().check({ payee: "northwind.testnet", vendor: { domain } });
    expect(meetsTier(result, "T2_DOMAIN_LINKED")).toBe(true);
    expect(meetsTier(result, "T3_RELATIONSHIP")).toBe(false);
    expect(meetsTier({}, "T1_WALLET_CONTROL")).toBe(false);
    expect(assertPayable(result, { minTier: "T2_DOMAIN_LINKED" })).toBe(result);
    expect(() => assertPayable(result, { minTier: "T3_RELATIONSHIP" })).toThrow(/below T3_RELATIONSHIP/);
  });
});

describe("assertPayable", () => {
  it("returns a PAY and throws on anything else", async () => {
    const redline = direct();
    await expect(redline.check({ payee: "northwind.testnet" }).then(assertPayable)).resolves.toMatchObject({ verdict: "PAY" });
    await expect(redline.check({ payee: "nobody-known.testnet" }).then(assertPayable)).rejects.toBeInstanceOf(RedlineBlockedError);
    await redline.check({ payee: "northw1nd.testnet", vendor: { domain } }).then(assertPayable).catch((error: RedlineBlockedError) => {
      expect(error.verdict).toBe("BLOCK");
      expect(error.reasons[0]?.code).toBe("LOOKALIKE_ACCOUNT");
    });
  });
});

describe("receipts", () => {
  const secret = ed25519.utils.randomSecretKey();
  const publicKey = `ed25519:${base58.encode(ed25519.getPublicKey(secret))}`;
  const request = { payee: "near:testnet:northwind.testnet", vendor: { domain }, context: "invoice text" };

  const signed = (): PayeeCheckResult => {
    const result: PayeeCheckResult = {
      verdict: "PAY",
      payee: request.payee,
      reasons: [{ code: "VERIFIED_MATCH", detail: "ok" }],
      vendor: { domain, name: "Northwind Trading", verifiedAt: "2026-11-01T00:00:00.000Z", accounts: [] },
      signals: { supported: false, accountExists: null, createdAtBlock: null, ageDays: null, fullAccessKeysAddedLast7d: null, codeChangedLast7d: null, hasContract: null, lookalikeOf: null },
      caseFile: null,
      receipt: null,
      evidenceTier: "T2_DOMAIN_LINKED",
    };
    const base = { id: "rcpt_1", issuedAt: "2026-11-07T00:00:00.000Z", requestHash: hashRequest(request) };
    const signature = base64.encode(ed25519.sign(utf8ToBytes(receiptSigningText(result, base)), secret));
    return { ...result, receipt: { ...base, signer: publicKey, signature } };
  };

  it("verifies a good receipt, with and without the request", () => {
    expect(verifyReceipt(signed(), publicKey)).toBe(true);
    expect(verifyReceipt(signed(), publicKey, { request })).toBe(true);
  });

  it("rejects a changed verdict, payee, reason or request", () => {
    expect(verifyReceipt({ ...signed(), verdict: "HOLD" }, publicKey)).toBe(false);
    expect(verifyReceipt({ ...signed(), payee: "near:testnet:evil.testnet" }, publicKey)).toBe(false);
    expect(verifyReceipt({ ...signed(), reasons: [] }, publicKey)).toBe(false);
    expect(verifyReceipt({ ...signed(), evidenceTier: "T3_RELATIONSHIP" }, publicKey)).toBe(false);
    expect(verifyReceipt(signed(), publicKey, { request: { ...request, context: "other" } })).toBe(false);
  });

  it("rejects the wrong key, a missing receipt and a malformed key", () => {
    const other = `ed25519:${base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))}`;
    expect(verifyReceipt(signed(), other)).toBe(false);
    expect(verifyReceipt({ ...signed(), receipt: null }, publicKey)).toBe(false);
    expect(verifyReceipt(signed(), "not-a-key")).toBe(false);
  });

  it("hashes context, not the raw text, and ignores key order", () => {
    expect(hashRequest({ payee: "a.testnet", context: "x" })).not.toBe(hashRequest({ payee: "a.testnet", context: "y" }));
    expect(hashRequest({ payee: "a.testnet", source: "x402" })).toBe(hashRequest({ source: "x402", payee: "a.testnet" }));
    expect(hashRequest(request)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("direct mode privacy", () => {
  it("makes no network calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const redline = direct();
    await redline.check({ payee: "northwind.testnet", vendor: { domain } });
    await redline.resolve({ domain, chain: "near:testnet" });
    await redline.getVendor(domain);
    await redline.recordPayment({ payer: "a.testnet", domain, account: "northwind.testnet" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns once when it falls back to the sample registry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = { mode: "direct", nearRpcUrl: "https://rpc.invalid", registryAccount: "r.invalid" } as const;
    const redline = createRedline(options);
    createRedline(options);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    expect((await redline.resolve({ domain, chain: "near:testnet" })).verdict).toBe("PAY");
    warn.mockRestore();
  });
});

describe("hosted mode", () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it("throws RedlineApiError on an error answer, so callers cannot read it as a verdict", async () => {
    const redline = createRedline({ mode: "hosted", baseUrl: "https://api.invalid/", fetch: respond(402, { error: "FREE_TIER_EXCEEDED", message: "Limit reached." }) as typeof fetch });
    const error = await redline.check({ payee: "northwind.testnet" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedlineApiError);
    expect(error).toMatchObject({ status: 402, code: "FREE_TIER_EXCEEDED" });
  });

  it("rejects a malformed answer and treats a missing vendor as null", async () => {
    const bad = createRedline({ mode: "hosted", baseUrl: "https://api.invalid", fetch: respond(200, { verdict: "MAYBE" }) as typeof fetch });
    await expect(bad.check({ payee: "northwind.testnet" })).rejects.toThrow();
    const none = createRedline({ mode: "hosted", baseUrl: "https://api.invalid", fetch: respond(404, { error: "NOT_FOUND" }) as typeof fetch });
    await expect(none.getVendor(domain)).resolves.toBeNull();
  });
});

describe("history stores", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "redline-history-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const stores: [string, () => PayeeHistoryStore][] = [
    ["memory", () => createMemoryHistory()],
    ["IndexedDB", () => createIndexedDbHistory({ factory: new IDBFactory() })],
    ["file", () => createFileHistory(join(dir, "nested", "history.json"))],
  ];

  it.each(stores)("%s keeps the latest account per payer, domain and chain", async (_name, make) => {
    const store = make();
    const near = "near:testnet:a.testnet";
    expect(await store.lastAccount("p", domain, "near:testnet")).toBeNull();
    await store.record({ payer: "p", domain, account: near });
    await store.record({ payer: "p", domain, account: "near:testnet:b.testnet" });
    expect(await store.lastAccount("p", domain, "near:testnet")).toBe("near:testnet:b.testnet");
    expect(await store.lastAccount("q", domain, "near:testnet")).toBeNull();
    expect(await store.lastAccount("p", domain, "eip155:1")).toBeNull();
  });

  it("file history survives a new store on the same path", async () => {
    const path = join(dir, "history.json");
    await createFileHistory(path).record({ payer: "p", domain, account: "near:testnet:a.testnet" });
    expect(await createFileHistory(path).lastAccount("p", domain, "near:testnet")).toBe("near:testnet:a.testnet");
  });
});
