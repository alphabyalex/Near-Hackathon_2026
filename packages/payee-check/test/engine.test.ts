import { PayeeCheckResult, PayeeResolveResult, type PayeeReasonCode } from "@wardline/schemas";
import { describe, expect, it } from "vitest";
import { AccountParseError, DomainParseError } from "../src/caip.js";
import { checkPayee, resolvePayee } from "../src/engine.js";
import { InMemoryPaymentHistory } from "../src/memory.js";
import { NearSignalsProvider } from "../src/signals/near-signals.js";
import type { CheckOutcome } from "../src/types.js";
import { ACME_EVM_BASE, FakeSignals, NW_EVM, NW_SOL, deps, solLookalike } from "./helpers.js";

const codes = (r: { reasons: Array<{ code: PayeeReasonCode }> }) => r.reasons.map((x) => x.code).sort();
const expectShape = (r: CheckOutcome) => {
  expect(() => PayeeCheckResult.parse({ ...r, caseFile: null, receipt: null })).not.toThrow();
  for (const reason of r.reasons) {
    expect(reason.detail.length).toBeGreaterThan(20);
    expect(reason.detail.trim().endsWith(".") || reason.detail.trim().endsWith(")")).toBe(true);
  }
};

interface Case {
  name: string;
  payee: string;
  domain?: string;
  payer?: string;
  signals?: ConstructorParameters<typeof FakeSignals>[0];
  history?: [string, string, string];
  verdict: "PAY" | "HOLD" | "BLOCK";
  reasons: PayeeReasonCode[];
}

const CASES: Case[] = [
  { name: "verified NEAR match", payee: "near:testnet:northwind.testnet", domain: "northwind.com", verdict: "PAY", reasons: ["VERIFIED_MATCH"] },
  { name: "verified EVM match, mixed-case input", payee: `eip155:84532:${NW_EVM.toUpperCase().replace("0X", "0x")}`, domain: "northwind.com", verdict: "PAY", reasons: ["VERIFIED_MATCH"] },
  { name: "verified Solana match", payee: `solana:devnet:${NW_SOL}`, domain: "northwind.com", verdict: "PAY", reasons: ["VERIFIED_MATCH"] },
  { name: "NEAR look-alike with a bait word", payee: "northwind-billing.testnet", domain: "northwind.com", verdict: "BLOCK", reasons: ["ACCOUNT_NOT_VENDORS", "LOOKALIKE_ACCOUNT"] },
  { name: "NEAR look-alike with a bait word, no vendor claimed", payee: "near:testnet:northwindpay.testnet", verdict: "BLOCK", reasons: ["LOOKALIKE_ACCOUNT", "NOT_IN_REGISTRY"] },
  { name: "confusable characters", payee: "near:testnet:n0rthwind.testnet", verdict: "BLOCK", reasons: ["LOOKALIKE_ACCOUNT", "NOT_IN_REGISTRY"] },
  { name: "same name under a different parent", payee: "near:testnet:northwind.vendors.testnet", domain: "northwind.com", verdict: "BLOCK", reasons: ["ACCOUNT_NOT_VENDORS", "LOOKALIKE_ACCOUNT"] },
  { name: "EVM address poisoning", payee: `eip155:84532:0x9f2e${"0".repeat(32)}2a3b`, domain: "northwind.com", verdict: "BLOCK", reasons: ["ACCOUNT_NOT_VENDORS", "LOOKALIKE_ACCOUNT"] },
  { name: "EVM poisoning on another chain, no vendor claimed", payee: `eip155:1:0x9f2e${"5".repeat(32)}2a3b`, verdict: "BLOCK", reasons: ["LOOKALIKE_ACCOUNT", "NOT_IN_REGISTRY"] },
  { name: "Solana look-alike", payee: `solana:devnet:${solLookalike()}`, domain: "northwind.com", verdict: "BLOCK", reasons: ["ACCOUNT_NOT_VENDORS", "LOOKALIKE_ACCOUNT"] },
  { name: "vendor verified, but not on this chain", payee: `eip155:1:0x${"7".repeat(40)}`, domain: "northwind.com", verdict: "HOLD", reasons: ["CHAIN_NOT_VERIFIED"] },
  { name: "vendor's own address on a chain it did not verify", payee: `eip155:1:${NW_EVM}`, domain: "northwind.com", verdict: "HOLD", reasons: ["CHAIN_NOT_VERIFIED"] },
  { name: "another vendor's verified account claimed as this vendor", payee: "near:testnet:acme-supply.testnet", domain: "northwind.com", verdict: "BLOCK", reasons: ["ACCOUNT_NOT_VENDORS"] },
  { name: "brand-new full-access key on a verified vendor", payee: "northwind.testnet", domain: "northwind.com", signals: { "northwind.testnet": { fullAccessKeysAddedLast7d: 1 } }, verdict: "HOLD", reasons: ["RECENT_FULL_ACCESS_KEY", "VERIFIED_MATCH"] },
  { name: "new account", payee: "northwind.testnet", domain: "northwind.com", signals: { "northwind.testnet": { ageDays: 3.2 } }, verdict: "HOLD", reasons: ["NEW_ACCOUNT", "VERIFIED_MATCH"] },
  { name: "contract code changed this week", payee: "northwind.testnet", domain: "northwind.com", signals: { "northwind.testnet": { codeChangedLast7d: true, hasContract: true } }, verdict: "HOLD", reasons: ["RECENT_CODE_CHANGE", "VERIFIED_MATCH"] },
  { name: "payee changed against this payer's history", payee: "northwind.testnet", domain: "northwind.com", payer: "ap-bot.testnet", history: ["ap-bot.testnet", "northwind.com", "near:testnet:northwind-old.testnet"], verdict: "HOLD", reasons: ["PAYEE_CHANGED", "VERIFIED_MATCH"] },
  { name: "same payee as last time", payee: "northwind.testnet", domain: "northwind.com", payer: "ap-bot.testnet", history: ["ap-bot.testnet", "northwind.com", "northwind.testnet"], verdict: "PAY", reasons: ["VERIFIED_MATCH"] },
  { name: "missing NEAR account", payee: "near:testnet:quietfield-traders.testnet", domain: "quietfield.io", signals: { "quietfield-traders.testnet": { accountExists: false, ageDays: null, createdAtBlock: null, fullAccessKeysAddedLast7d: null, codeChangedLast7d: null, hasContract: null } }, verdict: "BLOCK", reasons: ["ACCOUNT_MISSING", "NOT_IN_REGISTRY"] },
  { name: "signals provider throws", payee: "northwind.testnet", domain: "northwind.com", signals: { "northwind.testnet": "throw" }, verdict: "HOLD", reasons: ["SIGNALS_UNAVAILABLE", "VERIFIED_MATCH"] },
  { name: "partial signals", payee: "northwind.testnet", domain: "northwind.com", signals: { "northwind.testnet": { ageDays: null, createdAtBlock: null } }, verdict: "HOLD", reasons: ["SIGNALS_UNAVAILABLE", "VERIFIED_MATCH"] },
  { name: "no vendor claimed, found by reverse index", payee: "near:testnet:acme-supply.testnet", verdict: "PAY", reasons: ["VERIFIED_MATCH"] },
  { name: "cooling-off account", payee: "acme-treasury.testnet", domain: "acme.com", verdict: "HOLD", reasons: ["COOLING_OFF"] },
  { name: "cooling-off account, found by reverse index", payee: "acme-treasury.testnet", verdict: "HOLD", reasons: ["COOLING_OFF"] },
  { name: "domain not in registry", payee: "near:testnet:quietfield.testnet", domain: "https://Quietfield.io/pay", verdict: "HOLD", reasons: ["NOT_IN_REGISTRY"] },
  { name: "unknown EVM address, no claim: no signals, so registry only", payee: `eip155:84532:0x${"ab".repeat(20)}`, verdict: "HOLD", reasons: ["NOT_IN_REGISTRY"] },
  { name: "verified Base address on Base", payee: `eip155:8453:${ACME_EVM_BASE}`, domain: "acme.com", verdict: "PAY", reasons: ["VERIFIED_MATCH"] },
];

describe("checkPayee", () => {
  it.each(CASES)("$name -> $verdict", async (c) => {
    const history = new InMemoryPaymentHistory();
    if (c.history) history.record(...c.history);
    const d = deps({ signals: new FakeSignals(c.signals), history });
    const r = await checkPayee({ payee: c.payee, ...(c.domain ? { vendor: { domain: c.domain } } : {}), ...(c.payer ? { payer: c.payer } : {}) }, d);
    expect({ verdict: r.verdict, reasons: codes(r) }).toEqual({ verdict: c.verdict, reasons: [...c.reasons].sort() });
    expectShape(r);
  });

  it("names the imitated vendor in signals.lookalikeOf", async () => {
    const r = await checkPayee({ payee: "northwind-billing.testnet" }, deps());
    expect(r.signals.lookalikeOf).toBe("northwind.com");
    expect(r.payee).toBe("near:testnet:northwind-billing.testnet");
  });

  it("reports signals as unsupported for non-NEAR chains and never asks for SIGNALS_UNAVAILABLE there", async () => {
    const r = await checkPayee({ payee: `solana:devnet:${NW_SOL}`, vendor: { domain: "northwind.com" } }, deps());
    expect(r.signals.supported).toBe(false);
    expect(codes(r)).not.toContain("SIGNALS_UNAVAILABLE");
  });

  it("returns the vendor found by reverse lookup", async () => {
    const r = await checkPayee({ payee: "acme-supply.testnet" }, deps());
    expect(r.vendor?.domain).toBe("acme.com");
  });

  it("keeps working when RPC is down: real provider, failing fetch, HOLD not throw", async () => {
    const signals = new NearSignalsProvider({ network: "testnet", rpc: { rpcUrl: "https://rpc.invalid", fetch: async () => { throw new Error("ECONNREFUSED"); }, timeoutMs: 50, retries: 1 } });
    const r = await checkPayee({ payee: "northwind.testnet", vendor: { domain: "northwind.com" } }, deps({ signals }));
    expect(r.verdict).toBe("HOLD");
    expect(codes(r)).toEqual(["SIGNALS_UNAVAILABLE", "VERIFIED_MATCH"]);
    expect(signals.rpc.calls).toBe(2);
  });

  it.each([
    ["empty", ""],
    ["two parts", "near:northwind.testnet"],
    ["unknown namespace", "cosmos:hub:cosmos1abc"],
    ["bad NEAR id", "near:testnet:North Wind!.testnet"],
    ["unknown NEAR network", "near:devnet:northwind.testnet"],
    ["short EVM address", "eip155:1:0x1234"],
    ["EVM non-numeric chain", "eip155:base:0x9f2e4a1b7c3d5e6f8091a2b3c4d5e6f708192a3b"],
    ["Solana not base58", "solana:devnet:0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"],
    ["Solana wrong length", "solana:devnet:7xKX"],
    ["too long", `near:testnet:${"a".repeat(200)}`],
  ])("rejects malformed CAIP-10 (%s) before any registry call", async (_n, payee) => {
    const d = deps();
    await expect(checkPayee({ payee }, d)).rejects.toThrow(AccountParseError);
    expect(d.registry.calls).toBe(0);
  });

  it("rejects a malformed vendor domain before any registry call", async () => {
    const d = deps();
    await expect(checkPayee({ payee: "northwind.testnet", vendor: { domain: "not a domain" } }, d)).rejects.toThrow(DomainParseError);
    expect(d.registry.calls).toBe(0);
  });
});

describe("resolvePayee", () => {
  const ok = (r: Awaited<ReturnType<typeof resolvePayee>>) => expect(() => PayeeResolveResult.parse({ ...r, receipt: null })).not.toThrow();

  it("resolves a verified domain on NEAR", async () => {
    const r = await resolvePayee({ domain: "Northwind.com", chain: "near:testnet" }, deps());
    expect(r).toMatchObject({ verdict: "PAY", domain: "northwind.com", chain: "near:testnet", account: "near:testnet:northwind.testnet" });
    expect(codes(r)).toEqual(["VERIFIED_MATCH"]);
    ok(r);
  });

  it("resolves on EVM and Solana without on-chain signals", async () => {
    expect((await resolvePayee({ domain: "northwind.com", chain: "eip155:84532" }, deps())).account).toBe(`eip155:84532:${NW_EVM}`);
    expect((await resolvePayee({ domain: "northwind.com", chain: "solana:devnet" }, deps())).account).toBe(`solana:devnet:${NW_SOL}`);
  });

  it("holds during cooling-off when the only new account is pending", async () => {
    const vendors = [{ domain: "fernhill.dev", name: "Fernhill", verifiedAt: "2026-11-06T00:00:00Z", accounts: [{ account: "near:testnet:fernhill.testnet", status: "pending" as const, activatesAt: "2026-11-09T00:00:00Z" }] }];
    const r = await resolvePayee({ domain: "fernhill.dev", chain: "near:testnet" }, deps({ vendors }));
    expect(r).toMatchObject({ verdict: "HOLD", account: null });
    expect(codes(r)).toEqual(["COOLING_OFF"]);
    ok(r);
  });

  it("holds when the vendor has no account on that chain", async () => {
    const r = await resolvePayee({ domain: "acme.com", chain: "solana:devnet" }, deps());
    expect(r).toMatchObject({ verdict: "HOLD", account: null });
    expect(codes(r)).toEqual(["CHAIN_NOT_VERIFIED"]);
  });

  it("holds when the domain is not in the registry", async () => {
    const r = await resolvePayee({ domain: "quietfield.io", chain: "near:testnet" }, deps());
    expect(codes(r)).toEqual(["NOT_IN_REGISTRY"]);
    expect(r.vendor).toBeNull();
  });

  it("holds, without an account, when the resolved account's signals are not clean", async () => {
    const r = await resolvePayee({ domain: "northwind.com", chain: "near:testnet" }, deps({ signals: new FakeSignals({ "northwind.testnet": { fullAccessKeysAddedLast7d: 2 } }) }));
    expect(r).toMatchObject({ verdict: "HOLD", account: null });
    expect(codes(r)).toEqual(["RECENT_FULL_ACCESS_KEY", "VERIFIED_MATCH"]);
  });

  it("rejects a malformed chain id", async () => {
    await expect(resolvePayee({ domain: "northwind.com", chain: "near" }, deps())).rejects.toThrow();
  });
});
