/**
 * An in-memory Sputnik DAO v2 that answers the same view calls as the contract, so sim mode and tests
 * go through exactly the decode path a real DAO does.
 */

import type { ViewProvider } from "./client.js";
import type { ProposalInput, SputnikPolicy, SputnikProposal, VoteAction } from "./sputnik.js";

export interface SimDao {
  provider: ViewProvider;
  propose(proposer: string, input: ProposalInput, at: Date): number;
  act(id: number, voter: string, vote: VoteAction): void;
  proposals(): SputnikProposal[];
}

export function createSimDao(options: { policy?: Partial<SputnikPolicy>; councilSize?: number; seed?: { proposer: string; input: ProposalInput; at: Date; votes?: [string, VoteAction][] }[] } = {}): SimDao {
  const policy: SputnikPolicy = {
    roles: [{ name: "council", kind: { Group: [] }, permissions: ["*:*"], vote_policy: {} }],
    proposal_bond: "100000000000000000000000",
    proposal_period: "604800000000000",
    ...options.policy,
  };
  const quorum = Math.floor((options.councilSize ?? 3) / 2) + 1;
  const list: SputnikProposal[] = [];

  const sim: SimDao = {
    provider: {
      callFunction: (async ({ method, args }: { method: string; args: Record<string, unknown> }) => {
        if (method === "get_policy") return structuredClone(policy);
        if (method === "get_last_proposal_id") return list.length;
        if (method === "get_proposals") {
          const from = Number(args.from_index ?? 0);
          return structuredClone(list.slice(from, from + Number(args.limit ?? 50)));
        }
        if (method === "get_proposal") {
          const p = list[Number(args.id)];
          if (!p) throw new Error("ERR_NO_PROPOSAL");
          return structuredClone(p);
        }
        throw new Error(`MethodNotFound: ${method}`);
      }) as unknown as ViewProvider["callFunction"],
    },
    propose(proposer, input, at) {
      list.push({ id: list.length, proposer, description: input.description, kind: input.kind, status: "InProgress", vote_counts: {}, votes: {}, submission_time: (BigInt(at.getTime()) * 1_000_000n).toString() });
      return list.length - 1;
    },
    act(id, voter, vote) {
      const p = list[id];
      if (!p || p.status !== "InProgress") throw new Error("ERR_PROPOSAL_NOT_READY_FOR_VOTE");
      p.votes[voter] = vote === "VoteApprove" ? "Approve" : vote === "VoteReject" ? "Reject" : "Remove";
      const tally: [number, number, number] = [0, 0, 0];
      for (const v of Object.values(p.votes)) tally[v === "Approve" ? 0 : v === "Reject" ? 1 : 2]++;
      p.vote_counts = { council: tally };
      if (tally[0] >= quorum) p.status = "Approved";
      else if (tally[1] >= quorum) p.status = "Rejected";
      else if (tally[2] >= quorum) p.status = "Removed";
    },
    proposals: () => structuredClone(list),
  };
  for (const s of options.seed ?? []) {
    const id = sim.propose(s.proposer, s.input, s.at);
    for (const [voter, vote] of s.votes ?? []) sim.act(id, voter, vote);
  }
  return sim;
}
