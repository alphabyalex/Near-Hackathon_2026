/**
 * The six Wardline decisions a group makes through its DAO, mapped to Sputnik v2 proposal kinds, and
 * back again so a page can show what a pending proposal will do.
 * TODO(tharun): method names and args follow the interface notes until docs/DAO.md lands. They live
 * only in CONTRACT_METHODS below, so a rename is one edit.
 */

import { DEFAULT_GAS, type ActionCall, type ProposalInput, type ProposalKind } from "./sputnik.js";

export interface WardlineContracts {
  meter: string;
  registry: string;
  pool: string;
  /** WUSD token contract. */
  token: string;
  /** Vault whose payout accounts the group controls. */
  vault: string;
}

export const CONTRACT_METHODS = {
  setAllowance: "set_allowance",
  addProvider: "add_provider",
  approveEndpoint: "approve_endpoint",
  setPoolParam: "set_param",
  approveClaim: "approve_claim",
} as const;

export type WardlineAction =
  | { type: "fund_budget"; budget_id: string; amount: string }
  | { type: "set_allowance"; budget_id: string; member: string; allowance: string }
  | { type: "add_provider"; provider_id: string; pay_to: string; model_ids: string[] }
  | { type: "approve_payout_change"; vendor_id: string; revision: number; account: string }
  | { type: "set_pool_param"; name: string; value: string }
  | { type: "approve_claim"; claim_id: string };

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64");
const unb64 = (text: string): unknown => JSON.parse(Buffer.from(text, "base64").toString("utf8"));
const call = (method_name: string, args: unknown): ActionCall => ({ method_name, args: b64(args), deposit: "0", gas: DEFAULT_GAS });

/** One line a voter reads in their DAO app. */
export function describeAction(a: WardlineAction): string {
  switch (a.type) {
    case "fund_budget":
      return `Fund AI budget ${a.budget_id} with ${a.amount} atomic WUSD`;
    case "set_allowance":
      return `Set ${a.member}'s allowance in ${a.budget_id} to ${a.allowance} atomic WUSD`;
    case "add_provider":
      return `Add AI provider ${a.provider_id} (pays ${a.pay_to}) for ${a.model_ids.join(", ")}`;
    case "approve_payout_change":
      return `Approve payout account ${a.account} for vendor ${a.vendor_id} (revision ${a.revision})`;
    case "set_pool_param":
      return `Set Wardline Mutual parameter ${a.name} to ${a.value}`;
    case "approve_claim":
      return `Approve Wardline Mutual claim ${a.claim_id}`;
  }
}

/** The Sputnik proposal for one decision. Funding is a Transfer with msg, which the DAO runs as ft_transfer_call. */
export function buildProposal(action: WardlineAction, contracts: WardlineContracts, note?: string): ProposalInput {
  const description = `${describeAction(action)}${note ? `. ${note}` : ""}`;
  let kind: ProposalKind;
  switch (action.type) {
    case "fund_budget":
      kind = { Transfer: { token_id: contracts.token, receiver_id: contracts.meter, amount: action.amount, msg: JSON.stringify({ action: "fund", budget_id: action.budget_id }) } };
      break;
    case "set_allowance":
      kind = { FunctionCall: { receiver_id: contracts.meter, actions: [call(CONTRACT_METHODS.setAllowance, { budget_id: action.budget_id, member: action.member, allowance: action.allowance })] } };
      break;
    case "add_provider":
      kind = { FunctionCall: { receiver_id: contracts.registry, actions: [call(CONTRACT_METHODS.addProvider, { provider_id: action.provider_id, pay_to: action.pay_to, model_ids: action.model_ids })] } };
      break;
    case "approve_payout_change":
      kind = { FunctionCall: { receiver_id: contracts.vault, actions: [call(CONTRACT_METHODS.approveEndpoint, { vendor_id: action.vendor_id, revision: action.revision, account: action.account })] } };
      break;
    case "set_pool_param":
      kind = { FunctionCall: { receiver_id: contracts.pool, actions: [call(CONTRACT_METHODS.setPoolParam, { name: action.name, value: action.value })] } };
      break;
    case "approve_claim":
      kind = { FunctionCall: { receiver_id: contracts.pool, actions: [call(CONTRACT_METHODS.approveClaim, { claim_id: action.claim_id })] } };
      break;
  }
  return { description, kind };
}

/** A plain transfer out of the treasury, the kind that pays vendors. */
export interface TreasuryTransfer {
  token_id: string;
  receiver_id: string;
  amount: string;
  msg: string | null;
}

/** Reads a proposal kind back into a Wardline decision or a treasury transfer, or neither. */
export function decodeProposal(kind: ProposalKind, contracts: WardlineContracts): { action: WardlineAction | null; transfer: TreasuryTransfer | null } {
  if ("Transfer" in kind && kind.Transfer && typeof kind.Transfer === "object") {
    const t = kind.Transfer as { token_id: string; receiver_id: string; amount: string; msg?: string | null };
    if (t.receiver_id === contracts.meter && t.msg) {
      try {
        const msg = JSON.parse(t.msg) as { action?: string; budget_id?: string };
        if (msg.action === "fund" && msg.budget_id) return { action: { type: "fund_budget", budget_id: msg.budget_id, amount: t.amount }, transfer: null };
      } catch {
        // Not ours; fall through to a plain transfer.
      }
    }
    return { action: null, transfer: { token_id: t.token_id, receiver_id: t.receiver_id, amount: t.amount, msg: t.msg ?? null } };
  }
  if ("FunctionCall" in kind && kind.FunctionCall && typeof kind.FunctionCall === "object") {
    const f = kind.FunctionCall as { receiver_id: string; actions: ActionCall[] };
    const first = f.actions[0];
    if (!first || f.actions.length !== 1) return { action: null, transfer: null };
    let args: Record<string, unknown>;
    try {
      args = unb64(first.args) as Record<string, unknown>;
    } catch {
      return { action: null, transfer: null };
    }
    const m = first.method_name;
    if (f.receiver_id === contracts.meter && m === CONTRACT_METHODS.setAllowance) return { action: { type: "set_allowance", budget_id: String(args.budget_id), member: String(args.member), allowance: String(args.allowance) }, transfer: null };
    if (f.receiver_id === contracts.registry && m === CONTRACT_METHODS.addProvider) return { action: { type: "add_provider", provider_id: String(args.provider_id), pay_to: String(args.pay_to), model_ids: (args.model_ids as string[]) ?? [] }, transfer: null };
    if (f.receiver_id === contracts.vault && m === CONTRACT_METHODS.approveEndpoint) return { action: { type: "approve_payout_change", vendor_id: String(args.vendor_id), revision: Number(args.revision), account: String(args.account) }, transfer: null };
    if (f.receiver_id === contracts.pool && m === CONTRACT_METHODS.setPoolParam) return { action: { type: "set_pool_param", name: String(args.name), value: String(args.value) }, transfer: null };
    if (f.receiver_id === contracts.pool && m === CONTRACT_METHODS.approveClaim) return { action: { type: "approve_claim", claim_id: String(args.claim_id) }, transfer: null };
    // A token transfer made as a function call is still a payout.
    if (m === "ft_transfer" && typeof args.receiver_id === "string") return { action: null, transfer: { token_id: f.receiver_id, receiver_id: args.receiver_id, amount: String(args.amount), msg: null } };
  }
  return { action: null, transfer: null };
}
