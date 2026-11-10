/** Groups and their reputation. T4.7's /v1/communities lands here for WARDLINE_DATA=testnet. */
import { getGroups as fetchGroups } from "../api/ai";
import { apiGet } from "../api/client";
import { DATA_SOURCE } from "./source";

export type { GroupSummary, TierRules, ReputationView } from "../api/ai";

export const getGroups = fetchGroups;

export interface CommunitySummary {
  id: string;
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
