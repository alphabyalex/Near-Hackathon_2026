/** Groups and their reputation. T4.7's /v1/communities will land here for WARDLINE_DATA=testnet. */
import { getGroups as fetchGroups } from "../api/ai";
import { DATA_SOURCE, NotWiredYet } from "./source";

export type { GroupSummary, TierRules, ReputationView } from "../api/ai";

export const getGroups = fetchGroups;

/** Testnet communities with real treasuries (T4.7). Not wired until its response shape is documented. */
export async function getCommunities(): Promise<never> {
  throw new NotWiredYet(DATA_SOURCE === "testnet" ? "/v1/communities" : "/v1/communities (read when WARDLINE_DATA=testnet)");
}
