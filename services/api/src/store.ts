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
    `);
  }

  reset(): void {
    this.db.exec("DELETE FROM review_items; DELETE FROM invoices; DELETE FROM history;");
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
