/** Meter keys (stored as sha256 hashes) and the log of every metered AI call. */

import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export interface MeterKeyRow {
  id: string;
  prefix: string;
  budgetId: string;
  member: string;
  label: string;
  /** Allowed model ids, or null for every routed model. */
  models: string[] | null;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
}

export type CallStatus = "verified" | "refused" | "failed" | "pending";

export interface CallRow {
  callId: string;
  keyId: string;
  budgetId: string;
  member: string;
  modelClaimed: string;
  modelProven: string | null;
  provider: string;
  status: CallStatus;
  reason: string | null;
  detail: string | null;
  reserved: string;
  amount: string;
  refund: string;
  requestHash: string | null;
  responseHash: string | null;
  chatId: string | null;
  signer: string | null;
  /** The signed text and signature, so anyone can re-check the call later. */
  proofText: string | null;
  proofSignature: string | null;
  settlementTx: string | null;
  releaseTx: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
  latencyMs: number | null;
}

const KEY_SELECT = "SELECT id, prefix, budget_id AS budgetId, member, label, models, created_at AS createdAt, created_by AS createdBy, revoked_at AS revokedAt FROM meter_keys";
const CALL_COLUMNS: [keyof CallRow, string][] = [
  ["callId", "call_id"], ["keyId", "key_id"], ["budgetId", "budget_id"], ["member", "member"], ["modelClaimed", "model_claimed"], ["modelProven", "model_proven"],
  ["provider", "provider"], ["status", "status"], ["reason", "reason"], ["detail", "detail"], ["reserved", "reserved"], ["amount", "amount"], ["refund", "refund"],
  ["requestHash", "request_hash"], ["responseHash", "response_hash"], ["chatId", "chat_id"], ["signer", "signer"], ["proofText", "proof_text"], ["proofSignature", "proof_signature"], ["settlementTx", "settlement_tx"],
  ["releaseTx", "release_tx"], ["promptTokens", "prompt_tokens"], ["completionTokens", "completion_tokens"], ["createdAt", "created_at"], ["latencyMs", "latency_ms"],
];
const CALL_SELECT = `SELECT ${CALL_COLUMNS.map(([k, c]) => `${c} AS ${k}`).join(", ")} FROM ai_calls`;

export const hashMeterKey = (key: string): string => createHash("sha256").update(key).digest("hex");

const toKey = (raw: Omit<MeterKeyRow, "models"> & { models: string | null }): MeterKeyRow => ({ ...raw, models: raw.models === null ? null : (JSON.parse(raw.models) as string[]) });

export class MeterStore {
  constructor(private readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meter_keys (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        budget_id TEXT NOT NULL,
        member TEXT NOT NULL,
        label TEXT NOT NULL,
        models TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS ai_calls (
        call_id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        budget_id TEXT NOT NULL,
        member TEXT NOT NULL,
        model_claimed TEXT NOT NULL,
        model_proven TEXT,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        detail TEXT,
        reserved TEXT NOT NULL,
        amount TEXT NOT NULL,
        refund TEXT NOT NULL,
        request_hash TEXT,
        response_hash TEXT,
        chat_id TEXT,
        signer TEXT,
        proof_text TEXT,
        proof_signature TEXT,
        settlement_tx TEXT,
        release_tx TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        created_at TEXT NOT NULL,
        latency_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS ai_calls_budget ON ai_calls (budget_id, created_at);
    `);
  }

  reset(): void {
    this.db.exec("DELETE FROM meter_keys; DELETE FROM ai_calls;");
  }

  /** Returns the key once. Only its hash is stored. */
  createKey(args: { budgetId: string; member: string; label: string; models: string[] | null; createdBy: string; now: Date; key?: string }): { key: string; row: MeterKeyRow } {
    if (args.key !== undefined && !/^wk_[A-Za-z0-9_-]{8,64}$/.test(args.key)) throw new Error("A meter key is wk_ followed by 8 to 64 letters, digits, _ or -.");
    const key = args.key ?? `wk_${randomBytes(24).toString("base64url")}`;
    const id = `mk_${randomBytes(6).toString("hex")}`;
    const row: MeterKeyRow = { id, prefix: key.slice(0, 9), budgetId: args.budgetId, member: args.member, label: args.label, models: args.models, createdAt: args.now.toISOString(), createdBy: args.createdBy, revokedAt: null };
    this.db
      .prepare("INSERT INTO meter_keys (id, hash, prefix, budget_id, member, label, models, created_at, created_by, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)")
      .run(id, hashMeterKey(key), row.prefix, row.budgetId, row.member, row.label, row.models === null ? null : JSON.stringify(row.models), row.createdAt, row.createdBy);
    return { key, row };
  }

  findKey(key: string): MeterKeyRow | null {
    const raw = this.db.prepare(`${KEY_SELECT} WHERE hash = ?`).get(hashMeterKey(key)) as (Omit<MeterKeyRow, "models"> & { models: string | null }) | undefined;
    return raw ? toKey(raw) : null;
  }

  listKeys(): MeterKeyRow[] {
    return (this.db.prepare(`${KEY_SELECT} ORDER BY created_at DESC, id`).all() as (Omit<MeterKeyRow, "models"> & { models: string | null })[]).map(toKey);
  }

  revokeKey(id: string, now: Date): boolean {
    return this.db.prepare("UPDATE meter_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now.toISOString(), id).changes > 0;
  }

  saveCall(row: CallRow): void {
    const cols = CALL_COLUMNS.map(([, c]) => c);
    this.db
      .prepare(`INSERT OR REPLACE INTO ai_calls (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      .run(...CALL_COLUMNS.map(([k]) => row[k] as string | number | null));
  }

  getCall(callId: string): CallRow | null {
    return (this.db.prepare(`${CALL_SELECT} WHERE call_id = ?`).get(callId) as CallRow | undefined) ?? null;
  }

  listCalls(budgetId?: string, limit = 200): CallRow[] {
    return budgetId
      ? (this.db.prepare(`${CALL_SELECT} WHERE budget_id = ? ORDER BY created_at DESC, call_id DESC LIMIT ?`).all(budgetId, limit) as CallRow[])
      : (this.db.prepare(`${CALL_SELECT} ORDER BY created_at DESC, call_id DESC LIMIT ?`).all(limit) as CallRow[]);
  }
}
