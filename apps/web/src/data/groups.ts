/** Groups and their reputation. T4.7's /v1/communities lands here for WARDLINE_DATA=testnet. */
import { getGroups as fetchGroups, type GroupSummary, type TierRules } from "../api/ai";
import { apiGet } from "../api/client";
import { DATA_SOURCE } from "./source";

export type { GroupSummary, TierRules, ReputationView } from "../api/ai";

export interface CommunitySummary {
  id: string;
  budget_id?: string;
  name: string;
  owner: string;
  dao_account?: string;
  members: string[];
  members_count?: number;
  deposit?: string;
  spent?: string;
  coverage_cap?: string;
  fee_bps?: number;
  claims?: number;
  next_tier_at?: number | null;
  period?: string | null;
  budget: {
    deposit: string;
    spent: string;
    reserved: string;
    period: string;
  };
  tier: string;
  proven_calls: number;
  clean_calls: number;
  refused_calls: number;
  capped_calls: number;
  blocked_payees: number;
  fees_paid: string;
}

/** Testnet communities with real treasuries (T4.7). */
export async function getCommunities(): Promise<CommunitySummary[]> {
  const res = await apiGet<{ communities: CommunitySummary[] }>("/v1/communities");
  return res.communities;
}

export async function getGroups(): Promise<{ mode: "sim" | "near"; groups: GroupSummary[]; tiers: TierRules }> {
  if (DATA_SOURCE === "testnet") {
    try {
      const [{ communities }, fallback] = await Promise.all([
        apiGet<{ communities: CommunitySummary[] }>("/v1/communities"),
        fetchGroups(),
      ]);
      const groups: GroupSummary[] = communities.map((c) => ({
        budget_id: c.budget_id || c.id,
        name: c.name,
        owner: c.owner,
        tier: c.tier as any,
        proven_calls: c.proven_calls,
        refused_calls: c.refused_calls,
        capped_calls: c.capped_calls,
        blocked_payees: c.blocked_payees,
        claims: c.claims || 0,
        clean_calls: c.clean_calls,
        next_tier_at: c.next_tier_at ?? null,
        fee_bps: c.fee_bps ?? 200,
        coverage_cap: c.coverage_cap || "25000000",
        spent: c.spent || "0",
        fees_paid: c.fees_paid || "0",
        deposit: c.deposit || c.budget?.deposit || "0",
        members: c.members_count ?? c.members?.length ?? 0,
        period: c.period || c.budget?.period || null,
      }));
      return {
        mode: "near",
        groups,
        tiers: fallback.tiers,
      };
    } catch {
      return fetchGroups();
    }
  }
  return fetchGroups();
}
