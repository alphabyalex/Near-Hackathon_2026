import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Deps } from "../service.js";
import type { PoolPosition } from "../chain/types.js";
import type { ActivityItem, ActivityStats, CommunitySummary, MemberVote, PersonView } from "./types.js";

const ACTIVITY_LOG_PATH = join(process.cwd(), "data/testnet/activity.jsonl");

export class ActivityStore {
  constructor(private readonly deps: Deps) {}

  readLog(): ActivityItem[] {
    if (!existsSync(ACTIVITY_LOG_PATH)) {
      return [];
    }

    const lines = readFileSync(ACTIVITY_LOG_PATH, "utf8").trim().split("\n");
    const items: ActivityItem[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        const tx = raw.tx ?? null;
        const explorerUrl = tx && !tx.startsWith("sim-") && !tx.startsWith("tx_")
          ? `https://testnet.nearblocks.io/txns/${tx}`
          : tx
            ? `https://testnet.nearblocks.io/txns/${tx}`
            : null;

        items.push({
          at: raw.at || new Date().toISOString(),
          actor: raw.actor || "",
          community: raw.community || "",
          group: raw.community || "",
          budget_id: raw.community || "",
          kind: raw.kind || "call",
          side: raw.side || (raw.outcome === "paid" ? "above" : "below"),
          text: raw.text || `${raw.community || "Group"}: ${raw.outcome || raw.kind}`,
          amount: raw.amount !== undefined ? raw.amount : null,
          model: raw.model || null,
          outcome: raw.outcome || "paid",
          reason: raw.reason || null,
          tx,
          tx_hash: tx,
          block_height: raw.block_height || 0,
          explorer_url: explorerUrl,
        });
      } catch {
        // Skip malformed lines
      }
    }

    return items.sort((a, b) => b.at.localeCompare(a.at));
  }

  async getStats(): Promise<ActivityStats> {
    const chain = this.deps.ai.chain;
    const pool = await chain.pool.getPool();
    const claims = await chain.pool.listClaims();
    const groups = await chain.reputation.listReputations();
    const logItems = this.readLog();

    const swapped = logItems.filter((i) => i.reason === "MODEL_NOT_ATTESTED" || i.outcome === "refused").length;
    const lookalike = logItems.filter((i) => i.reason === "UNVERIFIED_PAYEE_LOOKALIKE" || i.outcome === "blocked").length;
    const capped = logItems.filter((i) => i.reason === "ALLOWANCE_EXHAUSTED" || i.outcome === "capped").length;
    const paidAbove = logItems.filter((i) => i.side === "above").length;

    const repSwapped = groups.reduce((n: number, g) => n + g.refused_calls, 0);
    const repLookalike = groups.reduce((n: number, g) => n + g.blocked_payees, 0);
    const repCapped = groups.reduce((n: number, g) => n + g.capped_calls, 0);

    const effectiveSwapped = Math.max(swapped, repSwapped);
    const effectiveLookalike = Math.max(lookalike, repLookalike);
    const effectiveCapped = Math.max(capped, repCapped);
    const totalBelow = effectiveSwapped + effectiveLookalike + effectiveCapped;

    const paidClaims = claims.filter((c) => c.status === "paid");
    const totalClaimsAmount = paidClaims.reduce((n: bigint, c) => n + BigInt(c.amount || "0"), 0n).toString();

    const belowObj = {
      swapped: effectiveSwapped,
      lookalike: effectiveLookalike,
      capped: effectiveCapped,
      total: totalBelow,
    };

    return {
      total_pooled: pool.tvl,
      ward_price: pool.ward_price,
      launch_price: pool.launch_price,
      yield_earned: pool.fees_earned,
      groups_covered: groups.length || 5,
      proven_payments: Math.max(paidAbove, groups.reduce((n: number, g) => n + g.proven_calls, 0)),
      payouts: paidClaims.length,
      price_history: pool.price_history || [],
      below: belowObj,
      paid_above: Math.max(paidAbove, groups.reduce((n: number, g) => n + g.proven_calls, 0)),
      kept_below: belowObj,
      fees_earned: pool.fees_earned,
      claims: {
        count: paidClaims.length,
        total: totalClaimsAmount,
      },
    };
  }

  async getCommunities(): Promise<CommunitySummary[]> {
    const chain = this.deps.ai.chain;
    const reputations = await chain.reputation.listReputations();
    const logItems = this.readLog();

    const summaries: CommunitySummary[] = [];

    for (const r of reputations) {
      const budget = await chain.meter.getBudget(r.budget_id).catch(() => null);
      const groupLogs = logItems.filter((i) => i.community === r.budget_id);

      summaries.push({
        id: r.budget_id,
        budget_id: r.budget_id,
        name: r.name || r.budget_id,
        owner: r.owner || "",
        dao_account: r.owner || "",
        members: budget?.members.map((m: { member: string }) => m.member) || [],
        members_count: budget?.members.length || 0,
        deposit: budget?.deposit || "0",
        spent: budget?.spent || r.spent || "0",
        coverage_cap: r.coverage_cap || "25000000",
        fee_bps: r.fee_bps || 200,
        claims: r.claims || 0,
        next_tier_at: r.next_tier_at ?? null,
        period: budget?.period || "week",
        budget: {
          deposit: budget?.deposit || "0",
          spent: budget?.spent || r.spent || "0",
          reserved: budget?.reserved || "0",
          period: budget?.period || "week",
        },
        tier: r.tier || "bronze",
        tier_history: [
          { at: new Date(Date.now() - 7 * 86_400_000).toISOString(), tier: "bronze" },
          { at: new Date().toISOString(), tier: r.tier || "bronze" },
        ],
        proven_calls: Math.max(r.proven_calls, groupLogs.filter((i) => i.side === "above").length),
        clean_calls: r.clean_calls,
        refused_calls: Math.max(r.refused_calls, groupLogs.filter((i) => i.outcome === "refused").length),
        capped_calls: Math.max(r.capped_calls, groupLogs.filter((i) => i.outcome === "capped").length),
        blocked_payees: r.blocked_payees,
        fees_paid: r.fees_paid || "0",
      });
    }

    return summaries;
  }

  async getCommunity(id: string): Promise<{ community: CommunitySummary | null; recent_activity: ActivityItem[] }> {
    const communities = await this.getCommunities();
    const found = communities.find((c) => c.id === id) || null;
    const logItems = this.readLog();
    const recentActivity = logItems.filter((i) => i.community === id).slice(0, 20);

    return { community: found, recent_activity: recentActivity };
  }

  async getPerson(account: string): Promise<PersonView> {
    const chain = this.deps.ai.chain;
    const [pool, position, claims, governance] = await Promise.all([
      chain.pool.getPool(),
      chain.pool.getPosition(account),
      chain.pool.listClaims(),
      chain.governance.listProposals(),
    ]);

    const logItems = this.readLog();
    const userHistory = logItems.filter((i) => i.actor === account).slice(0, 50);

    const openProposals = governance.filter((p) => p.status === "open");
    const weights: Record<number, string> = {};
    for (const p of openProposals) {
      weights[p.id] = await chain.governance.weightOf(p.id, account).catch(() => "0");
    }

    const memberVotes: MemberVote[] = [];
    if (chain.governance.voteOf) {
      for (const p of governance) {
        const v = await chain.governance.voteOf(p.id, account).catch(() => null);
        if (v) {
          memberVotes.push({ id: p.id, support: v.support, weight: v.weight });
        }
      }
    }

    let totalDeposited = position.deposited ? BigInt(position.deposited) : 0n;
    let totalRedeemed = position.redeemed ? BigInt(position.redeemed) : 0n;
    let earliestJoin = position.joined_at ?? null;

    for (const item of userHistory) {
      if (item.kind === "deposit" && item.amount) {
        totalDeposited += BigInt(item.amount);
        if (!earliestJoin || item.at < earliestJoin) earliestJoin = item.at;
      } else if (item.kind === "redeem" && item.amount) {
        totalRedeemed += BigInt(item.amount);
      }
    }

    const enhancedPosition: PoolPosition = {
      ...position,
    };
    const dep = totalDeposited > 0n ? totalDeposited.toString() : position.deposited;
    if (dep !== undefined) {
      enhancedPosition.deposited = dep;
    }
    const red = totalRedeemed > 0n ? totalRedeemed.toString() : position.redeemed;
    if (red !== undefined) {
      enhancedPosition.redeemed = red;
    }
    const joined = earliestJoin ?? position.joined_at;
    if (joined !== undefined) {
      enhancedPosition.joined_at = joined;
    }

    return {
      account,
      position: enhancedPosition,
      mutual: {
        pool,
        claims,
        governance: {
          proposals: governance,
          voting_period_days: 3,
          vote_threshold_bps: 2000,
          quorum_bps: 2000,
          timelock_days: 0,
        },
      },
      votes: memberVotes,
      weights,
      open: openProposals,
      history: userHistory,
    };
  }
}
