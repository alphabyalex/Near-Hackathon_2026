import type { FetchLike } from "../src/signals/near-rpc.js";
import type { ChainSignals } from "../src/types.js";

/** One recorded JSON-RPC exchange. The endpoint URL is never stored (QuickNode URLs carry the API key). */
export interface RecordedCall {
  request: { method: string; params: Record<string, unknown> };
  response: { status: number; body: unknown };
}

export interface Recording {
  schema: "wardline-payee-rpc-recording-v1";
  recorded_at: string;
  network: string;
  /** Which env var supplied the endpoint, never the URL itself. */
  endpoint_source: string;
  live_calls: number;
  calls: RecordedCall[];
  /** Signals computed live at record time, per account id. Replay must reproduce them exactly. */
  signals: Record<string, ChainSignals>;
}

const sortKeys = (v: unknown): unknown =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
    : v;

/** Request identity ignores the JSON-RPC id. */
export const requestKey = (method: string, params: unknown): string => JSON.stringify(sortKeys({ method, params }));

/** Replays a recording. Unrecorded requests fail like a network error; nothing ever reaches the network. */
export function replayFetch(rec: Pick<Recording, "calls">): FetchLike & { requests: number; misses: string[] } {
  const table = new Map(rec.calls.map((c) => [requestKey(c.request.method, c.request.params), c.response]));
  const f = (async (_url, init) => {
    f.requests += 1;
    const { method, params } = JSON.parse(init.body) as { method: string; params: unknown };
    const hit = table.get(requestKey(method, params));
    if (!hit) {
      f.misses.push(requestKey(method, params));
      throw new Error("replay: request was not recorded");
    }
    return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, json: async () => hit.body };
  }) as FetchLike & { requests: number; misses: string[] };
  f.requests = 0;
  f.misses = [];
  return f;
}
