/**
 * Records real NEAR testnet RPC responses ONCE into fixtures/testnet-recording.json.
 * Tests replay that file and never touch the network.
 *
 *   QUICKNODE_NEAR_RPC_URL=... pnpm --filter @wardline/payee-check record-fixtures
 *   (or NEAR_RPC_URL=...; the endpoint must be archival, or set NEAR_ARCHIVE_RPC_URL)
 *
 * Hard budget: at most MAX_LIVE_CALLS HTTP requests, counted including retries. An account is
 * only attempted if the remaining budget covers its worst case, so the cap is never exceeded.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAccount } from "../src/caip.js";
import { LruCache } from "../src/signals/cache.js";
import { NearRpcClient, nearRpcUrlsFromEnv, type FetchLike } from "../src/signals/near-rpc.js";
import { NearSignalsProvider } from "../src/signals/near-signals.js";
import type { ChainSignals } from "../src/types.js";
import type { RecordedCall, Recording } from "./fixture-format.js";

const MAX_LIVE_CALLS = 50;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "testnet-recording.json");

/** Accounts to record, cheapest first, with a worst-case call estimate for the budget check. */
const TARGETS: Array<{ id: string; why: string; worstCase: number }> = [
  { id: "wardline-payee-missing-q7x2.testnet", why: "does not exist: ACCOUNT_MISSING", worstCase: 2 },
  { id: "vault-a.redline-labs.testnet", why: "created this week with a contract: NEW_ACCOUNT, RECENT_CODE_CHANGE", worstCase: 32 },
  { id: "owner-a.redline-labs.testnet", why: "created this week with a full-access key: RECENT_FULL_ACCESS_KEY", worstCase: 28 },
];

async function main(): Promise<void> {
  const urls = nearRpcUrlsFromEnv(process.env);
  if (!urls) throw new Error("set QUICKNODE_NEAR_RPC_URL or NEAR_RPC_URL (archival testnet endpoint)");
  const source = process.env["QUICKNODE_NEAR_RPC_URL"] ? "QUICKNODE_NEAR_RPC_URL" : "NEAR_RPC_URL";

  const calls: RecordedCall[] = [];
  let live = 0;
  const recording: FetchLike = async (url, init) => {
    if (live >= MAX_LIVE_CALLS) throw new Error("live call budget exhausted");
    live += 1;
    const res = await fetch(url, init);
    const body: unknown = await res.json();
    const { method, params } = JSON.parse(init.body) as RecordedCall["request"];
    calls.push({ request: { method, params }, response: { status: res.status, body } });
    return { ok: res.ok, status: res.status, json: async () => body };
  };

  const rpc = new NearRpcClient({ ...urls, fetch: recording });
  const provider = new NearSignalsProvider({ network: "testnet", rpc, cache: new LruCache() });
  const signals: Record<string, ChainSignals> = {};
  for (const t of TARGETS) {
    if (MAX_LIVE_CALLS - live < t.worstCase) {
      console.log(`skip ${t.id}: ${MAX_LIVE_CALLS - live} calls left, needs up to ${t.worstCase}`);
      continue;
    }
    const before = live;
    signals[t.id] = await provider.getSignals(parseAccount(t.id));
    console.log(`${t.id} (${t.why}): ${live - before} calls`, JSON.stringify(signals[t.id]));
  }

  // Keep only the last response per request: retries of the same request replay as the final outcome.
  const dedup = new Map<string, RecordedCall>();
  for (const c of calls) dedup.set(JSON.stringify(c.request), c);
  const out: Recording = {
    schema: "wardline-payee-rpc-recording-v1",
    recorded_at: new Date().toISOString(),
    network: "testnet",
    endpoint_source: source,
    live_calls: live,
    calls: [...dedup.values()],
    signals,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n${live} live calls (budget ${MAX_LIVE_CALLS}). Wrote ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
