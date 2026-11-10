/**
 * One member's view: position, votes and the history behind their share. sim: composed from
 * /v1/mutual, /v1/pool/positions/:account and /v1/mutual/votes/:account. testnet: T4.7's
 * /v1/people/:account.
 */
import type { MutualProposalView, MutualSummary, PoolPosition } from "../api/ai";
import { apiGet } from "../api/client";
import { getMutual, getPosition, getVotes, getVoteWeight, type MemberVote } from "./mutual";
import { DATA_SOURCE } from "./source";

export interface Person {
  account: string;
  position: PoolPosition;
  mutual: MutualSummary;
  votes: MemberVote[];
  /** WARD the member held at each open proposal's snapshot. */
  weights: Record<number, string>;
  open: MutualProposalView[];
  /** testnet: this account's audited transactions, newest first. */
  history?: Array<{ at: string; text: string; tx: string | null; side: "above" | "below" }>;
}

export async function getPerson(account: string): Promise<Person> {
  if (DATA_SOURCE === "testnet") {
    // /v1/mutual is the whole Mutual summary (pool, stats, groups, tiers, proposals), read from the
    // contracts in near mode. /v1/people adds the pool's record of this account and its WARD weights.
    const [mutual, res] = await Promise.all([
      getMutual(),
      apiGet<{ account: string; position: PoolPosition; votes: MemberVote[]; weights: Record<number, string>; open: MutualProposalView[]; history: NonNullable<Person["history"]> }>(`/v1/people/${encodeURIComponent(account)}`),
    ]);
    return { account: res.account, position: res.position, mutual, votes: res.votes, weights: res.weights, open: res.open, history: res.history };
  }
  const [mutual, position, { votes }] = await Promise.all([getMutual(), getPosition(account), getVotes(account)]);
  const open = mutual.governance.proposals.filter((p) => p.status === "open");
  const weights: Record<number, string> = {};
  await Promise.all(
    open.map(async (p) => {
      weights[p.id] = (await getVoteWeight(p.id, account).catch(() => ({ weight: "0" }))).weight;
    }),
  );
  return { account, position, mutual, votes, weights, open };
}
