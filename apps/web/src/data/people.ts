/**
 * One member's view: position, votes and the history behind their share. sim: composed from
 * /v1/mutual, /v1/pool/positions/:account and /v1/mutual/votes/:account. testnet: T4.7's
 * /v1/people/:account, once its response shape is documented.
 */
import type { MutualProposalView, MutualSummary, PoolPosition } from "../api/ai";
import { getMutual, getPosition, getVotes, getVoteWeight, type MemberVote } from "./mutual";
import { DATA_SOURCE, NotWiredYet } from "./source";

export interface Person {
  account: string;
  position: PoolPosition;
  mutual: MutualSummary;
  votes: MemberVote[];
  /** WARD the member held at each open proposal's snapshot. */
  weights: Record<number, string>;
  open: MutualProposalView[];
}

export async function getPerson(account: string): Promise<Person> {
  if (DATA_SOURCE === "testnet") throw new NotWiredYet("/v1/people/:account");
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
