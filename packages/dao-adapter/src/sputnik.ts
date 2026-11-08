/**
 * Sputnik DAO v2 shapes, from the sputnikdao2 contract source (proposals.rs, policy.rs). A group's
 * existing DAO (or Trezu treasury, which runs on the same contract) holds the shared AI budget.
 * We never deploy a multisig of our own.
 */

export type ProposalStatus = "InProgress" | "Approved" | "Rejected" | "Removed" | "Expired" | "Moved" | "Failed";

export interface ActionCall {
  method_name: string;
  /** Base64 of the JSON args. */
  args: string;
  /** yoctoNEAR, as a decimal string. */
  deposit: string;
  /** Gas units, as a decimal string. */
  gas: string;
}

export type ProposalKind =
  | { Transfer: { token_id: string; receiver_id: string; amount: string; msg?: string | null } }
  | { FunctionCall: { receiver_id: string; actions: ActionCall[] } }
  | Record<string, unknown>;

export interface ProposalInput {
  description: string;
  kind: ProposalKind;
}

export interface SputnikProposal {
  id: number;
  proposer: string;
  description: string;
  kind: ProposalKind;
  status: ProposalStatus;
  /** Per role: [approve, reject, remove]. */
  vote_counts: Record<string, [number, number, number]>;
  votes: Record<string, "Approve" | "Reject" | "Remove">;
  /** Nanoseconds since epoch, as a decimal string. */
  submission_time: string;
}

export interface SputnikPolicy {
  roles: { name: string; kind: unknown; permissions: string[]; vote_policy: Record<string, unknown> }[];
  /** yoctoNEAR a proposer attaches to add_proposal. */
  proposal_bond: string;
  /** Nanoseconds. */
  proposal_period: string;
}

export type VoteAction = "VoteApprove" | "VoteReject" | "VoteRemove";

export const DEFAULT_GAS = "100000000000000";
