/**
 * What the API needs from Tharun's contracts: the meter (budgets, reserve, settle, release), the
 * model registry (which TEE signer is attested for which model) and the cover pool (Wardline Mutual).
 * WARDLINE_CHAIN_MODE=sim uses the simulations in this folder. WARDLINE_CHAIN_MODE=near uses his typed
 * clients once packages/vault-client exports them with these method names.
 * TODO(tharun): confirm names and shapes against SHARED INTERFACES in docs/status/tharun.md.
 *
 * Amounts are atomic USDC (6 decimals) as decimal strings. Times are ISO 8601.
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

/** One point in WARD's price history. */
export interface WardPricePoint {
  at: string;
  /** Atomic USDC per WARD, scaled by 1e6 (1000000 = 1 USDC). */
  price: string;
  event: "launch" | "deposit" | "fees" | "claim" | "redeem";
}

/**
 * Wardline Mutual. The junior tranche is Wardline's own first-loss stake, in USDC. The senior tranche
 * is the USDC behind WARD, a NEP-141 share token: price = senior assets / WARD supply. Fees raise the
 * price; a payout that exceeds the junior stake lowers it. WARD is yield-bearing and loss-sharing.
 */
export interface PoolView {
  /** Total value locked, junior plus senior, in atomic USDC. */
  tvl: string;
  junior: string;
  senior: string;
  /** Who holds the junior (first-loss) tranche. */
  junior_holder: string;
  ward_symbol: string;
  ward_name: string;
  /** WARD in circulation, atomic (6 decimals), including WARD locked for redemption. */
  ward_supply: string;
  /** Atomic USDC per WARD, scaled by 1e6. */
  ward_price: string;
  /** WARD's price at launch, scaled by 1e6. Always 1000000 (1 USDC). */
  launch_price: string;
  price_history: WardPricePoint[];
  fees_earned: string;
  claims_paid: string;
  /** Largest single claim the pool can pay today. */
  coverage_capacity: string;
  withdraw_delay_days: number;
  /** Claims above this need a DAO vote. */
  large_claim_threshold: string;
  /** A DEX pool where WARD trades, or null if there is none. */
  trade_url: string | null;
}

export interface PendingRedemption {
  id: string;
  /** Locked WARD, atomic. */
  ward: string;
  /** USDC it would redeem for at today's price. */
  value: string;
  requested_at: string;
  available_at: string;
}

export interface PoolPosition {
  account: string;
  /** Free WARD, atomic. */
  ward: string;
  /** WARD locked in pending redemptions. */
  ward_locked: string;
  /** USDC value of free plus locked WARD at today's price. */
  value: string;
  pending_withdrawals: PendingRedemption[];
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
  /** WARD price before and after the payout, scaled by 1e6. */
  ward_price_before: string;
  ward_price_after: string;
  filed_at: string;
  tx: string | null;
}

export interface CoverPoolClient {
  readonly mode: ChainMode;
  getPool(): Promise<PoolView>;
  getPosition(account: string): Promise<PoolPosition>;
  /** Deposits USDC and mints WARD at the current price. */
  deposit(account: string, amount: string): Promise<{ tx: string; ward: string }>;
  /** Locks WARD for redemption. It can be redeemed after withdraw_delay_days. */
  requestWithdraw(account: string, ward: string): Promise<{ tx: string; id: string; available_at: string }>;
  /** Burns the locked WARD and pays USDC at the price on the day, once the wait is over. */
  redeem(account: string, id: string): Promise<{ tx: string; usdc: string }>;
  listClaims(): Promise<ClaimView[]>;
  /** Pays small claims at once (junior first, then senior). Large ones wait for a DAO vote. */
  fileClaim(args: { subject: string; claimant: string; amount: string; reason: string }): Promise<ClaimView>;
  /** Adds coverage fees from settled calls. They raise WARD's price. */
  addFees(amount: string): Promise<void>;
}

export interface Chain {
  mode: ChainMode;
  meter: MeterClient;
  registry: ModelRegistryClient;
  pool: CoverPoolClient;
}
