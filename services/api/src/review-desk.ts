import { createHash } from "node:crypto";
import { canonicalJson } from "@redline/agent";
import type { EvidenceTier, Payable, PayeeReason, PayeeVerdict } from "@redline/schemas";
import { chainOf, normalizeAccount, type RegistryVendor } from "@redline/sdk";
import type { EndpointChange } from "./gateways/endpoint-gateway.js";
import type { Deps } from "./service.js";
import type { PayeeHold, ReviewDecision } from "./store.js";

/**
 * The Review Desk: payee checks that came back HOLD on a payer's key, and vendor endpoint changes
 * waiting out their cooldown. Approving needs a NEP-413 signature from the approver's own wallet,
 * bound to (vault, vendor, revision, account, expiry). Rejecting needs a session only.
 */

export const REVIEW_APPROVAL_RECIPIENT = "redline-review-approval";
export const APPROVAL_TTL_MS = 5 * 60_000;
const MESSAGE_PREFIX = "redline-review:v1:";

export type DeskKind = "endpoint_change" | "payee_hold";

export interface DeskPayable {
  ref: string;
  invoice: string | null;
  amountAtomic: string;
  dueAtNs: string;
}

export interface DeskItem {
  id: string;
  kind: DeskKind;
  /** The vault for an endpoint change. For a hold, the payer the API key acts for. */
  vault: string;
  vendor: { id: string | null; name: string | null; domain: string | null };
  revision: number;
  oldAccount: string | null;
  newAccount: string;
  verdict: PayeeVerdict;
  evidenceTier: EvidenceTier;
  reasons: PayeeReason[];
  cooldownEndsAt: string | null;
  amountAtStake: { atomic: string; symbol: string; decimals: number | null } | null;
  payables: DeskPayable[];
  requestedBy: string | null;
  createdAt: string;
}

export interface DecidedItem extends DeskItem {
  decision: { decision: "approved" | "rejected"; by: string; at: string; publicKey: string | null; signature: string | null; message: string | null };
}

export interface ApprovalPayload {
  action: "approve";
  item: string;
  vault: string;
  vendor: string;
  revision: number;
  account: string;
  expiresAt: string;
}

const shortHash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);
export const changeId = (change: Pick<EndpointChange, "vaultId" | "vendorId" | "revision">): string =>
  `chg_${shortHash(`${change.vaultId}|${change.vendorId}|${change.revision}`)}`;
export const holdId = (payer: string, payee: string, domain: string | null, at: string): string => `hold_${shortHash(`${payer}|${payee}|${domain ?? ""}|${at}`)}`;

export const approvalPayload = (item: DeskItem, expiresAt: string): ApprovalPayload => ({
  action: "approve",
  item: item.id,
  vault: item.vault,
  vendor: item.vendor.id ?? item.vendor.domain ?? "none",
  revision: item.revision,
  account: item.newAccount,
  expiresAt,
});

export const approvalMessage = (payload: ApprovalPayload): string => `${MESSAGE_PREFIX}${canonicalJson(payload)}`;

/** The payload inside a stored approval message, or null if it is not one. */
export function parseApprovalMessage(message: string): ApprovalPayload | null {
  if (!message.startsWith(MESSAGE_PREFIX)) return null;
  try {
    const payload = JSON.parse(message.slice(MESSAGE_PREFIX.length)) as ApprovalPayload;
    return payload.action === "approve" ? payload : null;
  } catch {
    return null;
  }
}

/** Vault vendors carry no domain yet, so they are matched to the registry by name. Vault v2 will store the domain. */
async function registryVendorNamed(deps: Deps, name: string | null): Promise<RegistryVendor | null> {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  return (await deps.payee.context.registry.listVendors()).find((v) => v.name.toLowerCase() === wanted) ?? null;
}

async function openPayables(deps: Deps, vaultId: string, vendorId: string | null): Promise<Payable[]> {
  const vault = deps.world.vaults.get(vaultId);
  if (!vault || !vendorId) return [];
  const all = await Promise.all([...vault.payables.keys()].map((ref) => deps.gateways.vault.getPayable(vaultId, ref)));
  return all.filter((p): p is Payable => p !== null && p.vendor_id === vendorId && p.status === "OPEN");
}

const deskPayable = (p: Payable): DeskPayable => ({ ref: p.payable_ref, invoice: p.invoice_number, amountAtomic: p.amount_atomic, dueAtNs: p.due_at_ns });
const sum = (payables: Payable[]): string => payables.reduce((total, p) => total + BigInt(p.amount_atomic), 0n).toString();

async function changeItem(deps: Deps, change: EndpointChange): Promise<DeskItem> {
  const registered = await registryVendorNamed(deps, change.vendorName);
  const payee = normalizeAccount(change.newAccount, deps.payee.context.network);
  const check = await deps.payee.engine.check(
    { payee, vendor: registered ? { domain: registered.domain, name: change.vendorName } : { name: change.vendorName } },
    deps.payee.context,
  );
  const payables = await openPayables(deps, change.vaultId, change.vendorId);
  return {
    id: changeId(change),
    kind: "endpoint_change",
    vault: change.vaultId,
    vendor: { id: change.vendorId, name: change.vendorName, domain: registered?.domain ?? null },
    revision: change.revision,
    oldAccount: normalizeAccount(change.oldAccount, deps.payee.context.network),
    newAccount: payee,
    verdict: check.verdict,
    evidenceTier: check.evidenceTier ?? "T0_NONE",
    reasons: check.reasons,
    cooldownEndsAt: change.cooldownEndsAt,
    amountAtStake: payables.length > 0 ? { atomic: sum(payables), symbol: deps.world.token.symbol, decimals: deps.world.token.decimals } : null,
    payables: payables.map(deskPayable),
    requestedBy: change.requestedBy,
    createdAt: change.requestedAt,
  };
}

async function holdItem(deps: Deps, hold: PayeeHold): Promise<DeskItem> {
  const registered = hold.domain ? await deps.payee.context.registry.getVendor(hold.domain) : null;
  const name = hold.vendorName ?? registered?.name ?? null;
  // When the payer is a vault, find the open payables for the same vendor.
  const vaultVendor = deps.world.vaults.has(hold.payer) && name ? [...deps.world.vendors.values()].find((v) => v.display_name.toLowerCase() === name.toLowerCase()) : undefined;
  const payables = await openPayables(deps, hold.payer, vaultVendor?.vendor_id ?? null);
  const affected = hold.amount ? payables.filter((p) => p.amount_atomic === hold.amount) : payables;
  const shown = affected.length > 0 ? affected : payables;
  const pending = registered?.accounts.find((a) => a.account === hold.payee && a.status === "pending");
  const previous = hold.domain ? deps.store.lastPaidAccount(hold.payer, hold.domain, chainOf(hold.payee)) : null;
  const amountAtStake = hold.amount
    ? vaultVendor
      ? { atomic: hold.amount, symbol: hold.asset ?? deps.world.token.symbol, decimals: deps.world.token.decimals }
      : { atomic: hold.amount, symbol: hold.asset ?? "units", decimals: null }
    : shown.length > 0
      ? { atomic: sum(shown), symbol: deps.world.token.symbol, decimals: deps.world.token.decimals }
      : null;
  return {
    id: hold.id,
    kind: "payee_hold",
    vault: hold.payer,
    vendor: { id: vaultVendor?.vendor_id ?? null, name, domain: hold.domain },
    revision: 1,
    oldAccount: previous && previous !== hold.payee ? previous : null,
    newAccount: hold.payee,
    verdict: hold.verdict as PayeeVerdict,
    evidenceTier: hold.evidenceTier as EvidenceTier,
    reasons: hold.reasons as PayeeReason[],
    cooldownEndsAt: pending?.activatesAt ?? null,
    amountAtStake,
    payables: shown.map(deskPayable),
    requestedBy: null,
    createdAt: hold.createdAt,
  };
}

const decided = (decision: ReviewDecision): DecidedItem => ({
  ...(JSON.parse(decision.itemJson) as DeskItem),
  decision: { decision: decision.decision, by: decision.decidedBy, at: decision.decidedAt, publicKey: decision.publicKey, signature: decision.signature, message: decision.message },
});

/** Open items, soonest cooldown end first, then newest. Decided items, newest first. */
export async function reviewDesk(deps: Deps): Promise<{ items: DeskItem[]; decided: DecidedItem[] }> {
  const changes = await deps.gateways.endpoints.listChanges();
  const items = await Promise.all([
    ...changes.filter((c) => c.status === "pending").map((c) => changeItem(deps, c)),
    ...deps.store.listHolds().map((h) => holdItem(deps, h)),
  ]);
  const open = items.filter((item) => deps.store.getDecision(item.id) === null);
  const order = (item: DeskItem) => (item.cooldownEndsAt ? new Date(item.cooldownEndsAt).getTime() : Number.MAX_SAFE_INTEGER);
  open.sort((a, b) => order(a) - order(b) || b.createdAt.localeCompare(a.createdAt));
  return { items: open, decided: deps.store.listDecisions().map(decided) };
}

export async function openItem(deps: Deps, id: string): Promise<DeskItem | null> {
  return (await reviewDesk(deps)).items.find((item) => item.id === id) ?? null;
}

export type DeskFailure = { ok: false; status: 403 | 404 | 409; error: string; message: string };

/** A separate approver: whoever requested an endpoint change cannot approve it. */
export function approverProblem(item: DeskItem, account: string): DeskFailure | null {
  if (item.requestedBy !== null && item.requestedBy === account) {
    return { ok: false, status: 403, error: "SEPARATE_APPROVER", message: "You requested this change. A different approver must sign it." };
  }
  return null;
}

/** Records a verified approval and applies it: the vault for an endpoint change, the payee relationship for a hold. */
export async function applyApproval(
  deps: Deps,
  item: DeskItem,
  signed: { account: string; message: string; payload: ApprovalPayload; publicKey: string; signature: string; nonce: string },
): Promise<{ ok: true; note: string } | DeskFailure> {
  const at = deps.payee.nowDate().toISOString();
  let note: string;
  if (item.kind === "endpoint_change") {
    const vendorId = item.vendor.id as string;
    try {
      await deps.gateways.endpoints.approveEndpoint({
        vaultId: item.vault,
        vendorId,
        revision: item.revision,
        account: item.newAccount.split(":").slice(2).join(":"),
        approver: signed.account,
        expiresAt: signed.payload.expiresAt,
        message: signed.message,
        publicKey: signed.publicKey,
        signature: signed.signature,
        nonce: signed.nonce,
      });
    } catch (error) {
      return { ok: false, status: 409, error: "NOT_APPROVABLE", message: error instanceof Error ? error.message : "The vault refused this approval." };
    }
    const ends = item.cooldownEndsAt ? new Date(item.cooldownEndsAt).getTime() : 0;
    note = ends > deps.payee.nowDate().getTime() ? "Approved. The new account takes effect when the cooldown ends." : "Approved. The new account is in effect.";
    deps.store.addHistory("POLICY", deps.now().toString(), `${signed.account} approved ${item.vendor.name ?? vendorId} revision ${item.revision}: ${item.newAccount}.`);
  } else {
    const registered = item.vendor.domain ? await deps.payee.context.registry.getVendor(item.vendor.domain) : null;
    const linked = registered?.accounts.find((a) => a.account === item.newAccount && a.status === "active");
    if (linked) {
      deps.store.approvePayee({ payer: item.vault, account: item.newAccount, approvedBy: signed.account, approvedAt: at });
      note = `Approved. ${item.newAccount} is now T3 for ${item.vault}.`;
    } else {
      note = "Approved as a one-time release. The account is still not linked to a domain.";
    }
  }
  const saved = deps.store.saveDecision({
    itemId: item.id,
    kind: item.kind,
    decision: "approved",
    itemJson: JSON.stringify(item),
    decidedBy: signed.account,
    decidedAt: at,
    message: signed.message,
    publicKey: signed.publicKey,
    signature: signed.signature,
  });
  if (!saved) return { ok: false, status: 409, error: "ALREADY_DECIDED", message: "This item was already decided." };
  return { ok: true, note };
}

export async function applyRejection(deps: Deps, item: DeskItem, account: string): Promise<{ ok: true } | DeskFailure> {
  if (item.kind === "endpoint_change") {
    try {
      await deps.gateways.endpoints.rejectEndpoint({ vaultId: item.vault, vendorId: item.vendor.id as string, revision: item.revision, rejectedBy: account });
    } catch (error) {
      return { ok: false, status: 409, error: "NOT_REJECTABLE", message: error instanceof Error ? error.message : "The vault refused this rejection." };
    }
    deps.store.addHistory("POLICY", deps.now().toString(), `${account} rejected ${item.vendor.name ?? item.vendor.id} revision ${item.revision}.`);
  }
  const saved = deps.store.saveDecision({
    itemId: item.id,
    kind: item.kind,
    decision: "rejected",
    itemJson: JSON.stringify(item),
    decidedBy: account,
    decidedAt: deps.payee.nowDate().toISOString(),
    message: null,
    publicKey: null,
    signature: null,
  });
  return saved ? { ok: true } : { ok: false, status: 409, error: "ALREADY_DECIDED", message: "This item was already decided." };
}
