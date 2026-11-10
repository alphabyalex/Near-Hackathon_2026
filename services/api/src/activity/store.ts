import type { Deps } from "../service.js";
import { activityPaths, auditedRows, readIfExists, type ActivityRow } from "./log.js";
import type { ActivityItem, ActivityStats, CommunitySummary, MemberVote, PersonView } from "./types.js";

/** Thrown when near mode would serve rows no audit has checked. The route answers 503. */
export class ActivityNotAudited extends Error {
  readonly code = "ACTIVITY_NOT_AUDITED";
}

const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";

function toItem(r: ActivityRow): ActivityItem {
  return {
    at: r.at,
    actor: r.actor,
    community: r.community,
    group: r.community,
    budget_id: r.community,
    kind: r.kind,
    side: r.side,
    text: r.text,
    amount: r.amount,
    model: r.model,
    outcome: r.outcome,
    reason: r.reason,
    tx: r.tx,
    tx_hash: r.tx,
    block_height: r.block_height,
    explorer_url: `${EXPLORER_TX}${r.tx}`,
  };
}

/**
 * The testnet activity routes. Rows come only from the audited prefix of data/testnet/activity.jsonl
 * (see log.ts). Every number comes from chain views (pool, claims, reputations, budgets); the log is
 * never used to raise or fill in a number.
 */
export class ActivityStore {
  constructor(
    private readonly deps: Deps,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  /** Audited rows, newest first. In near mode an unaudited log throws ActivityNotAudited. */
  readLog(): ActivityItem[] {
    const paths = activityPaths(this.env);
    const read = auditedRows(readIfExists(paths.log), readIfExists(paths.audit));
    if (!read.audited && this.deps.ai.chain.mode === "near") throw new ActivityNotAudited(read.reason ?? "The activity log has not passed an audit.");
    return read.rows.map(toItem).sort((a, b) => b.at.localeCompare(a.at) || b.block_height - a.block_height);
  }

  async getStats(): Promise<ActivityStats> {
    const chain = this.deps.ai.chain;
    const [pool, claims, groups] = await Promise.all([chain.pool.getPool(), chain.pool.listClaims(), chain.reputation.listReputations()]);

    const below = {
      swapped: groups.reduce((n, g) => n + g.refused_calls, 0),
      lookalike: groups.reduce((n, g) => n + g.blocked_payees, 0),
      capped: groups.reduce((n, g) => n + g.capped_calls, 0),
      total: 0,
    };
    below.total = below.swapped + below.lookalike + below.capped;
    const proven = groups.reduce((n, g) => n + g.proven_calls, 0);
    const paidClaims = claims.filter((c) => c.status === "paid");

    return {
      total_pooled: pool.tvl,
      ward_price: pool.ward_price,
      launch_price: pool.launch_price,
      yield_earned: pool.fees_earned,
      groups_covered: groups.length,
      proven_payments: proven,
      payouts: paidClaims.length,
      price_history: pool.price_history ?? [],
      below,
      paid_above: proven,
      kept_below: below,
      fees_earned: pool.fees_earned,
      claims: { count: paidClaims.length, total: paidClaims.reduce((n, c) => n + BigInt(c.amount || "0"), 0n).toString() },
    };
  }

  async getCommunities(): Promise<CommunitySummary[]> {
    const chain = this.deps.ai.chain;
    const reputations = await chain.reputation.listReputations();
    const summaries: CommunitySummary[] = [];
    for (const r of reputations) {
      const budget = await chain.meter.getBudget(r.budget_id);
      const members = budget?.members.map((m) => m.member) ?? [];
      summaries.push({
        id: r.budget_id,
        budget_id: r.budget_id,
        name: r.name || r.budget_id,
        owner: r.owner,
        dao_account: r.owner,
        members,
        members_count: members.length,
        deposit: budget?.deposit ?? "0",
        spent: budget?.spent ?? r.spent,
        coverage_cap: r.coverage_cap,
        fee_bps: r.fee_bps,
        claims: r.claims,
        next_tier_at: r.next_tier_at,
        period: budget?.period ?? null,
        budget: { deposit: budget?.deposit ?? "0", spent: budget?.spent ?? r.spent, reserved: budget?.reserved ?? "0", period: budget?.period ?? "" },
        tier: r.tier,
        proven_calls: r.proven_calls,
        clean_calls: r.clean_calls,
        refused_calls: r.refused_calls,
        capped_calls: r.capped_calls,
        blocked_payees: r.blocked_payees,
        fees_paid: r.fees_paid,
      });
    }
    return summaries;
  }

  async getCommunity(id: string): Promise<{ community: CommunitySummary | null; recent_activity: ActivityItem[] }> {
    const communities = await this.getCommunities();
    const found = communities.find((c) => c.id === id) ?? null;
    const recentActivity = found ? this.readLog().filter((i) => i.community === id).slice(0, 20) : [];
    return { community: found, recent_activity: recentActivity };
  }

  async getPerson(account: string): Promise<PersonView> {
    const chain = this.deps.ai.chain;
    const [pool, position, claims, governance, params] = await Promise.all([
      chain.pool.getPool(),
      chain.pool.getPosition(account),
      chain.pool.listClaims(),
      chain.governance.listProposals(),
      chain.governance.params(),
    ]);

    const openProposals = governance.filter((p) => p.status === "open");
    const weights: Record<number, string> = {};
    for (const p of openProposals) weights[p.id] = await chain.governance.weightOf(p.id, account);

    const memberVotes: MemberVote[] = [];
    if (chain.governance.voteOf) {
      for (const p of governance) {
        const v = await chain.governance.voteOf(p.id, account);
        if (v) memberVotes.push({ id: p.id, support: v.support, weight: v.weight });
      }
    }

    return {
      account,
      // The position is the pool's own record. Logged deposits are history, not a second source.
      position,
      mutual: {
        pool,
        claims,
        governance: { proposals: governance, voting_period_days: params.voting_days, vote_threshold_bps: params.quorum_bps, quorum_bps: params.quorum_bps, timelock_days: 0 },
      },
      votes: memberVotes,
      weights,
      open: openProposals,
      history: this.readLog().filter((i) => i.actor === account).slice(0, 50),
    };
  }
}
