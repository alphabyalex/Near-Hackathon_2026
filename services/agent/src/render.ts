import type { AgentContext, Intake } from "@redline/schemas";
import { sha256Hex } from "./canonical.js";
import { formatAtomic, nsToIso } from "./money.js";
import { PROMPTS, type PromptVersion } from "./prompts.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Amounts and times are converted here so the model never does atomic-unit or nanosecond math. */
export function renderTrustedContext(ctx: AgentContext): string {
  return JSON.stringify(
    {
      vendors: ctx.vendors.map((v) => ({
        vendor_id: v.vendor_id,
        display_name: v.display_name,
        account_id: v.account_id,
        per_payment_cap: formatAtomic(v.per_payment_cap_atomic),
        active: v.active,
      })),
      payables: ctx.payables.map((p) => ({
        payable_ref: p.payable_ref,
        vendor_id: p.vendor_id,
        po_number: p.po_number,
        invoice_number: p.invoice_number,
        amount: formatAtomic(p.amount_atomic),
        not_before: nsToIso(p.not_before_ns),
        due_at: nsToIso(p.due_at_ns),
        expires_at: nsToIso(p.expires_at_ns),
        status: p.status,
      })),
      purchase_orders: ctx.purchase_orders.map((o) => ({
        po_number: o.po_number,
        vendor_id: o.vendor_id,
        total: formatAtomic(o.total_atomic),
        lines: o.lines.map((l) => `${l.quantity} x ${l.description}, ${formatAtomic(l.line_total_atomic)}`),
        approved_by: o.approved_by,
      })),
      goods_receipts: ctx.receipts.map((r) => ({
        receipt_id: r.receipt_id,
        po_number: r.po_number,
        received_at: nsToIso(r.received_at_ns),
        note: r.note,
      })),
    },
    null,
    2,
  );
}

export function renderUntrustedInvoice(intake: Intake): string {
  return intake.attachments_note === null
    ? intake.source_text
    : `${intake.source_text}\n\n[attachment note]\n${intake.attachments_note}`;
}

/**
 * The marker id is a hash of the untrusted text, so it is stable for repeat runs, and the text
 * cannot contain its own end marker because it cannot contain its own hash.
 */
export const markerNonce = (untrusted: string): string => sha256Hex(untrusted).slice(0, 16);

export function buildMessages(version: PromptVersion, intake: Intake, ctx: AgentContext): ChatMessage[] {
  const untrusted = renderUntrustedInvoice(intake);
  const values: Record<string, string> = {
    TRUSTED_CONTEXT: renderTrustedContext(ctx),
    INTAKE_METADATA: JSON.stringify({ received_at: nsToIso(intake.received_at_ns) }),
    NONCE: markerNonce(untrusted),
    UNTRUSTED_INVOICE: untrusted,
  };
  const template = PROMPTS[version];
  // One pass with a function, so placeholders or "$" patterns inside invoice text stay inert.
  const user = template.user.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
  return [
    { role: "system", content: template.system },
    { role: "user", content: user },
  ];
}
