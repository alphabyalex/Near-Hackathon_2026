/** Groups and their reputation. T4.7's /v1/communities lands here for WARDLINE_DATA=testnet. */
import { getGroups as fetchGroups, type GroupSummary, type TierRules } from "../api/ai";
import { apiGet } from "../api/client";
import { DATA_SOURCE } from "./source";

export type { GroupSummary, TierRules, ReputationView } from "../api/ai";

/** One community from /v1/communities. The API fills every field from chain views. */
export interface CommunitySummary {
  id: string;
  budget_id?: string;
  name: string;
  owner: string;
  dao_account: string;
  members: string[];
  members_count: number;
  deposit: string;
  spent: string;
  coverage_cap: string;
  fee_bps: number;
  claims: number;
  next_tier_at: number | null;
  period: string | null;
  budget: { deposit: string; spent: string; reserved: string; period: string };
  tier: "bronze" | "silver" | "gold";
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

/**
 * sim: /v1/groups. testnet: /v1/communities, every number from the meter's reputation and budgets; the
 * tier table still comes from /v1/groups. A failure is shown as one, never replaced by simulated groups.
 */
export async function getGroups(): Promise<{ mode: "sim" | "near"; groups: GroupSummary[]; tiers: TierRules }> {
  if (DATA_SOURCE !== "testnet") return fetchGroups();
  const [{ communities }, { tiers }] = await Promise.all([apiGet<{ communities: CommunitySummary[] }>("/v1/communities"), fetchGroups()]);
  const groups: GroupSummary[] = communities.map((c) => ({
    budget_id: c.budget_id ?? c.id,
    name: c.name,
    owner: c.owner,
    tier: c.tier,
    proven_calls: c.proven_calls,
    refused_calls: c.refused_calls,
    capped_calls: c.capped_calls,
    blocked_payees: c.blocked_payees,
    claims: c.claims,
    clean_calls: c.clean_calls,
    next_tier_at: c.next_tier_at,
    fee_bps: c.fee_bps,
    coverage_cap: c.coverage_cap,
    spent: c.spent,
    fees_paid: c.fees_paid,
    deposit: c.deposit,
    members: c.members_count,
    period: c.period,
  }));
  // Most proven calls first: the communities with a record lead the page.
  groups.sort((a, b) => b.proven_calls - a.proven_calls || a.name.localeCompare(b.name));
  return { mode: "near", groups, tiers };
}

/** One community and its latest audited transactions (the testnet data source). */
export async function getCommunity(id: string): Promise<{ community: CommunitySummary; recent_activity: Array<{ at: string; text: string; tx: string | null; side: "above" | "below" }> }> {
  return apiGet(`/v1/communities/${encodeURIComponent(id)}`);
}
