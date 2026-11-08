import { PAYEE_CHECK_CONFIG } from "../config.js";

/** The subset of fetch we use, so tests can inject a recorder or a replayer. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface NearRpcOptions {
  rpcUrl: string;
  /** Used for every historical (block_id) query. Defaults to rpcUrl, which must then be archival. */
  archiveRpcUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  retries?: number;
}

export type RpcFailureKind = "UNKNOWN_ACCOUNT" | "UNKNOWN_BLOCK" | "FAILED";
export type RpcOutcome<T> = { ok: true; result: T } | { ok: false; kind: RpcFailureKind; message: string };

export class RpcFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcFailure";
  }
}

const RETRYABLE_CAUSES = new Set(["INTERNAL_ERROR", "TIMEOUT_ERROR", "NO_SYNCED_BLOCKS", "NOT_SYNCED_YET"]);

function classify(err: unknown): { kind: RpcFailureKind; message: string; retry: boolean } {
  const e = (err ?? {}) as { name?: string; cause?: { name?: string }; message?: string; data?: unknown };
  const cause = e.cause?.name ?? "";
  const text = `${cause} ${e.message ?? ""} ${typeof e.data === "string" ? e.data : ""}`;
  if (cause === "UNKNOWN_ACCOUNT" || /does not exist while viewing/i.test(text)) return { kind: "UNKNOWN_ACCOUNT", message: text.trim(), retry: false };
  if (cause === "UNKNOWN_BLOCK" || /DB Not Found Error: BLOCK HEIGHT|Block not found/i.test(text)) return { kind: "UNKNOWN_BLOCK", message: text.trim(), retry: false };
  return { kind: "FAILED", message: text.trim() || "RPC error", retry: RETRYABLE_CAUSES.has(cause) };
}

/** Minimal NEAR JSON-RPC client. Browser and Node safe: global fetch and AbortController only. */
export class NearRpcClient {
  /** Number of HTTP requests sent, including retries. */
  calls = 0;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(private readonly opts: NearRpcOptions) {
    const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!f) throw new Error("no fetch available; pass one in NearRpcOptions.fetch");
    this.fetchFn = f;
    this.timeoutMs = opts.timeoutMs ?? PAYEE_CHECK_CONFIG.rpc.timeoutMs;
    this.retries = opts.retries ?? PAYEE_CHECK_CONFIG.rpc.retries;
  }

  async call<T>(method: string, params: Record<string, unknown>, archive = false): Promise<RpcOutcome<T>> {
    const url = archive ? (this.opts.archiveRpcUrl ?? this.opts.rpcUrl) : this.opts.rpcUrl;
    const body = JSON.stringify({ jsonrpc: "2.0", id: "wardline", method, params });
    let last: { kind: RpcFailureKind; message: string } = { kind: "FAILED", message: "not attempted" };
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      this.calls += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ctrl.signal });
        if (!res.ok) {
          last = { kind: "FAILED", message: `HTTP ${res.status}` };
          if (res.status >= 500 || res.status === 429) continue;
          return { ok: false, ...last };
        }
        const json = (await res.json()) as { result?: T & { error?: string }; error?: unknown };
        if (json.error !== undefined) {
          const c = classify(json.error);
          last = c;
          if (c.retry) continue;
          return { ok: false, kind: c.kind, message: c.message };
        }
        // Some nodes report query errors inside result.
        if (json.result && typeof json.result === "object" && typeof json.result.error === "string") {
          const c = classify({ message: json.result.error });
          return { ok: false, kind: c.kind, message: c.message };
        }
        if (json.result === undefined) return { ok: false, kind: "FAILED", message: "empty RPC response" };
        return { ok: true, result: json.result };
      } catch (e) {
        last = { kind: "FAILED", message: ctrl.signal.aborted ? `timed out after ${this.timeoutMs} ms` : e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, ...last };
  }
}

/** Reads RPC urls from an env-like object (in Node, the process environment). QuickNode first, then NEAR_RPC_URL. */
export function nearRpcUrlsFromEnv(env: Record<string, string | undefined>): { rpcUrl: string; archiveRpcUrl: string } | null {
  const rpcUrl = env["QUICKNODE_NEAR_RPC_URL"] || env["NEAR_RPC_URL"];
  if (!rpcUrl) return null;
  return { rpcUrl, archiveRpcUrl: env["NEAR_ARCHIVE_RPC_URL"] || rpcUrl };
}
