/**
 * What the API needs from Tharun's contracts: the meter (budgets, reserve, settle, release), the
 * model registry (which TEE signer is attested for which model) and the cover pool (Wardline Mutual).
 * WARDLINE_CHAIN_MODE=sim uses the simulations in this folder. WARDLINE_CHAIN_MODE=near uses his typed
 * clients once packages/vault-client exports them with these method names.
 * TODO(tharun): confirm names and shapes against SHARED INTERFACES in docs/status/tharun.md.
 *
 * Amounts are atomic WUSD (6 decimals) as decimal strings. Times are ISO 8601.
 */

export type ChainMode = "sim" | "near";

export interface MemberView {
  member: string;
  /** Per-period allowance. */
  allowance: string;
  used: string;
  reserved: string;
}

export interface BudgetView {
  budget_id: string;
  name: string;
  /** The account that controls the budget, usually a Sputnik DAO. */
  owner: string;
  /** Deposited funds. The hard cap: the meter can never pay out more than this. */
  deposit: string;
  spent: string;
  reserved: string;
  period: "day" | "week" | "month";
  period_start: string;
  members: MemberView[];
}

export interface SettlementProof {
  model_id: string;
  request_hash: string;
  response_hash: string;
  text: string;
  signature: string;
  signing_address: string;
  /** Provider response id. A proof settles at most once. */
  chat_id: string;
}

export type ReserveRefusal = "UNKNOWN_BUDGET" | "UNKNOWN_MEMBER" | "ALLOWANCE_EXHAUSTED" | "BUDGET_EXHAUSTED" | "DUPLICATE_CALL";

export type ReserveResult = { ok: true; reserved: string } | { ok: false; reason: ReserveRefusal; detail: string };

export type SettleResult = { ok: true; tx: string; amount: string; refund: string } | { ok: false; reason: "NO_RESERVATION" | "PROOF_REJECTED" | "REPLAYED" | "OVER_RESERVATION"; detail: string };

export interface MeterClient {
  readonly mode: ChainMode;
  listBudgets(): Promise<BudgetView[]>;
  getBudget(budgetId: string): Promise<BudgetView | null>;
  /** Holds up to maxAmount of the member's allowance and the budget's deposit for one call. */
  reserve(args: { budget_id: string; member: string; call_id: string; model_id: string; max_amount: string }): Promise<ReserveResult>;
  /** Pays `amount` (at most the reservation) against a proof the meter re-verifies. Refunds the rest. */
  settle(args: { call_id: string; amount: string; proof: SettlementProof }): Promise<SettleResult>;
  /** Refunds the whole reservation. */
  release(args: { call_id: string; reason: string }): Promise<{ tx: string; refund: string }>;
  /** Owner or DAO actions. On chain these arrive through DAO proposals. */
  fund(budgetId: string, amount: string): Promise<{ tx: string }>;
  setAllowance(budgetId: string, member: string, allowance: string): Promise<{ tx: string }>;
}

export interface AttestedModel {
  model_id: string;
  signing_address: string;
  signing_algo: "ecdsa";
  /** Where the attestation came from, for the UI. */
  source: string;
  attested_at: string;
}

export interface ModelRegistryClient {
  readonly mode: ChainMode;
  isAttested(modelId: string, signer: string): Promise<boolean>;
  listModels(): Promise<AttestedModel[]>;
}

export type Tranche = "junior" | "senior";

export interface PoolView {
  /** Total value locked, junior plus senior. */
  tvl: string;
  junior: string;
  senior: string;
  /** Who holds the junior (first-loss) tranche. */
  junior_holder: string;
  /** Value of one senior share in atomic WUSD, scaled by 1e6 (1000000 = 1.0). */
  share_price: string;
  senior_shares: string;
  fees_earned: string;
  claims_paid: string;
  /** Largest single claim the pool can pay today. */
  coverage_capacity: string;
  withdraw_delay_days: number;
  /** Claims above this need a DAO vote. */
  large_claim_threshold: string;
}

export interface PoolPosition {
  account: string;
  shares: string;
  value: string;
  pending_withdrawals: { id: string; shares: string; value: string; requested_at: string; available_at: string }[];
}

export interface ClaimView {
  claim_id: string;
  /** The Wardline approval that turned out wrong: a call id or a payee receipt id. */
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

export interface CoverPoolClient {
  readonly mode: ChainMode;
  getPool(): Promise<PoolView>;
  getPosition(account: string): Promise<PoolPosition>;
  deposit(account: string, amount: string): Promise<{ tx: string; shares: string }>;
  /** Starts the withdrawal wait. Funds become available after withdraw_delay_days. */
  requestWithdraw(account: string, shares: string): Promise<{ tx: string; id: string; available_at: string }>;
  listClaims(): Promise<ClaimView[]>;
  /** Pays small claims at once (junior first, then senior). Large ones wait for a DAO vote. */
  fileClaim(args: { subject: string; claimant: string; amount: string; reason: string }): Promise<ClaimView>;
  /** Adds coverage fees from settled calls. */
  addFees(amount: string): Promise<void>;
}

export interface Chain {
  mode: ChainMode;
  meter: MeterClient;
  registry: ModelRegistryClient;
  pool: CoverPoolClient;
}
