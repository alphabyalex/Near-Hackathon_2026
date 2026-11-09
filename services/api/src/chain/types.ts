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

export type SettleResult = { ok: true; tx: string; amount: string; refund: string } | { ok: false; reason: "NO_RESERVATION" | "PROOF_REJECTED" | "REPLAYED" | "OVER_RESERVATION" | "TRANSFER_FAILED"; detail: string };

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
  fileClaim(args: { subject: string; claimant: string; amount: string; reason: string; budget_id?: string }): Promise<ClaimView>;
  /** Adds coverage fees from settled calls. They raise WARD's price. */
  addFees(amount: string): Promise<void>;
  /** Pays a claim that was waiting for a vote, after WARD holders approve it. */
  payClaim?(claimId: string): Promise<ClaimView>;
}

export interface Chain {
  mode: ChainMode;
  meter: MeterClient;
  registry: ModelRegistryClient;
  pool: CoverPoolClient;
  /** Reputation tiers. Sim until T4.6 lands on chain, even in near mode. */
  reputation: ReputationClient;
  /** WARD-holder voting. Sim until T4.6 lands on chain, even in near mode. */
  governance: GovernanceClient;
}

/** Reputation tiers. A group with a clean record pays a lower fee and gets more coverage. */
export type Tier = "bronze" | "silver" | "gold";

/**
 * get_reputation(budget_id). Tharun's T4.6 adds this on chain; until then the sim answers with the
 * same shape. Amounts are atomic USDC.
 */
export interface ReputationView {
  budget_id: string;
  /** Display name of the group behind the budget. */
  name: string;
  owner: string;
  tier: Tier;
  proven_calls: number;
  refused_calls: number;
  /** Calls stopped at a member allowance or the budget's deposit before reaching a model. */
  capped_calls: number;
  /** Payouts from this group's treasury that the payee check blocked before a vote. */
  blocked_payees: number;
  claims: number;
  /** Clean proven calls since the last tier change or claim. */
  clean_calls: number;
  /** Clean proven calls that earn the next tier, or null at the top. */
  next_tier_at: number | null;
  /** Coverage fee on each proven call, in basis points. */
  fee_bps: number;
  /** Largest claim the Mutual covers for this group without a WARD vote. */
  coverage_cap: string;
  /** Total paid for proven calls. */
  spent: string;
  /** Fees this group's calls paid to the Mutual. */
  fees_paid: string;
}

export interface TierRule {
  tier: Tier;
  fee_bps: number;
  /** Base coverage cap before the coverage multiplier. */
  coverage: string;
  /** Clean proven calls needed to move up from this tier, or null at the top. */
  promote_after: number | null;
}

export interface ReputationClient {
  readonly mode: ChainMode;
  getReputation(budgetId: string): Promise<ReputationView | null>;
  listReputations(): Promise<ReputationView[]>;
  tierRules(): Promise<{ rules: TierRule[]; coverage_multiplier_bps: number }>;
}

/** What a WARD-holder proposal does when executed. */
export type MutualAction =
  | { type: "set_fee_bps"; tier: Tier; fee_bps: number }
  | { type: "set_coverage_multiplier"; multiplier_bps: number }
  | { type: "cover_model"; model_id: string; signing_address: string }
  | { type: "uncover_model"; model_id: string }
  | { type: "approve_payout"; claim_id: string };

export type MutualProposalStatus = "open" | "passed" | "rejected" | "executed";

export interface MutualProposalView {
  id: number;
  proposer: string;
  description: string;
  action: MutualAction;
  /** WARD balances are read once, when the proposal opens. Later transfers do not change weights. */
  snapshot_at: string;
  snapshot_supply: string;
  votes_for: string;
  votes_against: string;
  voters: number;
  /** For plus against must reach this much WARD. */
  quorum: string;
  opens_at: string;
  closes_at: string;
  status: MutualProposalStatus;
  executed_at: string | null;
  tx: string | null;
}

export type VoteSupport = "for" | "against";

/**
 * WARD-holder governance of the Mutual: fees, coverage, which models are covered and large payouts.
 * One WARD, one vote, weighted at the snapshot. A proposal passes when the window closes with quorum
 * and more for than against, or early once votes for exceed half the snapshot supply. Anyone can
 * execute a passed proposal, once.
 */
export interface GovernanceClient {
  readonly mode: ChainMode;
  listProposals(): Promise<MutualProposalView[]>;
  getProposal(id: number): Promise<MutualProposalView | null>;
  propose(args: { proposer: string; description: string; action: MutualAction }): Promise<MutualProposalView>;
  vote(args: { id: number; voter: string; support: VoteSupport }): Promise<MutualProposalView>;
  execute(id: number): Promise<MutualProposalView>;
  /** The voter's weight on a proposal: their WARD at its snapshot. */
  weightOf(id: number, voter: string): Promise<string>;
  params(): Promise<{ quorum_bps: number; voting_days: number }>;
}
