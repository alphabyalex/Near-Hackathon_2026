import { describe, expect, it } from "vitest";
import { parseAccount } from "../src/caip.js";
import { LruCache } from "../src/signals/cache.js";
import type { FetchLike } from "../src/signals/near-rpc.js";
import { NearSignalsProvider } from "../src/signals/near-signals.js";

/** A fake NEAR testnet: deterministic heights, timestamps, accounts, keys, code and skipped heights. */
const HEAD = 230_000_000;
const SPB = 1.2; // real seconds per block, deliberately different from the config guess
const HEAD_TS = 1_794_000_000_000_000_000n;
const DAY = Math.round(86_400 / SPB);
const tsAt = (h: number) => (HEAD_TS - BigInt(Math.round((HEAD - h) * SPB * 1e9))).toString();
const EMPTY = "11111111111111111111111111111111";

interface FakeAccount {
  createdAt: number;
  code?: Array<[number, string]>;
  keys?: Array<{ pk: string; full: boolean; at: number }>;
}

function fakeChain(accounts: Record<string, FakeAccount>, opts: { skipped?: (h: number) => boolean; archiveBroken?: boolean } = {}) {
  const err = (cause: string) => ({ jsonrpc: "2.0", id: "x", error: { name: "HANDLER_ERROR", cause: { name: cause }, message: "Server error" } });
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: "x", result });
  const f = (async (_url, init) => {
    f.calls += 1;
    const { method, params } = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
    const h = typeof params["block_id"] === "number" ? (params["block_id"] as number) : HEAD;
    const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (h !== HEAD && opts.archiveBroken) return respond(err("GARBAGE_COLLECTED_BLOCK"));
    if (h > HEAD || opts.skipped?.(h)) return respond(err("UNKNOWN_BLOCK"));
    if (method === "block") return respond(ok({ header: { height: h, timestamp_nanosec: tsAt(h) } }));
    const a = accounts[params["account_id"] as string];
    if (!a || a.createdAt > h) return respond(err("UNKNOWN_ACCOUNT"));
    if (params["request_type"] === "view_account") {
      const code = (a.code ?? []).filter(([at]) => at <= h).pop()?.[1] ?? EMPTY;
      return respond(ok({ amount: "1", code_hash: code, block_height: h }));
    }
    const keys = (a.keys ?? []).filter((k) => k.at <= h).map((k) => ({ public_key: k.pk, access_key: { nonce: 1, permission: k.full ? "FullAccess" : { FunctionCall: {} } } }));
    return respond(ok({ keys, block_height: h }));
  }) as FetchLike & { calls: number };
  f.calls = 0;
  return f;
}

const ACCOUNTS: Record<string, FakeAccount> = {
  "old-clean.testnet": { createdAt: HEAD - 50 * DAY, keys: [{ pk: "ed25519:A", full: true, at: HEAD - 50 * DAY }] },
  "young-contract.testnet": { createdAt: HEAD - 3 * DAY, code: [[HEAD - 2 * DAY, "CodeHashV1"]], keys: [{ pk: "ed25519:B", full: true, at: HEAD - 3 * DAY }] },
  "taken-over.testnet": {
    createdAt: HEAD - 400 * DAY,
    code: [[HEAD - 300 * DAY, "OldCode"], [HEAD - 3 * DAY, "NewCode"]],
    keys: [
      { pk: "ed25519:C", full: true, at: HEAD - 400 * DAY },
      { pk: "ed25519:D", full: false, at: HEAD - 100 * DAY },
      { pk: "ed25519:E", full: true, at: HEAD - 2 * DAY },
    ],
  },
};

const provider = (fetch: FetchLike, clock = { t: 0 }) =>
  new NearSignalsProvider({ network: "testnet", rpc: { rpcUrl: "https://fake", fetch, timeoutMs: 100, retries: 1 }, cache: new LruCache(100, () => clock.t) });

describe("NearSignalsProvider on a simulated chain", () => {
  it("finds the exact creation block of an old, clean account", async () => {
    const f = fakeChain(ACCOUNTS);
    const s = await provider(f).getSignals(parseAccount("old-clean.testnet"));
    expect(s).toMatchObject({ supported: true, accountExists: true, createdAtBlock: HEAD - 50 * DAY, fullAccessKeysAddedLast7d: 0, codeChangedLast7d: false, hasContract: false });
    expect(s.ageDays).toBeCloseTo(50, 1);
    expect(f.calls).toBeLessThanOrEqual(40);
  });

  it("reads a young account with a fresh contract", async () => {
    const f = fakeChain(ACCOUNTS);
    const s = await provider(f).getSignals(parseAccount("young-contract.testnet"));
    expect(s).toMatchObject({ accountExists: true, createdAtBlock: HEAD - 3 * DAY, fullAccessKeysAddedLast7d: 1, codeChangedLast7d: true, hasContract: true });
    expect(s.ageDays).toBeCloseTo(3, 1);
    expect(f.calls).toBeLessThanOrEqual(28);
  });

  it("sees a takeover: new full-access key and new code on an old account, ignoring function-call keys", async () => {
    const s = await provider(fakeChain(ACCOUNTS)).getSignals(parseAccount("taken-over.testnet"));
    expect(s).toMatchObject({ fullAccessKeysAddedLast7d: 1, codeChangedLast7d: true, createdAtBlock: HEAD - 400 * DAY });
  });

  it("reports a missing account with one call", async () => {
    const f = fakeChain(ACCOUNTS);
    const s = await provider(f).getSignals(parseAccount("nobody-here.testnet"));
    expect(s.accountExists).toBe(false);
    expect(f.calls).toBe(1);
  });

  it("steps over skipped block heights", async () => {
    const s = await provider(fakeChain(ACCOUNTS, { skipped: (h) => h % 7 === 0 })).getSignals(parseAccount("young-contract.testnet"));
    expect(s.createdAtBlock).toBe(HEAD - 3 * DAY);
    expect(s.codeChangedLast7d).toBe(true);
  });

  it("caches: creation forever, recent state for 10 minutes, the window across accounts", async () => {
    const f = fakeChain(ACCOUNTS);
    const clock = { t: 0 };
    const p = provider(f, clock);
    await p.getSignals(parseAccount("old-clean.testnet"));
    const first = f.calls;
    await p.getSignals(parseAccount("old-clean.testnet"));
    expect(f.calls).toBe(first); // fully cached: 0 calls

    clock.t = 11 * 60 * 1000;
    await p.getSignals(parseAccount("old-clean.testnet"));
    const refresh = f.calls - first;
    expect(refresh).toBeLessThanOrEqual(6); // account, keys now, window (2), state and keys a week ago
    expect(refresh).toBeGreaterThan(0);

    const before = f.calls;
    await p.getSignals(parseAccount("taken-over.testnet"));
    const blockCalls = f.calls - before;
    expect(blockCalls).toBeLessThan(first); // window reused
  });

  it("returns nulls, not an exception, when the archive is unavailable", async () => {
    const s = await provider(fakeChain(ACCOUNTS, { archiveBroken: true })).getSignals(parseAccount("old-clean.testnet"));
    expect(s).toMatchObject({ supported: true, accountExists: true, hasContract: false, ageDays: null, fullAccessKeysAddedLast7d: null, codeChangedLast7d: null });
  });

  it("times out, retries once, then gives up", async () => {
    let calls = 0;
    const hang: FetchLike = (_u, init) =>
      new Promise((_, reject) => {
        calls += 1;
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const s = await provider(hang).getSignals(parseAccount("old-clean.testnet"));
    expect(s.accountExists).toBeNull();
    expect(calls).toBe(2);
  });

  it("retries an HTTP 503 and succeeds", async () => {
    const chain = fakeChain(ACCOUNTS);
    let n = 0;
    const flaky: FetchLike = async (u, init) => (++n === 1 ? { ok: false, status: 503, json: async () => ({}) } : chain(u, init));
    const s = await provider(flaky).getSignals(parseAccount("old-clean.testnet"));
    expect(s.accountExists).toBe(true);
    expect(s.ageDays).toBeCloseTo(50, 1);
  });

  it("makes no calls for other chains, and marks other NEAR networks unavailable", async () => {
    const f = fakeChain(ACCOUNTS);
    const p = provider(f);
    expect((await p.getSignals(parseAccount("eip155:1:0x9f2e4a1b7c3d5e6f8091a2b3c4d5e6f708192a3b"))).supported).toBe(false);
    expect(await p.getSignals(parseAccount("near:mainnet:old-clean.near"))).toMatchObject({ supported: true, accountExists: null });
    expect(f.calls).toBe(0);
  });
});
