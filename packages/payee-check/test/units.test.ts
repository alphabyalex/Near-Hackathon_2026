import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatAccount, normalizeAccount, normalizeDomain, parseAccount, parseChainId } from "../src/caip.js";
import { LruCache } from "../src/signals/cache.js";
import { detectLookalike, editDistance, skeleton, verifiedEntries } from "../src/lookalike.js";
import { NW_EVM, NW_SOL, VENDORS, solLookalike } from "./helpers.js";

describe("CAIP-10", () => {
  it("normalizes bare NEAR ids and casing", () => {
    expect(normalizeAccount("Northwind.Testnet")).toBe("near:testnet:northwind.testnet");
    expect(normalizeAccount("northwind.near")).toBe("near:mainnet:northwind.near");
    expect(normalizeAccount("abc123", { defaultNearNetwork: "sandbox" })).toBe("near:sandbox:abc123");
    expect(normalizeAccount(`eip155:84532:${NW_EVM.toUpperCase().replace("0X", "0x")}`)).toBe(`eip155:84532:${NW_EVM}`);
  });
  it("keeps Solana case and maps CAIP-2 genesis refs to cluster names", () => {
    expect(normalizeAccount(`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${NW_SOL}`)).toBe(`solana:devnet:${NW_SOL}`);
  });
  it("round-trips", () => {
    const p = parseAccount("near:testnet:northwind.testnet");
    expect(formatAccount(p)).toBe("near:testnet:northwind.testnet");
    expect(p.chainId).toBe("near:testnet");
  });
  it("parses chain ids and domains", () => {
    expect(parseChainId("eip155:84532").chainId).toBe("eip155:84532");
    expect(() => parseChainId("eip155:base")).toThrow();
    expect(normalizeDomain("HTTPS://Northwind.com/.well-known/x")).toBe("northwind.com");
    expect(() => normalizeDomain("localhost")).toThrow();
  });
});

describe("look-alike detector", () => {
  const entries = verifiedEntries(VENDORS);
  const rule = (id: string) => detectLookalike(parseAccount(id), entries);

  it.each([
    ["northwind-billing.testnet", "BAIT_WORD"],
    ["northwind_payments.testnet", "BAIT_WORD"],
    ["official-northwind.testnet", "BAIT_WORD"],
    ["northwindhq.testnet", "BAIT_WORD"],
    ["acme-invoices.testnet", "BAIT_WORD"],
    ["n0rthwind.testnet", "CONFUSABLE"],
    ["northvvind.testnet", "CONFUSABLE"],
    ["acrne-supply.testnet", "CONFUSABLE"],
    ["northwind.tg", "SAME_NAME_OTHER_PARENT"],
    ["northwind.pay.testnet", "SAME_NAME_OTHER_PARENT"],
    ["northwlnd.testnet", "CONFUSABLE"],
    ["nortwind.testnet", "EDIT_DISTANCE"],
  ])("%s -> %s", (id, want) => {
    expect(rule(id)?.rule).toBe(want);
  });

  it("does not flag the verified accounts themselves, unrelated names, or bait words alone", () => {
    for (const id of ["northwind.testnet", "acme-supply.testnet", "billing.testnet", "zephyr-labs.testnet", "pay.northwind.testnet"]) expect(rule(id)).toBeNull();
  });

  it("flags EVM address poisoning on any EVM chain, and near-miss edits", () => {
    expect(rule(`eip155:1:0x9f2e${"1".repeat(32)}2a3b`)).toMatchObject({ rule: "PREFIX_SUFFIX_MATCH", lookalikeOf: "northwind.com" });
    expect(rule(`eip155:84532:${NW_EVM.slice(0, 20)}ff${NW_EVM.slice(22)}`)?.rule).toBeDefined();
    expect(rule(`eip155:84532:0x${"ab".repeat(20)}`)).toBeNull();
  });

  it("flags Solana prefix/suffix look-alikes and leaves others alone", () => {
    expect(rule(`solana:devnet:${solLookalike()}`)).toMatchObject({ rule: "PREFIX_SUFFIX_MATCH", lookalikeOf: "northwind.com" });
    expect(rule(`solana:devnet:${NW_SOL}`)).toBeNull();
  });

  it("has working primitives", () => {
    expect(editDistance("northwind", "nortwind")).toBe(1);
    expect(editDistance("abc", "xyz123", 2)).toBe(3);
    expect(skeleton("rn0rth-1nc")).toBe(skeleton("morthlnc"));
  });
});

describe("LRU cache", () => {
  it("expires entries and evicts the least recently used", () => {
    const clock = { t: 0 };
    const c = new LruCache(2, () => clock.t);
    c.set("a", 1, 1000);
    c.set("b", 2, Number.POSITIVE_INFINITY);
    c.get("a");
    c.set("c", 3, 1000);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    clock.t = 5000;
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")).toBeUndefined();
  });
});

describe("browser safety", () => {
  it("src uses no Node-only modules or globals", () => {
    const dir = join(import.meta.dirname, "..", "src");
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/from\s+["']node:|require\(|\bprocess\.|\bBuffer\b|__dirname/);
    }
  });
});
