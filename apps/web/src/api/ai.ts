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

export type Tier = "bronze" | "silver" | "gold";

export interface ReputationView {
  budget_id: string;
  name: string;
  owner: string;
  tier: Tier;
  proven_calls: number;
  refused_calls: number;
  capped_calls: number;
  blocked_payees: number;
  claims: number;
  clean_calls: number;
  next_tier_at: number | null;
  fee_bps: number;
  coverage_cap: string;
  spent: string;
  fees_paid: string;
}

export interface TierRule {
  tier: Tier;
  fee_bps: number;
  coverage: string;
  promote_after: number | null;
}

export interface TierRules {
  rules: TierRule[];
  coverage_multiplier_bps: number;
}

export interface GroupSummary extends ReputationView {
  deposit: string;
  members: number;
  period: string | null;
}

export type MutualAction =
  | { type: "set_fee_bps"; tier: Tier; fee_bps: number }
  | { type: "set_coverage_multiplier"; multiplier_bps: number }
  | { type: "cover_model"; model_id: string; signing_address: string }
  | { type: "uncover_model"; model_id: string }
  | { type: "approve_payout"; claim_id: string };

export interface MutualProposalView {
  id: number;
  proposer: string;
  description: string;
  action: MutualAction;
  snapshot_at: string;
  snapshot_supply: string;
  votes_for: string;
  votes_against: string;
  voters: number;
  quorum: string;
  opens_at: string;
  closes_at: string;
  status: "open" | "passed" | "rejected" | "executed";
  executed_at: string | null;
  tx: string | null;
}

export interface MutualSummary {
  mode: "sim" | "near";
  mutual_mode: "sim" | "near";
  contract: string;
  /** Smallest deposit, atomic USDC. */
  min_deposit: string;
  pool: PoolView;
  claims: ClaimView[];
  stats: { total_pooled: string; ward_price: string; launch_price: string; yield_earned: string; groups_covered: number; proven_payments: number; payouts: number; below: { swapped: number; lookalike: number; capped: number; total: number } };
  groups: GroupSummary[];
  tiers: TierRules;
  governance: { quorum_bps: number; voting_days: number; proposals: MutualProposalView[] };
}

export interface GroupView {
  mode: "sim" | "near";
  reputation: ReputationView | null;
  tiers: TierRules;
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

export interface WardPricePoint {
  at: string;
  price: string;
  event: "launch" | "deposit" | "fees" | "claim" | "redeem" | "first_loss";
}

export interface PoolView {
  tvl: string;
  junior: string;
  senior: string;
  junior_holder: string;
  ward_symbol: string;
  ward_name: string;
  ward_supply: string;
  ward_price: string;
  launch_price: string;
  price_history: WardPricePoint[];
  fees_earned: string;
  claims_paid: string;
  coverage_capacity: string;
  withdraw_delay_days: number;
  large_claim_threshold: string;
  trade_url: string | null;
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
  ward_price_before: string;
  ward_price_after: string;
  filed_at: string;
  tx: string | null;
}

export interface PoolPosition {
  account: string;
  ward: string;
  ward_locked: string;
  value: string;
  pending_withdrawals: { id: string; ward: string; value: string; requested_at: string; available_at: string }[];
  deposited?: string;
  redeemed?: string;
  joined_at?: string | null;
}

export const getPool = () => apiGet<{ mode: "sim" | "near"; contract: string; pool: PoolView; claims: ClaimView[] }>("/v1/pool");
export const getPosition = (account: string) => apiGet<PoolPosition>(`/v1/pool/positions/${encodeURIComponent(account)}`);
export type PoolRequest =
  | { account: string; action: "deposit" | "withdraw"; amount: string }
  | { account: string; action: "redeem"; id: string }
  | { account: string; action: "vote"; id: number; support: "for" | "against" }
  | { account: string; action: "propose"; description: string; proposal: MutualAction };
export const poolChallenge = (body: PoolRequest) => apiPost<{ message: string; recipient: string; nonce: string; expiresAt: string }>("/v1/pool/challenge", body);
export const poolSubmit = (body: { nonce: string; publicKey: string; signature: string }) =>
  apiPost<{ action: string; tx?: string; ward?: string; usdc?: string; available_at?: string; position?: PoolPosition; proposal?: MutualProposalView }>("/v1/pool/submit", body);

export interface ProofRow {
  call_id: string;
  budget_id: string;
  group: string;
  side: "above" | "below";
  status: "verified" | "refused" | "failed" | "pending";
  reason: string | null;
  model_claimed: string;
  model_proven: string | null;
  amount: string;
  refund: string;
  created_at: string;
  tx?: string | null;
}
export const getProofs = (limit = 12) => apiGet<{ mode: "sim" | "near"; proofs: ProofRow[] }>(`/v1/proofs?limit=${limit}`);
export const getMutual = () => apiGet<MutualSummary>("/v1/mutual");
export const getGroups = () => apiGet<{ mode: "sim" | "near"; groups: GroupSummary[]; tiers: TierRules }>("/v1/groups");
export const getVoteWeight = (id: number, account: string) => apiGet<{ weight: string }>(`/v1/mutual/proposals/${id}/weight/${encodeURIComponent(account)}`);
export const executeProposal = (id: number) => apiPost<{ proposal: MutualProposalView }>(`/v1/mutual/proposals/${id}/execute`, {});

export type SceneName = "mutual" | "group" | "swap" | "leak" | "invoice" | "payout" | "tier";
export const runDemoScene = <T,>(name: SceneName) => apiPost<T>(`/v1/demo/${name}`);

/** Whole USDC typed by a person, to atomic units. Up to six decimal places. */
export function toAtomic(text: string): string | null {
  const m = /^\s*(\d{1,12})(?:\.(\d{1,6}))?\s*$/.exec(text);
  if (!m) return null;
  const value = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return value > 0n ? value.toString() : null;
}
