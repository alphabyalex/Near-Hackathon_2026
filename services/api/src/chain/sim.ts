/**
 * In-process simulations of the meter, model registry and cover pool, with the same rules the
 * contracts enforce: the deposit is a hard cap, allowances reset each period, a call settles once and
 * only against a proof the meter re-verifies, and claims are paid junior first.
 * Transaction ids are "sim-..." so nothing here can be mistaken for a chain transaction.
 */

import { createHash } from "node:crypto";
import { verifyProviderProof } from "@wardline/sdk";
import type { DateClock as Clock } from "../time.js";
import { SimGovernance, SimReputation, type GovernanceSeed, type ReputationSeed } from "./sim-mutual.js";
import type {
  AttestedModel,
  BudgetView,
  Chain,
  ClaimView,
  CoverPoolClient,
  MeterClient,
  ModelRegistryClient,
  MutualAction,
  PoolPosition,
  PoolView,
  WardPricePoint,
  ReserveResult,
  SettleResult,
} from "./types.js";

let counter = 0;
const simTx = (kind: string, seed: string): string => `sim-${kind}-${createHash("sha256").update(`${seed}:${++counter}`).digest("hex").slice(0, 16)}`;
const big = (s: string): bigint => BigInt(s);
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

const PERIOD_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;

interface Member {
  allowance: bigint;
  used: bigint;
  reserved: bigint;
}

interface Budget {
  budget_id: string;
  name: string;
  owner: string;
  deposit: bigint;
  spent: bigint;
  reserved: bigint;
  period: BudgetView["period"];
  periodStart: number;
  members: Map<string, Member>;
}

interface Reservation {
  budget_id: string;
  member: string;
  model_id: string;
  amount: bigint;
}

export interface SimBudgetSeed {
  budget_id: string;
  name: string;
  owner: string;
  deposit: string;
  period: BudgetView["period"];
  members: { member: string; allowance: string }[];
}

/** Coverage fee taken from each settled call into the pool, in basis points: the Bronze rate. */
export const COVER_FEE_BPS = 200n;

/** What the meter tells the rest of the sim chain. */
export interface MeterHooks {
  /** Fee for a budget's call, in basis points. Defaults to COVER_FEE_BPS. */
  feeBps?: (budgetId: string) => bigint;
  onFees?: (amount: string) => Promise<void>;
  onProven?: (budgetId: string, amount: bigint, fee: bigint) => void;
  onRefused?: (budgetId: string) => void;
  /** A reservation refused at an allowance or the deposit. */
  onCapped?: (budgetId: string) => void;
}

export class SimRegistry implements ModelRegistryClient {
  readonly mode = "sim" as const;
  constructor(private readonly models: AttestedModel[]) {}
  async isAttested(modelId: string, signer: string): Promise<boolean> {
    return this.models.some((m) => m.model_id === modelId && m.signing_address.toLowerCase() === signer.toLowerCase());
  }
  async listModels(): Promise<AttestedModel[]> {
    return [...this.models];
  }
  add(model: AttestedModel): void {
    const i = this.models.findIndex((m) => m.model_id === model.model_id && m.signing_address.toLowerCase() === model.signing_address.toLowerCase());
    if (i < 0) this.models.push(model);
  }
  /** Stops covering a model: every signer for it is removed. */
  remove(modelId: string): void {
    for (let i = this.models.length - 1; i >= 0; i--) if (this.models[i]!.model_id === modelId) this.models.splice(i, 1);
  }
}

export class SimMeter implements MeterClient {
  readonly mode = "sim" as const;
  private readonly budgets = new Map<string, Budget>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly settledChats = new Set<string>();

  constructor(
    seeds: SimBudgetSeed[],
    private readonly registry: ModelRegistryClient,
    private readonly now: Clock,
    private readonly hooks: MeterHooks = {},
  ) {
    for (const s of seeds) {
      this.budgets.set(s.budget_id, {
        budget_id: s.budget_id,
        name: s.name,
        owner: s.owner,
        deposit: big(s.deposit),
        spent: 0n,
        reserved: 0n,
        period: s.period,
        periodStart: now().getTime(),
        members: new Map(s.members.map((m) => [m.member, { allowance: big(m.allowance), used: 0n, reserved: 0n }])),
      });
    }
  }

  private roll(b: Budget): void {
    const length = PERIOD_MS[b.period];
    const t = this.now().getTime();
    if (t - b.periodStart < length) return;
    b.periodStart += Math.floor((t - b.periodStart) / length) * length;
    for (const m of b.members.values()) m.used = 0n;
  }

  private view(b: Budget): BudgetView {
    this.roll(b);
    return {
      budget_id: b.budget_id,
      name: b.name,
      owner: b.owner,
      deposit: b.deposit.toString(),
      spent: b.spent.toString(),
      reserved: b.reserved.toString(),
      period: b.period,
      period_start: new Date(b.periodStart).toISOString(),
      members: [...b.members.entries()].map(([member, m]) => ({ member, allowance: m.allowance.toString(), used: m.used.toString(), reserved: m.reserved.toString() })),
    };
  }

  async listBudgets(): Promise<BudgetView[]> {
    return [...this.budgets.values()].map((b) => this.view(b));
  }

  async getBudget(budgetId: string): Promise<BudgetView | null> {
    const b = this.budgets.get(budgetId);
    return b ? this.view(b) : null;
  }

  async reserve(args: { budget_id: string; member: string; call_id: string; model_id: string; max_amount: string }): Promise<ReserveResult> {
    const b = this.budgets.get(args.budget_id);
    if (!b) return { ok: false, reason: "UNKNOWN_BUDGET", detail: `No budget ${args.budget_id}.` };
    this.roll(b);
    const m = b.members.get(args.member);
    if (!m) return { ok: false, reason: "UNKNOWN_MEMBER", detail: `${args.member} is not a member of ${args.budget_id}.` };
    if (this.reservations.has(args.call_id)) return { ok: false, reason: "DUPLICATE_CALL", detail: `Call ${args.call_id} already has a reservation.` };
    const amount = big(args.max_amount);
    if (m.used + m.reserved + amount > m.allowance) {
      this.hooks.onCapped?.(b.budget_id);
      return { ok: false, reason: "ALLOWANCE_EXHAUSTED", detail: `${args.member} has ${(m.allowance - m.used - m.reserved).toString()} of ${m.allowance.toString()} left this ${b.period}.` };
    }
    if (b.spent + b.reserved + amount > b.deposit) {
      this.hooks.onCapped?.(b.budget_id);
      return { ok: false, reason: "BUDGET_EXHAUSTED", detail: `The budget has ${(b.deposit - b.spent - b.reserved).toString()} of its ${b.deposit.toString()} deposit left.` };
    }
    m.reserved += amount;
    b.reserved += amount;
    this.reservations.set(args.call_id, { budget_id: b.budget_id, member: args.member, model_id: args.model_id, amount });
    return { ok: true, reserved: amount.toString() };
  }

  private free(call_id: string): { r: Reservation; b: Budget; m: Member } | null {
    const r = this.reservations.get(call_id);
    if (!r) return null;
    const b = this.budgets.get(r.budget_id)!;
    const m = b.members.get(r.member)!;
    this.reservations.delete(call_id);
    m.reserved -= r.amount;
    b.reserved -= r.amount;
    return { r, b, m };
  }

  async settle(args: { call_id: string; amount: string; proof: import("./types.js").SettlementProof }): Promise<SettleResult> {
    const r = this.reservations.get(args.call_id);
    if (!r) return { ok: false, reason: "NO_RESERVATION", detail: `No reservation for ${args.call_id}.` };
    const amount = big(args.amount);
    if (amount > r.amount) return { ok: false, reason: "OVER_RESERVATION", detail: "Amount is above the reservation." };
    if (this.settledChats.has(args.proof.chat_id)) return { ok: false, reason: "REPLAYED", detail: `Response ${args.proof.chat_id} was already paid for.` };
    // The meter checks the proof itself, as the contract will, instead of trusting the gateway.
    const check = await verifyProviderProof({
      model: r.model_id,
      requestHash: args.proof.request_hash,
      responseHash: args.proof.response_hash,
      signature: { text: args.proof.text, signature: args.proof.signature, signing_address: args.proof.signing_address, signing_algo: "ecdsa", signature_kind: "provider_tee" },
      isAttested: (model, signer) => this.registry.isAttested(model, signer),
    });
    if (!check.ok) return { ok: false, reason: "PROOF_REJECTED", detail: check.detail };
    const freed = this.free(args.call_id)!;
    freed.m.used += amount;
    freed.b.spent += amount;
    this.settledChats.add(args.proof.chat_id);
    const fee = (amount * (this.hooks.feeBps?.(r.budget_id) ?? COVER_FEE_BPS)) / 10_000n;
    this.hooks.onProven?.(r.budget_id, amount, fee);
    await this.hooks.onFees?.(fee.toString());
    return { ok: true, tx: simTx("settle", args.call_id), amount: amount.toString(), refund: (r.amount - amount).toString() };
  }

  async release(args: { call_id: string; reason: string }): Promise<{ tx: string; refund: string }> {
    const freed = this.free(args.call_id);
    // A refused proof counts in the group's history. An upstream outage does not.
    if (freed && !args.reason.startsWith("UPSTREAM") && args.reason !== "BAD_UPSTREAM_RESPONSE") this.hooks.onRefused?.(freed.r.budget_id);
    return { tx: simTx("release", args.call_id), refund: freed ? freed.r.amount.toString() : "0" };
  }

  async fund(budgetId: string, amount: string): Promise<{ tx: string }> {
    const b = this.budgets.get(budgetId);
    if (!b) throw new Error(`No budget ${budgetId}`);
    b.deposit += big(amount);
    return { tx: simTx("fund", budgetId) };
  }

  async setAllowance(budgetId: string, member: string, allowance: string): Promise<{ tx: string }> {
    const b = this.budgets.get(budgetId);
    if (!b) throw new Error(`No budget ${budgetId}`);
    const m = b.members.get(member);
    if (m) m.allowance = big(allowance);
    else b.members.set(member, { allowance: big(allowance), used: 0n, reserved: 0n });
    return { tx: simTx("allowance", `${budgetId}:${member}`) };
  }
}

export interface SimPoolSeed {
  junior: string;
  junior_holder: string;
  withdraw_delay_days: number;
  large_claim_threshold: string;
  /** Largest single claim, as a share of TVL in basis points. */
  max_claim_bps: number;
  /** LPs who bought WARD at launch, at 1 USDC each. */
  positions: { account: string; amount: string }[];
  /** A DEX pool where WARD trades, if one exists. */
  trade_url?: string | null;
}

export interface PoolHooks {
  /** The group's coverage cap from its reputation tier. A claim above it waits for a WARD vote. */
  coverageCap?: (budgetId: string) => bigint | null;
  /** A claim was paid for this group. */
  onClaimPaid?: (budgetId: string) => void;
  /** A claim is waiting for a WARD-holder vote. */
  onPendingClaim?: (claim: ClaimView) => void;
}

const SCALE = 1_000_000n;

interface Redemption {
  id: string;
  account: string;
  ward: bigint;
  requested: number;
}

/**
 * Wardline Mutual with WARD. Junior (first-loss) is Wardline's own USDC. Senior is the USDC behind
 * WARD: price = senior / supply. Deposits mint WARD at the current price, so they do not move it;
 * fees raise it; payouts beyond the junior stake lower it. Redemptions lock WARD for the wait, then
 * burn it for USDC at the price on that day.
 */
export class SimPool implements CoverPoolClient {
  readonly mode = "sim" as const;
  private junior: bigint;
  private senior = 0n;
  private supply = 0n;
  private fees = 0n;
  private paid = 0n;
  private readonly balances = new Map<string, bigint>();
  private readonly redemptions: Redemption[] = [];
  private readonly claims: ClaimView[] = [];
  private readonly history: WardPricePoint[] = [];
  private readonly claimBudgets = new Map<string, string>();
  /** Per account: USDC put in, USDC taken out, and when it first joined. */
  private readonly ledger = new Map<string, { deposited: bigint; redeemed: bigint; joined: number }>();
  hooks: PoolHooks = {};

  constructor(
    private readonly seed: SimPoolSeed,
    private readonly now: Clock,
  ) {
    this.junior = big(seed.junior);
    this.mark("launch");
    for (const p of seed.positions) this.mint(p.account, big(p.amount));
  }

  private price(): bigint {
    return this.supply === 0n ? SCALE : (this.senior * SCALE) / this.supply;
  }

  private mark(event: WardPricePoint["event"]): void {
    this.history.push({ at: this.now().toISOString(), price: this.price().toString(), event });
  }

  private mint(account: string, usdc: bigint): bigint {
    const ward = (usdc * SCALE) / this.price();
    this.senior += usdc;
    this.supply += ward;
    this.balances.set(account, (this.balances.get(account) ?? 0n) + ward);
    return ward;
  }

  private locked(account: string): bigint {
    return this.redemptions.filter((r) => r.account === account).reduce((n, r) => n + r.ward, 0n);
  }

  async getPool(): Promise<PoolView> {
    const tvl = this.junior + this.senior;
    return {
      tvl: tvl.toString(),
      junior: this.junior.toString(),
      senior: this.senior.toString(),
      junior_holder: this.seed.junior_holder,
      ward_symbol: "WARD",
      ward_name: "Wardline Mutual share",
      ward_supply: this.supply.toString(),
      ward_price: this.price().toString(),
      launch_price: SCALE.toString(),
      price_history: [...this.history],
      fees_earned: this.fees.toString(),
      claims_paid: this.paid.toString(),
      coverage_capacity: ((tvl * BigInt(this.seed.max_claim_bps)) / 10_000n).toString(),
      withdraw_delay_days: this.seed.withdraw_delay_days,
      large_claim_threshold: this.seed.large_claim_threshold,
      trade_url: this.seed.trade_url ?? null,
    };
  }

  async getPosition(account: string): Promise<PoolPosition> {
    const balance = this.balances.get(account) ?? 0n;
    const locked = this.locked(account);
    const delay = this.seed.withdraw_delay_days * 86_400_000;
    const price = this.price();
    return {
      account,
      ward: (balance - locked).toString(),
      ward_locked: locked.toString(),
      value: ((balance * price) / SCALE).toString(),
      pending_withdrawals: this.redemptions
        .filter((r) => r.account === account)
        .map((r) => ({ id: r.id, ward: r.ward.toString(), value: ((r.ward * price) / SCALE).toString(), requested_at: new Date(r.requested).toISOString(), available_at: new Date(r.requested + delay).toISOString() })),
      ...(() => {
        const entry = this.ledger.get(account);
        return entry ? { deposited: entry.deposited.toString(), redeemed: entry.redeemed.toString(), joined_at: new Date(entry.joined).toISOString() } : { deposited: "0", redeemed: "0", joined_at: null };
      })(),
    };
  }

  async deposit(account: string, amount: string): Promise<{ tx: string; ward: string }> {
    const usdc = big(amount);
    if (usdc <= 0n) throw new Error("Deposit must be positive");
    const ward = this.mint(account, usdc);
    const entry = this.ledger.get(account) ?? { deposited: 0n, redeemed: 0n, joined: this.now().getTime() };
    entry.deposited += usdc;
    this.ledger.set(account, entry);
    this.mark("deposit");
    return { tx: simTx("deposit", account), ward: ward.toString() };
  }

  async requestWithdraw(account: string, ward: string): Promise<{ tx: string; id: string; available_at: string }> {
    const want = big(ward);
    const free = (this.balances.get(account) ?? 0n) - this.locked(account);
    if (want <= 0n || want > free) throw new Error("Not enough free WARD to redeem");
    const requested = this.now().getTime();
    const id = `rd_${createHash("sha256").update(`${account}:${requested}:${this.redemptions.length}`).digest("hex").slice(0, 10)}`;
    this.redemptions.push({ id, account, ward: want, requested });
    return { tx: simTx("lock", account), id, available_at: new Date(requested + this.seed.withdraw_delay_days * 86_400_000).toISOString() };
  }

  async redeem(account: string, id: string): Promise<{ tx: string; usdc: string }> {
    const i = this.redemptions.findIndex((r) => r.id === id && r.account === account);
    if (i < 0) throw new Error("No such redemption");
    const r = this.redemptions[i]!;
    if (this.now().getTime() < r.requested + this.seed.withdraw_delay_days * 86_400_000) throw new Error("The 7-day wait is not over yet");
    const usdc = (r.ward * this.price()) / SCALE;
    this.redemptions.splice(i, 1);
    this.balances.set(account, (this.balances.get(account) ?? 0n) - r.ward);
    this.supply -= r.ward;
    this.senior -= usdc;
    const entry = this.ledger.get(account);
    if (entry) entry.redeemed += usdc;
    this.mark("redeem");
    return { tx: simTx("redeem", account), usdc: usdc.toString() };
  }

  /** NEP-141 ft_transfer of free WARD. */
  async transfer(from: string, to: string, ward: string): Promise<{ tx: string }> {
    const amount = big(ward);
    const free = (this.balances.get(from) ?? 0n) - this.locked(from);
    if (amount <= 0n || amount > free) throw new Error("Not enough free WARD to transfer");
    this.balances.set(from, (this.balances.get(from) ?? 0n) - amount);
    this.balances.set(to, (this.balances.get(to) ?? 0n) + amount);
    return { tx: simTx("transfer", `${from}:${to}`) };
  }

  /** Free WARD per holder, for governance snapshots. WARD locked for redemption does not vote. */
  holders(): Map<string, bigint> {
    const out = new Map<string, bigint>();
    for (const [account, balance] of this.balances) {
      const free = balance - this.locked(account);
      if (free > 0n) out.set(account, free);
    }
    return out;
  }

  private pay(claim: ClaimView): void {
    const amount = big(claim.amount);
    // We lose first: Wardline's junior stake absorbs the loss before WARD holders are touched.
    const fromJunior = min(amount, this.junior);
    const fromSenior = amount - fromJunior;
    this.junior -= fromJunior;
    this.senior -= fromSenior;
    this.paid += amount;
    Object.assign(claim, { status: "paid", paid_from_junior: fromJunior.toString(), paid_from_senior: fromSenior.toString(), ward_price_after: this.price().toString(), tx: simTx("claim", claim.claim_id) });
    this.mark("claim");
    const budget = this.claimBudgets.get(claim.claim_id);
    if (budget) this.hooks.onClaimPaid?.(budget);
  }

  /** Pays a claim that was waiting for a vote, after WARD holders approve it. */
  async payClaim(claimId: string): Promise<ClaimView> {
    const claim = this.claims.find((c) => c.claim_id === claimId);
    if (!claim) throw new Error(`No claim ${claimId}`);
    if (claim.status !== "pending_vote") throw new Error(`Claim ${claimId} is ${claim.status}, not waiting for a vote`);
    if (big(claim.amount) > this.junior + this.senior) throw new Error("The pool cannot cover this claim");
    claim.ward_price_before = this.price().toString();
    this.pay(claim);
    return claim;
  }

  async listClaims(): Promise<ClaimView[]> {
    return [...this.claims].reverse();
  }

  async fileClaim(args: { subject: string; claimant: string; amount: string; reason: string; budget_id?: string }): Promise<ClaimView> {
    return this.fileClaimNow(args);
  }

  /** fileClaim without the await, so a seeded history is in place before anyone reads the pool. */
  fileClaimNow(args: { subject: string; claimant: string; amount: string; reason: string; budget_id?: string }): ClaimView {
    const amount = big(args.amount);
    const before = this.price().toString();
    const claim: ClaimView = {
      claim_id: `clm_${createHash("sha256").update(`${args.subject}:${this.claims.length}`).digest("hex").slice(0, 10)}`,
      subject: args.subject,
      claimant: args.claimant,
      amount: amount.toString(),
      reason: args.reason,
      status: "pending_vote",
      paid_from_junior: "0",
      paid_from_senior: "0",
      ward_price_before: before,
      ward_price_after: before,
      filed_at: this.now().toISOString(),
      tx: null,
    };
    if (args.budget_id) this.claimBudgets.set(claim.claim_id, args.budget_id);
    const capacity = ((this.junior + this.senior) * BigInt(this.seed.max_claim_bps)) / 10_000n;
    const groupCap = args.budget_id ? (this.hooks.coverageCap?.(args.budget_id) ?? null) : null;
    this.claims.push(claim);
    if (amount <= big(this.seed.large_claim_threshold) && amount <= capacity && (groupCap === null || amount <= groupCap)) this.pay(claim);
    else this.hooks.onPendingClaim?.(claim);
    return claim;
  }

  async addFees(amount: string): Promise<void> {
    const value = big(amount);
    if (value === 0n) return;
    this.fees += value;
    this.senior += value;
    this.mark("fees");
  }
}

export interface SimChainSeed {
  budgets: SimBudgetSeed[];
  models: AttestedModel[];
  pool: SimPoolSeed;
  /** Track record for groups that existed before this run, keyed by budget id. */
  reputation?: Record<string, Omit<ReputationSeed, "budget_id" | "name" | "owner">>;
  /** Claims from before this run, paid through the real claim path. */
  claims?: { subject: string; claimant: string; amount: string; reason: string; budget_id: string }[];
  /** Past and open WARD-holder proposals. */
  proposals?: GovernanceSeed[];
}

export interface SimMutual {
  reputation: SimReputation;
  governance: SimGovernance;
}

/** Reputation and governance for a chain, simulated. Shared by sim mode and by near mode until T4.6. */
export function createSimMutual(args: { budgets: SimBudgetSeed[]; reputation?: SimChainSeed["reputation"]; pool: SimPool; registry: SimRegistry | null; now: Clock }): SimMutual {
  const reputation = new SimReputation(args.budgets.map((b) => ({ budget_id: b.budget_id, name: b.name, owner: b.owner, ...(args.reputation?.[b.budget_id] ?? {}) })));
  const apply = async (action: MutualAction): Promise<void> => {
    switch (action.type) {
      case "set_fee_bps":
        return reputation.setFee(action.tier, action.fee_bps);
      case "set_coverage_multiplier":
        return reputation.setMultiplier(action.multiplier_bps);
      case "cover_model":
        if (!args.registry) throw new Error("Covering a model on chain needs the T4.6 registry hook");
        return args.registry.add({ model_id: action.model_id, signing_address: action.signing_address.toLowerCase(), signing_algo: "ecdsa", source: "Covered by a WARD-holder vote", attested_at: args.now().toISOString() });
      case "uncover_model":
        if (!args.registry) throw new Error("Uncovering a model on chain needs the T4.6 registry hook");
        return args.registry.remove(action.model_id);
      case "approve_payout":
        await args.pool.payClaim(action.claim_id);
        return;
    }
  };
  const governance = new SimGovernance({ now: args.now, balances: () => args.pool.holders(), apply });
  args.pool.hooks = {
    coverageCap: (budgetId) => reputation.coverageCap(budgetId),
    onClaimPaid: (budgetId) => reputation.recordClaim(budgetId),
    onPendingClaim: (claim) => {
      governance.open({ proposer: "wardline-labs.testnet", description: `Approve a ${(Number(BigInt(claim.amount)) / 1e6).toFixed(2)} USDC payout for ${claim.subject}`, action: { type: "approve_payout", claim_id: claim.claim_id } }, undefined, true);
    },
  };
  return { reputation, governance };
}

export function createSimChain(seed: SimChainSeed, now: Clock): Chain {
  const registry = new SimRegistry([...seed.models]);
  const pool = new SimPool(seed.pool, now);
  const { reputation, governance } = createSimMutual({ budgets: seed.budgets, reputation: seed.reputation, pool, registry, now });
  const meter = new SimMeter(seed.budgets, registry, now, {
    feeBps: (budgetId) => reputation.feeBps(budgetId),
    onProven: (budgetId, amount, fee) => reputation.recordProven(budgetId, amount, fee),
    onRefused: (budgetId) => reputation.recordRefused(budgetId),
    onCapped: (budgetId) => reputation.recordCapped(budgetId),
    onFees: (fee) => pool.addFees(fee),
  });
  // History from before this run: fees its groups already paid, and claims already settled.
  const pastFees = Object.values(seed.reputation ?? {}).reduce((n, r) => n + BigInt(r.fees_paid ?? "0"), 0n);
  if (pastFees > 0n) void pool.addFees(pastFees.toString());
  for (const c of seed.claims ?? []) pool.fileClaimNow(c);
  if (seed.proposals) governance.seed(seed.proposals);
  return { mode: "sim", meter, registry, pool, reputation, governance };
}
