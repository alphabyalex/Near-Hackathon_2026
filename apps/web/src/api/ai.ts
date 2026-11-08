/** Metered AI calls, the group's shared budget, Wardline Mutual and the demo scenes. */

import { apiGet, apiPost } from "./client";

export interface MemberView {
  member: string;
  allowance: string;
  used: string;
  reserved: string;
}

export interface BudgetView {
  budget_id: string;
  name: string;
  owner: string;
  deposit: string;
  spent: string;
  reserved: string;
  period: "day" | "week" | "month";
  period_start: string;
  members: MemberView[];
}

export interface CallView {
  call_id: string;
  member: string;
  model_claimed: string;
  model_proven: string | null;
  status: "verified" | "refused" | "failed" | "pending";
  reason: string | null;
  detail: string | null;
  reserved: string;
  amount: string;
  refund: string;
  chat_id: string | null;
  settlement_tx: string | null;
  release_tx: string | null;
  created_at: string;
}

export interface ProposalView {
  id: number;
  dao: string;
  proposer: string;
  description: string;
  status: string;
  submittedAt: string;
  approvals: number;
  rejections: number;
  action: { type: string } | null;
  transfer: { token_id: string; receiver_id: string; amount: string } | null;
}

export interface PayoutView {
  proposal: number;
  description: string;
  proposer: string;
  receiver: string;
  amount: string;
  domain: string | null;
  verdict: "PAY" | "HOLD" | "BLOCK";
  evidenceTier: string;
  reasons: { code: string; detail: string }[];
  flagged: boolean;
}

export interface AttestedModel {
  model_id: string;
  signing_address: string;
  source: string;
}

export interface GroupView {
  mode: "sim" | "near";
  dao: string;
  budget: BudgetView;
  calls: CallView[];
  proposals: ProposalView[];
  payouts: PayoutView[];
  models: AttestedModel[];
  routes: { id: string; label: string }[];
}

export interface AiOverview {
  verifiedCalls: number;
  refusedCalls: number;
  failedCalls: number;
  spent: string;
  refunded: string;
  series: { day: string; spent: string; refunded: string; verified: number; refused: number }[];
}

export interface MeterKeyRow {
  id: string;
  prefix: string;
  budgetId: string;
  member: string;
  label: string;
  models: string[] | null;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
}

export const createMeterKey = (body: { member: string; label?: string; models?: string[] }) => apiPost<{ key: string; row: MeterKeyRow }>("/owner/meter-keys", body);
export const revokeMeterKey = (id: string) => apiPost<{ revoked: string }>(`/owner/meter-keys/${encodeURIComponent(id)}/revoke`, {});

export interface PoolView {
  tvl: string;
  junior: string;
  senior: string;
  junior_holder: string;
  share_price: string;
  senior_shares: string;
  fees_earned: string;
  claims_paid: string;
  coverage_capacity: string;
  withdraw_delay_days: number;
  large_claim_threshold: string;
}

export interface ClaimView {
  claim_id: string;
  subject: string;
  claimant: string;
  amount: string;
  reason: string;
  status: "paid" | "pending_vote" | "rejected";
  paid_from_junior: string;
  paid_from_senior: string;
  filed_at: string;
  tx: string | null;
}

export interface PoolPosition {
  account: string;
  shares: string;
  value: string;
  pending_withdrawals: { id: string; shares: string; value: string; requested_at: string; available_at: string }[];
}

export const getPool = () => apiGet<{ mode: "sim" | "near"; contract: string; pool: PoolView; claims: ClaimView[] }>("/v1/pool");
export const getPosition = (account: string) => apiGet<PoolPosition>(`/v1/pool/positions/${encodeURIComponent(account)}`);
export const poolChallenge = (body: { account: string; action: "deposit" | "withdraw"; amount: string }) =>
  apiPost<{ message: string; recipient: string; nonce: string; expiresAt: string }>("/v1/pool/challenge", body);
export const poolSubmit = (body: { nonce: string; publicKey: string; signature: string }) =>
  apiPost<{ action: string; tx: string; available_at?: string; position: PoolPosition }>("/v1/pool/submit", body);

export type SceneName = "plugin" | "swap" | "leak" | "invoice" | "mutual";
export const runDemoScene = <T,>(name: SceneName) => apiPost<T>(`/v1/demo/${name}`);

/** Whole WUSD typed by a person, to atomic units. Up to six decimal places. */
export function toAtomic(text: string): string | null {
  const m = /^\s*(\d{1,12})(?:\.(\d{1,6}))?\s*$/.exec(text);
  if (!m) return null;
  const value = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return value > 0n ? value.toString() : null;
}
