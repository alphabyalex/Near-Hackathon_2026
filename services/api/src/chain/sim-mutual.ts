/**
 * Reputation tiers and WARD-holder governance, simulated with the interface Tharun's T4.6 contracts
 * will expose (get_reputation, propose, vote, execute). Used in sim mode, and in near mode until T4.6
 * is deployed. Transaction ids are "sim-..." so nothing here can be mistaken for a chain transaction.
 */

import { createHash } from "node:crypto";
import type { DateClock as Clock } from "../time.js";
import type {
  GovernanceClient,
  MutualAction,
  MutualProposalStatus,
  MutualProposalView,
  ReputationClient,
  ReputationView,
  Tier,
  TierRule,
  VoteSupport,
} from "./types.js";

const W = (whole: number): string => BigInt(Math.round(whole * 1_000_000)).toString();
let counter = 0;
const simTx = (kind: string, seed: string): string => `sim-${kind}-${createHash("sha256").update(`${seed}:${++counter}`).digest("hex").slice(0, 16)}`;

/** Bronze, Silver, Gold at 2%, 1.5% and 1%. Coverage doubles at each step. */
export const DEFAULT_TIER_RULES: readonly TierRule[] = [
  { tier: "bronze", fee_bps: 200, coverage: W(25), promote_after: 10 },
  { tier: "silver", fee_bps: 150, coverage: W(50), promote_after: 25 },
  { tier: "gold", fee_bps: 100, coverage: W(100), promote_after: null },
];

export interface ReputationSeed {
  budget_id: string;
  name: string;
  owner: string;
  tier?: Tier;
  proven_calls?: number;
  refused_calls?: number;
  capped_calls?: number;
  blocked_payees?: number;
  claims?: number;
  clean_calls?: number;
  spent?: string;
  fees_paid?: string;
}

interface Rep {
  budget_id: string;
  name: string;
  owner: string;
  tier: number;
  proven: number;
  refused: number;
  capped: number;
  blocked: number;
  claims: number;
  clean: number;
  spent: bigint;
  fees: bigint;
}

const TIER_INDEX: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2 };

export class SimReputation implements ReputationClient {
  readonly mode = "sim" as const;
  private readonly records = new Map<string, Rep>();
  private readonly rules: TierRule[];
  private multiplierBps = 10_000;

  constructor(seeds: ReputationSeed[], rules: readonly TierRule[] = DEFAULT_TIER_RULES) {
    this.rules = rules.map((r) => ({ ...r }));
    for (const s of seeds) this.ensure(s);
  }

  ensure(s: ReputationSeed): void {
    if (this.records.has(s.budget_id)) return;
    this.records.set(s.budget_id, {
      budget_id: s.budget_id,
      name: s.name,
      owner: s.owner,
      tier: TIER_INDEX[s.tier ?? "bronze"],
      proven: s.proven_calls ?? 0,
      refused: s.refused_calls ?? 0,
      capped: s.capped_calls ?? 0,
      blocked: s.blocked_payees ?? 0,
      claims: s.claims ?? 0,
      clean: s.clean_calls ?? 0,
      spent: BigInt(s.spent ?? "0"),
      fees: BigInt(s.fees_paid ?? "0"),
    });
  }

  private rule(r: Rep): TierRule {
    return this.rules[r.tier]!;
  }

  private view(r: Rep): ReputationView {
    const rule = this.rule(r);
    return {
      budget_id: r.budget_id,
      name: r.name,
      owner: r.owner,
      tier: rule.tier,
      proven_calls: r.proven,
      refused_calls: r.refused,
      capped_calls: r.capped,
      blocked_payees: r.blocked,
      claims: r.claims,
      clean_calls: r.clean,
      next_tier_at: rule.promote_after,
      fee_bps: rule.fee_bps,
      coverage_cap: this.cap(r).toString(),
      spent: r.spent.toString(),
      fees_paid: r.fees.toString(),
    };
  }

  private cap(r: Rep): bigint {
    return (BigInt(this.rule(r).coverage) * BigInt(this.multiplierBps)) / 10_000n;
  }

  /** Fee for a budget's next proven call, in basis points. Unknown budgets pay the Bronze rate. */
  feeBps(budgetId: string): bigint {
    const r = this.records.get(budgetId);
    return BigInt(r ? this.rule(r).fee_bps : this.rules[0]!.fee_bps);
  }

  coverageCap(budgetId: string): bigint | null {
    const r = this.records.get(budgetId);
    return r ? this.cap(r) : null;
  }

  /** A proven, paid call. Enough clean calls in a row move the group up a tier. */
  recordProven(budgetId: string, amount: bigint, fee: bigint): void {
    const r = this.records.get(budgetId);
    if (!r) return;
    r.proven++;
    r.clean++;
    r.spent += amount;
    r.fees += fee;
    const after = this.rule(r).promote_after;
    if (after !== null && r.clean >= after) {
      r.tier++;
      r.clean = 0;
    }
  }

  /** A refused call. The provider failed the proof, not the group, so the tier does not move. */
  recordRefused(budgetId: string): void {
    const r = this.records.get(budgetId);
    if (r) r.refused++;
  }

  /** A call stopped at an allowance or the deposit. It stays below the line and never reached a model. */
  recordCapped(budgetId: string): void {
    const r = this.records.get(budgetId);
    if (r) r.capped++;
  }

  /** A paid claim moves the group down one tier and restarts its clean streak. */
  recordClaim(budgetId: string): void {
    const r = this.records.get(budgetId);
    if (!r) return;
    r.claims++;
    r.tier = Math.max(0, r.tier - 1);
    r.clean = 0;
  }

  setFee(tier: Tier, feeBps: number): void {
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1_000) throw new Error("fee_bps must be 0 to 1000");
    this.rules[TIER_INDEX[tier]]!.fee_bps = feeBps;
  }

  setMultiplier(bps: number): void {
    if (!Number.isInteger(bps) || bps < 2_500 || bps > 40_000) throw new Error("The coverage multiplier must be 0.25x to 4x");
    this.multiplierBps = bps;
  }

  async getReputation(budgetId: string): Promise<ReputationView | null> {
    const r = this.records.get(budgetId);
    return r ? this.view(r) : null;
  }

  /** Safest first: tier, then fewest claims, then most proven calls. */
  async listReputations(): Promise<ReputationView[]> {
    return [...this.records.values()].sort((a, b) => b.tier - a.tier || a.claims - b.claims || b.proven - a.proven).map((r) => this.view(r));
  }

  async tierRules(): Promise<{ rules: TierRule[]; coverage_multiplier_bps: number }> {
    return { rules: this.rules.map((r) => ({ ...r })), coverage_multiplier_bps: this.multiplierBps };
  }
}

interface Proposal {
  id: number;
  proposer: string;
  description: string;
  action: MutualAction;
  snapshot: Map<string, bigint>;
  supply: bigint;
  votes: Map<string, { support: VoteSupport; weight: bigint }>;
  opens: number;
  closes: number;
  executedAt: number | null;
  tx: string | null;
}

export interface GovernanceSeed {
  proposer: string;
  description: string;
  action: MutualAction;
  /** How long ago it opened. */
  opened_days_ago: number;
  votes?: [string, VoteSupport][];
  execute?: boolean;
}

export interface SimGovernanceOptions {
  now: Clock;
  /** Free WARD per holder right now. Read once per proposal, as its snapshot. */
  balances: () => Map<string, bigint>;
  /** Carries out a passed proposal. */
  apply: (action: MutualAction) => void | Promise<void>;
  quorum_bps?: number;
  voting_days?: number;
}

const DAY = 86_400_000;

export class SimGovernance implements GovernanceClient {
  readonly mode = "sim" as const;
  private readonly proposals: Proposal[] = [];
  private readonly quorumBps: number;
  private readonly votingDays: number;

  constructor(private readonly options: SimGovernanceOptions) {
    this.quorumBps = options.quorum_bps ?? 2_000;
    this.votingDays = options.voting_days ?? 3;
  }

  private status(p: Proposal): MutualProposalStatus {
    if (p.executedAt !== null) return "executed";
    let yes = 0n;
    let no = 0n;
    for (const v of p.votes.values()) v.support === "for" ? (yes += v.weight) : (no += v.weight);
    // More than half of all WARD at the snapshot cannot be outvoted, so it passes early.
    if (yes * 2n > p.supply) return "passed";
    if (no * 2n >= p.supply && p.supply > 0n) return "rejected";
    if (this.options.now().getTime() < p.closes) return "open";
    return yes + no >= this.quorum(p) && yes > no ? "passed" : "rejected";
  }

  private quorum(p: Proposal): bigint {
    return (p.supply * BigInt(this.quorumBps)) / 10_000n;
  }

  private view(p: Proposal): MutualProposalView {
    let yes = 0n;
    let no = 0n;
    for (const v of p.votes.values()) v.support === "for" ? (yes += v.weight) : (no += v.weight);
    return {
      id: p.id,
      proposer: p.proposer,
      description: p.description,
      action: p.action,
      snapshot_at: new Date(p.opens).toISOString(),
      snapshot_supply: p.supply.toString(),
      votes_for: yes.toString(),
      votes_against: no.toString(),
      voters: p.votes.size,
      quorum: this.quorum(p).toString(),
      opens_at: new Date(p.opens).toISOString(),
      closes_at: new Date(p.closes).toISOString(),
      status: this.status(p),
      executed_at: p.executedAt === null ? null : new Date(p.executedAt).toISOString(),
      tx: p.tx,
    };
  }

  private get(id: number): Proposal {
    const p = this.proposals[id];
    if (!p) throw new Error(`No proposal ${id}`);
    return p;
  }

  /** Opens a proposal and snapshots every holder's WARD. System proposals (a large claim) skip the holder check. */
  open(args: { proposer: string; description: string; action: MutualAction }, at = this.options.now().getTime(), system = false): Proposal {
    const snapshot = new Map([...this.options.balances()].filter(([, v]) => v > 0n));
    if (!system && !snapshot.has(args.proposer)) throw new Error("Only WARD holders can propose. Deposit USDC to get WARD first.");
    const description = args.description.trim();
    if (description.length < 4 || description.length > 200) throw new Error("Describe the proposal in 4 to 200 characters.");
    const p: Proposal = {
      id: this.proposals.length,
      proposer: args.proposer,
      description,
      action: args.action,
      snapshot,
      supply: [...snapshot.values()].reduce((n, v) => n + v, 0n),
      votes: new Map(),
      opens: at,
      closes: at + this.votingDays * DAY,
      executedAt: null,
      tx: null,
    };
    this.proposals.push(p);
    return p;
  }

  async listProposals(): Promise<MutualProposalView[]> {
    return [...this.proposals].reverse().map((p) => this.view(p));
  }

  async getProposal(id: number): Promise<MutualProposalView | null> {
    const p = this.proposals[id];
    return p ? this.view(p) : null;
  }

  async propose(args: { proposer: string; description: string; action: MutualAction }): Promise<MutualProposalView> {
    return this.view(this.open(args));
  }

  async vote(args: { id: number; voter: string; support: VoteSupport }): Promise<MutualProposalView> {
    const p = this.get(args.id);
    if (this.status(p) !== "open") throw new Error("Voting on this proposal is closed.");
    if (p.votes.has(args.voter)) throw new Error(`${args.voter} already voted on this proposal.`);
    const weight = p.snapshot.get(args.voter) ?? 0n;
    if (weight === 0n) throw new Error(`${args.voter} held no WARD when this proposal opened, so it has no vote on it.`);
    p.votes.set(args.voter, { support: args.support, weight });
    return this.view(p);
  }

  async execute(id: number): Promise<MutualProposalView> {
    const p = this.get(id);
    const status = this.status(p);
    if (status === "executed") throw new Error("This proposal was already executed.");
    if (status !== "passed") throw new Error("Only a passed proposal can be executed.");
    await this.options.apply(p.action);
    p.executedAt = this.options.now().getTime();
    p.tx = simTx("execute", String(id));
    return this.view(p);
  }

  async voteOf(id: number, voter: string): Promise<{ support: VoteSupport; weight: string } | null> {
    const v = this.get(id).votes.get(voter);
    return v ? { support: v.support, weight: v.weight.toString() } : null;
  }

  async weightOf(id: number, voter: string): Promise<string> {
    return (this.get(id).snapshot.get(voter) ?? 0n).toString();
  }

  async params(): Promise<{ quorum_bps: number; voting_days: number }> {
    return { quorum_bps: this.quorumBps, voting_days: this.votingDays };
  }

  /** Seeds past and open proposals, with their votes, as if they had happened. */
  seed(seeds: GovernanceSeed[]): void {
    for (const s of seeds) {
      const p = this.open(s, this.options.now().getTime() - s.opened_days_ago * DAY, true);
      for (const [voter, support] of s.votes ?? []) {
        const weight = p.snapshot.get(voter) ?? 0n;
        if (weight > 0n) p.votes.set(voter, { support, weight });
      }
      if (s.execute && this.status(p) === "passed") {
        void this.options.apply(p.action);
        p.executedAt = Math.min(this.options.now().getTime(), p.closes);
        p.tx = simTx("execute", String(p.id));
      }
    }
  }
}
