/**
 * Reads and writes proposals on an existing Sputnik DAO v2. Reads use RPC view calls. Writes return
 * the exact transaction a member's wallet signs (add_proposal with the policy's bond, act_proposal),
 * and can also be sent from a server-side signer for scripts.
 */

import { JsonRpcProvider, type Provider } from "near-api-js";
import { buildProposal, decodeProposal, type TreasuryTransfer, type WardlineAction, type WardlineContracts } from "./actions.js";
import { DEFAULT_GAS, type ProposalInput, type ProposalStatus, type SputnikPolicy, type SputnikProposal, type VoteAction } from "./sputnik.js";

/** The part of a near-api-js Provider this adapter uses, so tests can mock RPC. */
export type ViewProvider = Pick<Provider, "callFunction">;

/** One function call for a wallet to sign: wallet-selector's signAndSendTransaction takes this shape. */
export interface DaoTransaction {
  receiverId: string;
  actions: { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }[];
}

export interface ProposalView {
  id: number;
  dao: string;
  proposer: string;
  description: string;
  status: ProposalStatus;
  submittedAt: string;
  approvals: number;
  rejections: number;
  /** What it will do, if it is one of ours. */
  action: WardlineAction | null;
  /** If it pays someone out of the treasury. */
  transfer: TreasuryTransfer | null;
}

export interface DaoClient {
  readonly dao: string;
  getPolicy(): Promise<SputnikPolicy>;
  listProposals(options?: { fromIndex?: number; limit?: number }): Promise<ProposalView[]>;
  getProposal(id: number): Promise<ProposalView | null>;
  /** The add_proposal transaction for one Wardline decision, bond included. */
  proposeTx(action: WardlineAction, note?: string): Promise<DaoTransaction>;
  voteTx(id: number, vote: VoteAction): DaoTransaction;
}

export interface SputnikOptions {
  dao: string;
  contracts: WardlineContracts;
  provider?: ViewProvider;
  rpcUrl?: string;
}

const nsToIso = (ns: string): string => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();

export function viewProposal(dao: string, raw: SputnikProposal, contracts: WardlineContracts): ProposalView {
  const counts = Object.values(raw.vote_counts ?? {});
  const decoded = decodeProposal(raw.kind, contracts);
  return {
    id: raw.id,
    dao,
    proposer: raw.proposer,
    description: raw.description,
    status: raw.status,
    submittedAt: nsToIso(raw.submission_time),
    approvals: counts.reduce((n, c) => n + (c[0] ?? 0), 0),
    rejections: counts.reduce((n, c) => n + (c[1] ?? 0), 0),
    action: decoded.action,
    transfer: decoded.transfer,
  };
}

export function addProposalTx(dao: string, input: ProposalInput, bond: string): DaoTransaction {
  return { receiverId: dao, actions: [{ type: "FunctionCall", params: { methodName: "add_proposal", args: { proposal: input }, gas: DEFAULT_GAS, deposit: bond } }] };
}

export function actProposalTx(dao: string, id: number, vote: VoteAction): DaoTransaction {
  return { receiverId: dao, actions: [{ type: "FunctionCall", params: { methodName: "act_proposal", args: { id, action: vote }, gas: DEFAULT_GAS, deposit: "0" } }] };
}

export function createSputnikClient(options: SputnikOptions): DaoClient {
  const provider: ViewProvider = options.provider ?? new JsonRpcProvider({ url: options.rpcUrl ?? "https://test.rpc.fastnear.com" });
  const view = async <T>(method: string, args: Record<string, unknown> = {}): Promise<T> =>
    (await provider.callFunction({ contractId: options.dao, method, args, blockQuery: { finality: "final" } })) as T;
  return {
    dao: options.dao,
    getPolicy: () => view<SputnikPolicy>("get_policy"),
    async listProposals({ fromIndex, limit = 50 } = {}) {
      let from = fromIndex;
      if (from === undefined) {
        const last = await view<number>("get_last_proposal_id");
        from = Math.max(0, last - limit);
      }
      const raw = await view<SputnikProposal[]>("get_proposals", { from_index: from, limit });
      return raw.map((p) => viewProposal(options.dao, p, options.contracts)).sort((a, b) => b.id - a.id);
    },
    async getProposal(id) {
      try {
        return viewProposal(options.dao, await view<SputnikProposal>("get_proposal", { id }), options.contracts);
      } catch {
        return null;
      }
    },
    async proposeTx(action, note) {
      const policy = await view<SputnikPolicy>("get_policy");
      return addProposalTx(options.dao, buildProposal(action, options.contracts, note), policy.proposal_bond);
    },
    voteTx: (id, vote) => actProposalTx(options.dao, id, vote),
  };
}
