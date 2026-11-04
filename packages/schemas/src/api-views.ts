import { z } from "zod";
import type { AgentBinding } from "./agent-binding.js";
import type { Decision, DecisionKind } from "./decision.js";
import type { EvaluationReport } from "./evaluation-report.js";
import type { GoodsReceipt } from "./goods-receipt.js";
import type { Intake } from "./intake.js";
import type { Manifest } from "./manifest.js";
import type { Operation } from "./operation.js";
import type { Payable } from "./payable.js";
import type { Policy } from "./policy.js";
import type { PurchaseOrder } from "./purchase-order.js";
import type { ReportVerification } from "./report-verification.js";
import type { ReviewItem, ReviewStatus } from "./review-item.js";
import type { Vendor } from "./vendor.js";
import type { VaultUsage } from "./vault-usage.js";

/** The only status words the UI may show. */
export const PaymentStatusSchema = z.enum([
  "requested",
  "reserved",
  "settled",
  "rejected by policy",
  "review needed",
  "flagged",
  "outcome uncertain",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export interface TokenInfo {
  symbol: string;
  contract_id: string;
  decimals: number;
  network: "NEAR testnet";
}

export type DataSource = "mock" | "live";

export interface UnresolvedPayment {
  intake_ref: string;
  payable_ref: string;
  payment_status: PaymentStatus;
  amount_atomic: string;
  operation_id: string | null;
}

export interface OverviewView {
  data_source: DataSource;
  vault_id: string;
  token: TokenInfo;
  manifest: Manifest;
  binding: AgentBinding | null;
  policy: Policy;
  vendors: Vendor[];
  usage: VaultUsage;
  headroom: { weekly_atomic: string; lifetime_atomic: string };
  unresolved_payments: UnresolvedPayment[];
}

export interface InvoiceSummary {
  intake_ref: string;
  received_at_ns: string;
  excerpt: string;
  invoice_number: string | null;
  vendor_name: string | null;
  amount_atomic: string | null;
  due_at_ns: string | null;
  decision: DecisionKind | null;
  payment_status: PaymentStatus;
  review_status: ReviewStatus | null;
}

export interface InvoiceDetail {
  intake: Intake;
  decision: Decision | null;
  payable: Payable | null;
  vendor: Vendor | null;
  purchase_order: PurchaseOrder | null;
  receipt: GoodsReceipt | null;
  operation: Operation | null;
  payment_status: PaymentStatus;
  review: ReviewItem | null;
}

export interface ReviewQueueEntry extends ReviewItem {
  excerpt: string;
  amount_atomic: string | null;
  payment_status: PaymentStatus;
  due_within_48h: boolean;
  /** When set, the owner cannot pay or reject this item yet, and this says why. */
  owner_pay_blocked_reason: string | null;
}

export interface EvaluationSummary {
  run_id: string;
  issuer: string;
  execution_status: EvaluationReport["execution_status"];
  assessment_outcome: EvaluationReport["assessment_outcome"];
  manifest_digest: string;
  suite_commitment: string;
}

export interface EvaluationDetail {
  report: EvaluationReport;
  verification: ReportVerification;
}

export type HistoryKind = "POLICY" | "AGENT" | "INCIDENT";

export interface HistoryEntry {
  id: number;
  kind: HistoryKind;
  at_ns: string;
  summary: string;
}

export interface HistoryView {
  vendors: Vendor[];
  policy: Policy;
  policy_changes: HistoryEntry[];
  agent_events: HistoryEntry[];
  incidents: HistoryEntry[];
}

export interface ApiError {
  error: string;
  message: string;
  rejection?: string;
}
