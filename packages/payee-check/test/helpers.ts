import type { PayeeVendor } from "@redline/schemas";
import { parseAccount, type ParsedAccount } from "../src/caip.js";
import { InMemoryPaymentHistory, InMemoryPayeeRegistry } from "../src/memory.js";
import { UNSUPPORTED_SIGNALS } from "../src/signals/near-signals.js";
import type { ChainSignals, CheckDeps, PayeeRegistry, SignalsProvider } from "../src/types.js";

export const NOW = Date.parse("2026-11-07T12:00:00Z");
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: number[]): string {
  let n = bytes.reduce((a, b) => a * 256n + BigInt(b), 0n);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}
const bytes32 = (seed: number) => Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 17 + 7) % 256);

export const NW_EVM = "0x9f2e4a1b7c3d5e6f8091a2b3c4d5e6f708192a3b";
export const NW_SOL = base58(bytes32(3));
export const ACME_EVM_BASE = "0x1234aaaabbbbccccddddeeeeffff000011112222";

/** Same first 4 and last 4 characters as NW_SOL, different middle. */
export function solLookalike(): string {
  const mid = Math.floor(NW_SOL.length / 2);
  const swap = NW_SOL[mid] === "z" ? "y" : "z";
  return NW_SOL.slice(0, mid) + swap + NW_SOL.slice(mid + 1);
}

export const VENDORS: PayeeVendor[] = [
  {
    domain: "northwind.com",
    name: "Northwind Trading",
    verifiedAt: "2026-09-01T00:00:00Z",
    accounts: [
      { account: "near:testnet:northwind.testnet", status: "active", activatesAt: null },
      { account: `eip155:84532:${NW_EVM}`, status: "active", activatesAt: null },
      { account: `solana:devnet:${NW_SOL}`, status: "active", activatesAt: null },
    ],
  },
  {
    domain: "acme.com",
    name: "Acme Supply",
    verifiedAt: "2026-10-01T00:00:00Z",
    accounts: [
      { account: "near:testnet:acme-supply.testnet", status: "active", activatesAt: null },
      { account: `eip155:8453:${ACME_EVM_BASE}`, status: "active", activatesAt: null },
      { account: "near:testnet:acme-treasury.testnet", status: "pending", activatesAt: hours(48) },
    ],
  },
];

export const CLEAN: ChainSignals = {
  supported: true,
  accountExists: true,
  createdAtBlock: 120_000_000,
  ageDays: 400,
  fullAccessKeysAddedLast7d: 0,
  codeChangedLast7d: false,
  hasContract: false,
};

/** NEAR accounts get CLEAN unless overridden; other chains are unsupported. */
export class FakeSignals implements SignalsProvider {
  calls: string[] = [];
  constructor(private readonly overrides: Record<string, Partial<ChainSignals> | "throw"> = {}) {}
  async getSignals(a: ParsedAccount): Promise<ChainSignals> {
    this.calls.push(a.address);
    const o = this.overrides[a.address];
    if (o === "throw") throw new Error("boom");
    if (a.namespace !== "near") return UNSUPPORTED_SIGNALS;
    return { ...CLEAN, ...(o ?? {}) };
  }
}

/** Counts every registry call so tests can prove malformed input is rejected before any lookup. */
export function countingRegistry(inner: PayeeRegistry): PayeeRegistry & { calls: number } {
  const r = { calls: 0 } as PayeeRegistry & { calls: number };
  for (const m of ["getVendor", "getVendorByAccount", "isVerifiedPayee", "resolve", "listVendors"] as const)
    (r as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
      r.calls += 1;
      return (inner[m] as (...a: unknown[]) => unknown).apply(inner, args);
    };
  return r;
}

export function deps(opts: { signals?: SignalsProvider; history?: InMemoryPaymentHistory; vendors?: PayeeVendor[] } = {}): CheckDeps & {
  registry: PayeeRegistry & { calls: number };
} {
  return {
    registry: countingRegistry(new InMemoryPayeeRegistry(opts.vendors ?? VENDORS, () => NOW)),
    signals: opts.signals ?? new FakeSignals(),
    ...(opts.history ? { history: opts.history } : {}),
    now: () => NOW,
  };
}

export const near = (id: string) => parseAccount(id);
