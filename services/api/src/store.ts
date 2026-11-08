import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Decision,
  HistoryEntry,
  HistoryKind,
  Intake,
  PaymentStatus,
  ReviewItem,
} from "@redline/schemas";

export interface InvoiceRow {
  intake: Intake;
  decision: Decision | null;
  payable_ref: string | null;
  operation_id: string | null;
  payment_status: PaymentStatus;
}

interface RawInvoice {
  intake_json: string;
  decision_json: string | null;
  payable_ref: string | null;
  operation_id: string | null;
  payment_status: PaymentStatus;
}

const toInvoice = (raw: RawInvoice): InvoiceRow => ({
  intake: JSON.parse(raw.intake_json) as Intake,
  decision: raw.decision_json === null ? null : (JSON.parse(raw.decision_json) as Decision),
  payable_ref: raw.payable_ref,
  operation_id: raw.operation_id,
  payment_status: raw.payment_status,
});

export interface PayeeHold {
  id: string;
  payer: string;
  payee: string;
  domain: string | null;
  vendorName: string | null;
  verdict: string;
  reasons: { code: string; detail: string }[];
  evidenceTier: string;
  amount: string | null;
  asset: string | null;
  source: string | null;
  createdAt: string;
}

interface RawHold {
  id: string;
  payer: string;
  payee: string;
  domain: string | null;
  vendor_name: string | null;
  verdict: string;
  reasons_json: string;
  evidence_tier: string;
  amount: string | null;
  asset: string | null;
  source: string | null;
  created_at: string;
}

export interface ReviewDecision {
  itemId: string;
  kind: string;
  decision: "approved" | "rejected";
  /** The item as it was shown when decided. */
  itemJson: string;
  decidedBy: string;
  decidedAt: string;
  /** The exact text the approver signed, and the key and signature. Null for a rejection. */
  message: string | null;
  publicKey: string | null;
  signature: string | null;
}

const DECISION_SELECT =
  "SELECT item_id AS itemId, kind, decision, item_json AS itemJson, decided_by AS decidedBy, decided_at AS decidedAt, message, public_key AS publicKey, signature FROM review_decisions";

/** Persistence for what the API itself owns. Chain state belongs to the vault gateway. */
export class Store {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        intake_ref TEXT PRIMARY KEY,
        received_at_ns TEXT NOT NULL,
        intake_json TEXT NOT NULL,
        decision_json TEXT,
        payable_ref TEXT,
        operation_id TEXT,
        payment_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_items (
        review_id TEXT PRIMARY KEY,
        intake_ref TEXT NOT NULL UNIQUE REFERENCES invoices (intake_ref),
        item_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        at_ns TEXT NOT NULL,
        summary TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payee_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payer TEXT NOT NULL,
        domain TEXT NOT NULL,
        chain TEXT NOT NULL,
        account TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS payee_payments_lookup ON payee_payments (payer, domain, chain, id);
      CREATE TABLE IF NOT EXISTS api_calls (
        ip TEXT NOT NULL,
        day TEXT NOT NULL,
        calls INTEGER NOT NULL,
        PRIMARY KEY (ip, day)
      );
      CREATE TABLE IF NOT EXISTS auth_challenges (
        nonce TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        role TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        payer TEXT NOT NULL,
        label TEXT,
        calls_per_day INTEGER NOT NULL,
        scopes TEXT NOT NULL DEFAULT 'check',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS api_key_calls (
        key_id TEXT NOT NULL,
        day TEXT NOT NULL,
        calls INTEGER NOT NULL,
        PRIMARY KEY (key_id, day)
      );
      CREATE TABLE IF NOT EXISTS payee_approvals (
        payer TEXT NOT NULL,
        account TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        PRIMARY KEY (payer, account)
      );
      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payee_holds (
        id TEXT PRIMARY KEY,
        payer TEXT NOT NULL,
        payee TEXT NOT NULL,
        domain TEXT,
        vendor_name TEXT,
        verdict TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        evidence_tier TEXT NOT NULL,
        amount TEXT,
        asset TEXT,
        source TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_decisions (
        item_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        decision TEXT NOT NULL,
        item_json TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        message TEXT,
        public_key TEXT,
        signature TEXT
      );
    `);
  }

  // Owner sign-in. Times are Unix milliseconds.

  saveChallenge(challenge: { nonce: string; account: string; message: string; expiresAt: number }, now: number): void {
    this.db.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").run(now);
    this.db
      .prepare("INSERT INTO auth_challenges (nonce, account, message, expires_at) VALUES (?, ?, ?, ?)")
      .run(challenge.nonce, challenge.account, challenge.message, challenge.expiresAt);
  }

  /** Marks a challenge used and returns it, once. Expired, unknown or already used gives null. */
  consumeChallenge(nonce: string, now: number): { account: string; message: string } | null {
    const row = this.db
      .prepare("UPDATE auth_challenges SET used = 1 WHERE nonce = ? AND used = 0 AND expires_at >= ? RETURNING account, message")
      .get(nonce, now) as { account: string; message: string } | undefined;
    return row ?? null;
  }

  saveSession(session: { tokenHash: string; account: string; role: string; expiresAt: number }, now: number): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    this.db
      .prepare("INSERT INTO sessions (token_hash, account, role, expires_at) VALUES (?, ?, ?, ?)")
      .run(session.tokenHash, session.account, session.role, session.expiresAt);
  }

  getSession(tokenHash: string, now: number): { account: string; role: string; expiresAt: number } | null {
    const row = this.db
      .prepare("SELECT account, role, expires_at AS expiresAt FROM sessions WHERE token_hash = ? AND expires_at >= ?")
      .get(tokenHash, now) as { account: string; role: string; expiresAt: number } | undefined;
    return row ?? null;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  // API keys. Only the sha256 of a key is stored.

  saveApiKey(key: { id: string; keyHash: string; payer: string; label: string | null; callsPerDay: number; scopes: readonly string[]; createdBy: string; createdAt: string }): void {
    this.db
      .prepare(
        "INSERT INTO api_keys (id, key_hash, payer, label, calls_per_day, scopes, created_by, created_at) VALUES (@id, @keyHash, @payer, @label, @callsPerDay, @scopes, @createdBy, @createdAt)",
      )
      .run({ ...key, scopes: key.scopes.join(",") });
  }

  findApiKey(keyHash: string): { id: string; payer: string; callsPerDay: number; scopes: string[] } | null {
    const row = this.db
      .prepare("SELECT id, payer, calls_per_day AS callsPerDay, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
      .get(keyHash) as { id: string; payer: string; callsPerDay: number; scopes: string } | undefined;
    return row ? { ...row, scopes: row.scopes.split(",") } : null;
  }

  listApiKeys(): { id: string; payer: string; label: string | null; callsPerDay: number; scopes: string[]; createdBy: string; createdAt: string; revokedAt: string | null }[] {
    const rows = this.db
      .prepare(
        "SELECT id, payer, label, calls_per_day AS callsPerDay, scopes, created_by AS createdBy, created_at AS createdAt, revoked_at AS revokedAt FROM api_keys ORDER BY created_at",
      )
      .all() as (Omit<ReturnType<Store["listApiKeys"]>[number], "scopes"> & { scopes: string })[];
    return rows.map((row) => ({ ...row, scopes: row.scopes.split(",") }));
  }

  revokeApiKey(id: string, at: string): boolean {
    return this.db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, id).changes > 0;
  }

  /** Adds one call for this key and day, and returns the new count. */
  countKeyCall(keyId: string, day: string): number {
    const row = this.db
      .prepare("INSERT INTO api_key_calls (key_id, day, calls) VALUES (?, ?, 1) ON CONFLICT (key_id, day) DO UPDATE SET calls = calls + 1 RETURNING calls")
      .get(keyId, day) as { calls: number };
    return row.calls;
  }

  // Payee relationships, for T3_RELATIONSHIP.

  approvePayee(approval: { payer: string; account: string; approvedBy: string; approvedAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO payee_approvals (payer, account, approved_by, approved_at) VALUES (@payer, @account, @approvedBy, @approvedAt)
         ON CONFLICT (payer, account) DO UPDATE SET approved_by = excluded.approved_by, approved_at = excluded.approved_at`,
      )
      .run(approval);
  }

  /** True when an owner approved this account for this payer, or the payer has paid it before. */
  hasRelationship(payer: string, account: string): boolean {
    const approved = this.db.prepare("SELECT 1 FROM payee_approvals WHERE payer = ? AND account = ?").get(payer, account);
    if (approved) return true;
    return Boolean(this.db.prepare("SELECT 1 FROM payee_payments WHERE payer = ? AND account = ? LIMIT 1").get(payer, account));
  }

  /** Records a signature nonce. False if it was already used, so the signature is a replay. */
  useNonce(nonce: string, expiresAt: number, now: number): boolean {
    this.db.prepare("DELETE FROM used_nonces WHERE expires_at < ?").run(now);
    return this.db.prepare("INSERT OR IGNORE INTO used_nonces (nonce, expires_at) VALUES (?, ?)").run(nonce, expiresAt).changes > 0;
  }

  // Review Desk: payee checks that came back HOLD on a payer's key, and signed decisions.

  /** Saves a HOLD, or refreshes the undecided one for the same payer, payee and domain. Returns its id. */
  saveHold(hold: PayeeHold): string {
    const open = this.db
      .prepare(
        `SELECT h.id FROM payee_holds h LEFT JOIN review_decisions d ON d.item_id = h.id
         WHERE h.payer = ? AND h.payee = ? AND h.domain IS ? AND d.item_id IS NULL`,
      )
      .get(hold.payer, hold.payee, hold.domain) as { id: string } | undefined;
    const id = open?.id ?? hold.id;
    this.db
      .prepare(
        `INSERT INTO payee_holds (id, payer, payee, domain, vendor_name, verdict, reasons_json, evidence_tier, amount, asset, source, created_at)
         VALUES (@id, @payer, @payee, @domain, @vendorName, @verdict, @reasonsJson, @evidenceTier, @amount, @asset, @source, @createdAt)
         ON CONFLICT (id) DO UPDATE SET vendor_name = excluded.vendor_name, verdict = excluded.verdict, reasons_json = excluded.reasons_json,
           evidence_tier = excluded.evidence_tier, amount = excluded.amount, asset = excluded.asset, source = excluded.source, created_at = excluded.created_at`,
      )
      .run({ ...hold, id, reasonsJson: JSON.stringify(hold.reasons) });
    return id;
  }

  listHolds(): PayeeHold[] {
    const rows = this.db.prepare("SELECT * FROM payee_holds ORDER BY created_at DESC").all() as RawHold[];
    return rows.map((r) => ({
      id: r.id,
      payer: r.payer,
      payee: r.payee,
      domain: r.domain,
      vendorName: r.vendor_name,
      verdict: r.verdict,
      reasons: JSON.parse(r.reasons_json) as PayeeHold["reasons"],
      evidenceTier: r.evidence_tier,
      amount: r.amount,
      asset: r.asset,
      source: r.source,
      createdAt: r.created_at,
    }));
  }

  /** Records a decision once. False if the item was already decided. */
  saveDecision(decision: ReviewDecision): boolean {
    return (
      this.db
        .prepare(
          `INSERT OR IGNORE INTO review_decisions (item_id, kind, decision, item_json, decided_by, decided_at, message, public_key, signature)
           VALUES (@itemId, @kind, @decision, @itemJson, @decidedBy, @decidedAt, @message, @publicKey, @signature)`,
        )
        .run(decision).changes > 0
    );
  }

  getDecision(itemId: string): ReviewDecision | null {
    const row = this.db.prepare(DECISION_SELECT + " WHERE item_id = ?").get(itemId) as ReviewDecision | undefined;
    return row ?? null;
  }

  listDecisions(): ReviewDecision[] {
    return this.db.prepare(DECISION_SELECT + " ORDER BY decided_at DESC, item_id").all() as ReviewDecision[];
  }

  reset(): void {
    this.db.exec("DELETE FROM review_items; DELETE FROM invoices; DELETE FROM history; DELETE FROM payee_holds; DELETE FROM review_decisions;");
  }

  close(): void {
    this.db.close();
  }

  recordPayment(payment: { payer: string; domain: string; chain: string; account: string; at: string }): void {
    this.db
      .prepare("INSERT INTO payee_payments (payer, domain, chain, account, recorded_at) VALUES (@payer, @domain, @chain, @account, @at)")
      .run(payment);
  }

  lastPaidAccount(payer: string, domain: string, chain: string): string | null {
    const row = this.db
      .prepare("SELECT account FROM payee_payments WHERE payer = ? AND domain = ? AND chain = ? ORDER BY id DESC LIMIT 1")
      .get(payer, domain, chain) as { account: string } | undefined;
    return row?.account ?? null;
  }

  /** Adds one call for this IP and day, and returns the new count. */
  countCall(ip: string, day: string): number {
    const row = this.db
      .prepare("INSERT INTO api_calls (ip, day, calls) VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET calls = calls + 1 RETURNING calls")
      .get(ip, day) as { calls: number };
    return row.calls;
  }

  saveInvoice(row: InvoiceRow): void {
    this.db
      .prepare(
        `INSERT INTO invoices (intake_ref, received_at_ns, intake_json, decision_json, payable_ref, operation_id, payment_status)
         VALUES (@intake_ref, @received_at_ns, @intake_json, @decision_json, @payable_ref, @operation_id, @payment_status)
         ON CONFLICT (intake_ref) DO UPDATE SET
           decision_json = excluded.decision_json,
           payable_ref = excluded.payable_ref,
           operation_id = excluded.operation_id,
           payment_status = excluded.payment_status`,
      )
      .run({
        intake_ref: row.intake.intake_ref,
        received_at_ns: row.intake.received_at_ns,
        intake_json: JSON.stringify(row.intake),
        decision_json: row.decision === null ? null : JSON.stringify(row.decision),
        payable_ref: row.payable_ref,
        operation_id: row.operation_id,
        payment_status: row.payment_status,
      });
  }

  getInvoice(intakeRef: string): InvoiceRow | null {
    const raw = this.db.prepare("SELECT * FROM invoices WHERE intake_ref = ?").get(intakeRef) as RawInvoice | undefined;
    return raw ? toInvoice(raw) : null;
  }

  listInvoices(): InvoiceRow[] {
    const rows = this.db
      .prepare("SELECT * FROM invoices ORDER BY CAST(received_at_ns AS INTEGER) DESC, intake_ref DESC")
      .all() as RawInvoice[];
    return rows.map(toInvoice);
  }

  saveReview(item: ReviewItem): void {
    this.db
      .prepare(
        `INSERT INTO review_items (review_id, intake_ref, item_json) VALUES (?, ?, ?)
         ON CONFLICT (review_id) DO UPDATE SET item_json = excluded.item_json`,
      )
      .run(item.review_id, item.intake_ref, JSON.stringify(item));
  }

  getReview(reviewId: string): ReviewItem | null {
    const row = this.db.prepare("SELECT item_json FROM review_items WHERE review_id = ?").get(reviewId) as
      | { item_json: string }
      | undefined;
    return row ? (JSON.parse(row.item_json) as ReviewItem) : null;
  }

  getReviewForIntake(intakeRef: string): ReviewItem | null {
    const row = this.db.prepare("SELECT item_json FROM review_items WHERE intake_ref = ?").get(intakeRef) as
      | { item_json: string }
      | undefined;
    return row ? (JSON.parse(row.item_json) as ReviewItem) : null;
  }

  listReviews(): ReviewItem[] {
    const rows = this.db.prepare("SELECT item_json FROM review_items").all() as { item_json: string }[];
    return rows.map((r) => JSON.parse(r.item_json) as ReviewItem);
  }

  addHistory(kind: HistoryKind, atNs: string, summary: string): void {
    this.db.prepare("INSERT INTO history (kind, at_ns, summary) VALUES (?, ?, ?)").run(kind, atNs, summary);
  }

  listHistory(kind: HistoryKind): HistoryEntry[] {
    return this.db
      .prepare("SELECT id, kind, at_ns, summary FROM history WHERE kind = ? ORDER BY id DESC")
      .all(kind) as HistoryEntry[];
  }
}
