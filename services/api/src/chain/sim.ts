/**
 * In-process simulations of the meter, model registry and cover pool, with the same rules the
 * contracts enforce: the deposit is a hard cap, allowances reset each period, a call settles once and
 * only against a proof the meter re-verifies, and claims are paid junior first.
 * Transaction ids are "sim-..." so nothing here can be mistaken for a chain transaction.
 */

import { createHash } from "node:crypto";
import { verifyProviderProof } from "@wardline/sdk";
import type { DateClock as Clock } from "../time.js";
import type {
  AttestedModel,
  BudgetView,
  Chain,
  ClaimView,
  CoverPoolClient,
  MeterClient,
  ModelRegistryClient,
  PoolPosition,
  PoolView,
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

/** Coverage fee taken from each settled call into the pool, in basis points. */
export const COVER_FEE_BPS = 200n;

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
    this.models.push(model);
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
    private readonly onFees: (amount: string) => Promise<void> = async () => {},
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
      return { ok: false, reason: "ALLOWANCE_EXHAUSTED", detail: `${args.member} has ${(m.allowance - m.used - m.reserved).toString()} of ${m.allowance.toString()} left this ${b.period}.` };
    }
    if (b.spent + b.reserved + amount > b.deposit) {
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
    await this.onFees(((amount * COVER_FEE_BPS) / 10_000n).toString());
    return { ok: true, tx: simTx("settle", args.call_id), amount: amount.toString(), refund: (r.amount - amount).toString() };
  }

  async release(args: { call_id: string; reason: string }): Promise<{ tx: string; refund: string }> {
    const freed = this.free(args.call_id);
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
  senior: string;
  withdraw_delay_days: number;
  large_claim_threshold: string;
  /** Largest single claim, as a share of TVL in basis points. */
  max_claim_bps: number;
  positions: { account: string; amount: string }[];
}

const SCALE = 1_000_000n;

export class SimPool implements CoverPoolClient {
  readonly mode = "sim" as const;
  private junior: bigint;
  private senior: bigint;
  private shares = 0n;
  private fees = 0n;
  private paid = 0n;
  private readonly positions = new Map<string, bigint>();
  private readonly withdrawals: { id: string; account: string; shares: bigint; requested: number }[] = [];
  private readonly claims: ClaimView[] = [];

  constructor(
    private readonly seed: SimPoolSeed,
    private readonly now: Clock,
  ) {
    this.junior = big(seed.junior);
    this.senior = 0n;
    for (const p of seed.positions) this.mint(p.account, big(p.amount));
    if (this.senior === 0n) this.senior = big(seed.senior);
  }

  private price(): bigint {
    return this.shares === 0n ? SCALE : (this.senior * SCALE) / this.shares;
  }

  private mint(account: string, amount: bigint): bigint {
    const shares = (amount * SCALE) / this.price();
    this.senior += amount;
    this.shares += shares;
    this.positions.set(account, (this.positions.get(account) ?? 0n) + shares);
    return shares;
  }

  async getPool(): Promise<PoolView> {
    const tvl = this.junior + this.senior;
    return {
      tvl: tvl.toString(),
      junior: this.junior.toString(),
      senior: this.senior.toString(),
      junior_holder: this.seed.junior_holder,
      share_price: this.price().toString(),
      senior_shares: this.shares.toString(),
      fees_earned: this.fees.toString(),
      claims_paid: this.paid.toString(),
      coverage_capacity: ((tvl * BigInt(this.seed.max_claim_bps)) / 10_000n).toString(),
      withdraw_delay_days: this.seed.withdraw_delay_days,
      large_claim_threshold: this.seed.large_claim_threshold,
    };
  }

  async getPosition(account: string): Promise<PoolPosition> {
    const shares = this.positions.get(account) ?? 0n;
    const delay = this.seed.withdraw_delay_days * 86_400_000;
    return {
      account,
      shares: shares.toString(),
      value: ((shares * this.price()) / SCALE).toString(),
      pending_withdrawals: this.withdrawals
        .filter((w) => w.account === account)
        .map((w) => ({ id: w.id, shares: w.shares.toString(), value: ((w.shares * this.price()) / SCALE).toString(), requested_at: new Date(w.requested).toISOString(), available_at: new Date(w.requested + delay).toISOString() })),
    };
  }

  async deposit(account: string, amount: string): Promise<{ tx: string; shares: string }> {
    const value = big(amount);
    if (value <= 0n) throw new Error("Deposit must be positive");
    return { tx: simTx("deposit", account), shares: this.mint(account, value).toString() };
  }

  async requestWithdraw(account: string, shares: string): Promise<{ tx: string; id: string; available_at: string }> {
    const want = big(shares);
    const held = this.positions.get(account) ?? 0n;
    const queued = this.withdrawals.filter((w) => w.account === account).reduce((n, w) => n + w.shares, 0n);
    if (want <= 0n || want > held - queued) throw new Error("Not enough shares to withdraw");
    const requested = this.now().getTime();
    const id = `wd_${createHash("sha256").update(`${account}:${requested}:${this.withdrawals.length}`).digest("hex").slice(0, 10)}`;
    this.withdrawals.push({ id, account, shares: want, requested });
    return { tx: simTx("withdraw", account), id, available_at: new Date(requested + this.seed.withdraw_delay_days * 86_400_000).toISOString() };
  }

  async listClaims(): Promise<ClaimView[]> {
    return [...this.claims].reverse();
  }

  async fileClaim(args: { subject: string; claimant: string; amount: string; reason: string }): Promise<ClaimView> {
    const amount = big(args.amount);
    const claim: ClaimView = {
      claim_id: `clm_${createHash("sha256").update(`${args.subject}:${this.claims.length}`).digest("hex").slice(0, 10)}`,
      subject: args.subject,
      claimant: args.claimant,
      amount: amount.toString(),
      reason: args.reason,
      status: "pending_vote",
      paid_from_junior: "0",
      paid_from_senior: "0",
      filed_at: this.now().toISOString(),
      tx: null,
    };
    const capacity = big((await this.getPool()).coverage_capacity);
    if (amount <= big(this.seed.large_claim_threshold) && amount <= capacity) {
      // We lose first: the junior tranche absorbs the loss before any senior LP is touched.
      const fromJunior = min(amount, this.junior);
      const fromSenior = amount - fromJunior;
      this.junior -= fromJunior;
      this.senior -= fromSenior;
      this.paid += amount;
      Object.assign(claim, { status: "paid", paid_from_junior: fromJunior.toString(), paid_from_senior: fromSenior.toString(), tx: simTx("claim", claim.claim_id) });
    }
    this.claims.push(claim);
    return claim;
  }

  async addFees(amount: string): Promise<void> {
    const value = big(amount);
    this.fees += value;
    this.senior += value;
  }
}

export interface SimChainSeed {
  budgets: SimBudgetSeed[];
  models: AttestedModel[];
  pool: SimPoolSeed;
}

export function createSimChain(seed: SimChainSeed, now: Clock): Chain {
  const registry = new SimRegistry([...seed.models]);
  const pool = new SimPool(seed.pool, now);
  const meter = new SimMeter(seed.budgets, registry, now, (fee) => pool.addFees(fee));
  return { mode: "sim", meter, registry, pool };
}
