/**
 * The testnet activity log's rules, shared by the batch writer (scripts/testnet), the audit and the API.
 *
 * A row exists only because a transaction exists: its hash, signer, block height and time are copied
 * from what NEAR RPC returned for that hash, never from the caller. The API serves only the prefix of
 * the log that `pnpm testnet:audit` last checked against the chain, pinned by that prefix's sha256.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A NEAR transaction hash: base58 of 32 bytes. */
export const CHAIN_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export type ActivityKind = "call" | "payout" | "price" | "deposit" | "redeem" | "vote" | "proposal";
export type ActivityOutcome = "paid" | "refused" | "blocked" | "capped" | "voted" | "opened" | "executed";

/** What the caller says the transaction meant. Everything else on a row comes from RPC. */
export interface RowFields {
  actor: string;
  community: string;
  kind: ActivityKind;
  amount: string | null;
  model: string | null;
  outcome: ActivityOutcome;
  side: "above" | "below";
  reason: string | null;
  text: string;
}

export interface ActivityRow extends RowFields {
  at: string;
  tx: string;
  block_height: number;
  signer: string;
  receiver: string;
}

/** A JSON-RPC call to NEAR. Returns `result`, throws on `error`. */
export type Rpc = (method: string, params: unknown) => Promise<any>;

export function makeRpc(urls: readonly string[], timeoutMs = 15_000): Rpc {
  return async (method, params) => {
    let last: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: "wardline", method, params }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.status === 429 || res.status >= 500) {
            last = new Error(`${url} answered HTTP ${res.status}`);
            continue;
          }
          const body = (await res.json()) as { result?: unknown; error?: { name?: string; cause?: { name?: string }; message?: string; data?: unknown } };
          if (body.error) {
            const name = body.error.cause?.name ?? body.error.name ?? "RPC_ERROR";
            // A definite answer (unknown account, unknown transaction) is not retried.
            // TIMEOUT_ERROR and UNKNOWN_BLOCK mean this node does not observe historical blocks/txs, but an archival node does.
            const definite = name !== "TIMEOUT_ERROR" && name !== "UNKNOWN_BLOCK";
            throw Object.assign(new Error(`${method}: ${name}${body.error.data ? ` (${JSON.stringify(body.error.data).slice(0, 160)})` : ""}`), { rpcName: name, definite });
          }
          return body.result;
        } catch (error) {
          if ((error as { definite?: boolean }).definite) throw error;
          last = error;
        }
      }
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
    throw last instanceof Error ? last : new Error(`${method}: RPC unreachable`);
  };
}

/**
 * Builds a row from the chain. Throws unless RPC knows the transaction, it did not fail, and its first
 * receipt's block exists. The block height and time come from that block.
 */
export async function rowFromChain(rpc: Rpc, hash: string, signer: string, fields: RowFields): Promise<ActivityRow> {
  if (!CHAIN_HASH.test(hash)) throw new Error(`Not a NEAR transaction hash: ${JSON.stringify(hash)}`);
  const tx = await rpc("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" });
  if (!tx?.transaction || tx.transaction.hash !== hash) throw new Error(`RPC returned no transaction ${hash}`);
  if (tx.transaction.signer_id !== signer) throw new Error(`Transaction ${hash} was signed by ${tx.transaction.signer_id}, not ${signer}`);
  const status = tx.status ?? {};
  if (typeof status !== "object" || !("SuccessValue" in status)) throw new Error(`Transaction ${hash} did not succeed: ${JSON.stringify(status).slice(0, 200)}`);
  const receipt = tx.receipts_outcome?.[0];
  if (!receipt?.block_hash) throw new Error(`Transaction ${hash} has no receipt`);
  const block = await rpc("block", { block_id: receipt.block_hash });
  const height = block?.header?.height;
  if (!Number.isInteger(height) || height <= 0) throw new Error(`Block ${receipt.block_hash} has no height`);
  const at = new Date(Number(BigInt(block.header.timestamp) / 1_000_000n)).toISOString();
  return { at, ...fields, tx: hash, block_height: height, signer: tx.transaction.signer_id, receiver: tx.transaction.receiver_id };
}

/** True when a parsed row has the shape only rowFromChain produces. The audit checks it is also true. */
export function isChainRow(row: unknown): row is ActivityRow {
  const r = row as Partial<ActivityRow> | null;
  return Boolean(
    r && typeof r.tx === "string" && CHAIN_HASH.test(r.tx) && Number.isInteger(r.block_height) && (r.block_height ?? 0) > 0 &&
      typeof r.signer === "string" && typeof r.receiver === "string" && typeof r.at === "string" && typeof r.actor === "string",
  );
}

/** Written by a passing audit: the first `rows` lines of the log, pinned by their sha256. */
export interface AuditStamp {
  passed: true;
  at: string;
  rows: number;
  sha256: string;
  rpc: string;
}

export function logLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function prefixHash(lines: readonly string[], n: number): string {
  return createHash("sha256").update(lines.slice(0, n).join("\n")).digest("hex");
}

/**
 * The rows an audit has passed. `audited` is false when no stamp exists, it is malformed, or the log no
 * longer starts with the lines it pinned (edited or truncated); then no rows are returned at all.
 */
export function auditedRows(logText: string | null, stampText: string | null): { audited: boolean; rows: ActivityRow[]; pending: number; reason?: string } {
  const lines = logText ? logLines(logText) : [];
  if (!stampText) return { audited: false, rows: [], pending: lines.length, reason: "The activity log has never passed pnpm testnet:audit." };
  let stamp: Partial<AuditStamp>;
  try {
    stamp = JSON.parse(stampText) as Partial<AuditStamp>;
  } catch {
    return { audited: false, rows: [], pending: lines.length, reason: "The audit stamp is not JSON." };
  }
  if (stamp.passed !== true || !Number.isInteger(stamp.rows) || typeof stamp.sha256 !== "string") return { audited: false, rows: [], pending: lines.length, reason: "The audit stamp is malformed." };
  const n = stamp.rows!;
  if (n > lines.length || prefixHash(lines, n) !== stamp.sha256) return { audited: false, rows: [], pending: lines.length, reason: "The activity log changed after its last audit." };
  const rows: ActivityRow[] = [];
  for (const line of lines.slice(0, n)) {
    const row = JSON.parse(line) as unknown;
    if (!isChainRow(row)) return { audited: false, rows: [], pending: lines.length, reason: "An audited row is not a chain row." };
    rows.push(row);
  }
  return { audited: true, rows, pending: lines.length - n };
}

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** data/testnet/activity.jsonl and audit.json, or WARDLINE_ACTIVITY_LOG and WARDLINE_ACTIVITY_AUDIT. */
export function activityPaths(env: Record<string, string | undefined> = process.env): { log: string; audit: string } {
  const dir = existsSync(join(REPO_ROOT, "data/testnet")) ? join(REPO_ROOT, "data/testnet") : join(process.cwd(), "data/testnet");
  return { log: env.WARDLINE_ACTIVITY_LOG ?? join(dir, "activity.jsonl"), audit: env.WARDLINE_ACTIVITY_AUDIT ?? join(dir, "audit.json") };
}

export function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
