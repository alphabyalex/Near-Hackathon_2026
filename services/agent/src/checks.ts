import type { AgentContext, Payable, PayableStatus, ReasonCode } from "@redline/schemas";

/**
 * Checks on trusted data only. Nothing here reads invoice text, so nothing here can be talked
 * out of its answer. Shared by RulesBaseline, the LLM guard and the payment adapter.
 */
export interface PayableIssue {
  code: ReasonCode;
  detail: string;
}

/** One vault per business: a payable from another vault must never be matchable. */
export const scopeContext = (ctx: AgentContext, vaultId: string): AgentContext => ({
  ...ctx,
  payables: ctx.payables.filter((p) => p.vault_id === vaultId),
});

export const isPaidStatus = (status: PayableStatus): boolean => status === "SETTLED" || status === "PENDING";

/** Empty means the trusted records allow this payable to be paid. */
export function checkPayable(payable: Payable, ctx: AgentContext): PayableIssue[] {
  const issues: PayableIssue[] = [];
  const add = (code: ReasonCode, detail: string): void => void issues.push({ code, detail });
  const amount = BigInt(payable.amount_atomic);

  if (isPaidStatus(payable.status)) add("ALREADY_PAID", `Payable ${payable.payable_ref} is ${payable.status}.`);
  else if (payable.status !== "OPEN") add("OTHER", `Payable ${payable.payable_ref} is ${payable.status}.`);

  if (payable.invoice_number !== null) {
    const duplicate = ctx.payables.find(
      (p) =>
        p.payable_ref !== payable.payable_ref &&
        p.vendor_id === payable.vendor_id &&
        p.invoice_number === payable.invoice_number &&
        isPaidStatus(p.status),
    );
    if (duplicate) add("ALREADY_PAID", `Invoice ${payable.invoice_number} was already paid as ${duplicate.payable_ref}.`);
  }

  const vendor = ctx.vendors.find((v) => v.vendor_id === payable.vendor_id);
  if (!vendor) {
    add("UNKNOWN_VENDOR", `Vendor ${payable.vendor_id} is not in the vendor records.`);
  } else {
    // Any vendor edit bumps the revision, and the vault then refuses the payable (STALE_REVISION).
    // It may be a cap change, not a new address, so this does not claim a destination change.
    if (!vendor.active) add("UNKNOWN_VENDOR", `Vendor ${vendor.vendor_id} is inactive.`);
    else if (vendor.revision !== payable.vendor_revision) {
      add("OTHER", `The record for vendor ${vendor.vendor_id} changed after this payable was approved, so the owner must re-approve it.`);
    }
    if (amount > BigInt(vendor.per_payment_cap_atomic)) add("OVER_VENDOR_CAP", `Payable is over the cap for ${vendor.vendor_id}.`);
  }

  const po = ctx.purchase_orders.find((o) => o.po_number === payable.po_number);
  if (!po || po.vendor_id !== payable.vendor_id) {
    add("NO_MATCHING_PO", `No approved purchase order ${payable.po_number} for this vendor.`);
  } else {
    // A PO may legitimately back several bills. It is only double paid if bills exceed its total.
    const alreadyPaid = ctx.payables
      .filter((p) => p.payable_ref !== payable.payable_ref && p.po_number === payable.po_number && isPaidStatus(p.status))
      .reduce((sum, p) => sum + BigInt(p.amount_atomic), 0n);
    const total = BigInt(po.total_atomic);
    if (amount > total) add("AMOUNT_MISMATCH", `Payable is larger than ${po.po_number}.`);
    else if (alreadyPaid + amount > total) add("ALREADY_PAID", `${po.po_number} has already been paid.`);
  }

  if (!ctx.receipts.some((r) => r.po_number === payable.po_number)) {
    add("MISSING_RECEIPT", `No goods receipt for ${payable.po_number}.`);
  }
  return issues;
}

/** The vault's window, at the time the invoice arrived: not_before_ns <= now < expires_at_ns. */
export function checkWindow(payable: Payable, nowNs: string): PayableIssue[] {
  const now = BigInt(nowNs);
  if (now < BigInt(payable.not_before_ns)) return [{ code: "NOT_YET_DUE", detail: `Payable ${payable.payable_ref} is not payable yet.` }];
  if (now >= BigInt(payable.expires_at_ns)) return [{ code: "OTHER", detail: `Payable ${payable.payable_ref} has expired.` }];
  return [];
}

/** References a decision may cite: ids that exist in the trusted records. */
export function knownRefs(ctx: AgentContext): Set<string> {
  return new Set<string>([
    ...ctx.vendors.map((v) => v.vendor_id),
    ...ctx.payables.map((p) => p.payable_ref),
    ...ctx.payables.flatMap((p) => (p.invoice_number === null ? [] : [p.invoice_number])),
    ...ctx.purchase_orders.map((o) => o.po_number),
    ...ctx.receipts.map((r) => r.receipt_id),
  ]);
}
