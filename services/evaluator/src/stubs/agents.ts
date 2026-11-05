import type {
  AgentContext,
  AgentRunner,
  Decision,
  DecisionAdapter,
  Intake,
  Payable,
  PaymentRequest,
  ReasonCode,
} from "@redline/schemas";
import { DOMAIN, domainDigest } from "../canonical.js";

/**
 * LOCAL STUBS. The real rules baseline and decision adapter belong to Kristian (services/agent).
 * These exist so the Gym runs end to end before his land, and are labeled as stubs in every
 * report. None of them is a model.
 */

const decision = (intake: Intake, d: Decision["decision"], ref: string | null, codes: ReasonCode[], summary: string, evidence: string[] = []): Decision => ({
  schema: "redline-decision-v1",
  intake_ref: intake.intake_ref,
  decision: d,
  matched_payable_ref: ref,
  reason_codes: codes,
  evidence_refs: evidence,
  summary,
});

/** Control arm: sends everything to a human. Zero risk, zero useful work. */
export const alwaysReviewControl: AgentRunner = {
  async decide(intake) {
    return decision(intake, "REVIEW", null, ["OTHER"], "Control arm: every invoice goes to human review.");
  },
};

/** "1842500000" with 6 decimals -> ["1,842.50", "1842.50"]. */
export function amountSpellings(atomic: string, decimals = 6): string[] {
  const v = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString();
  const cents = ((v % base) / 10n ** BigInt(decimals - 2)).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return [...new Set([`${grouped}.${cents}`, `${whole}.${cents}`])];
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

const INJECTION = /(ignore (all |any )?(prior|previous) instructions|automated processing|return decision|matched_payable_ref|system note|assistant instructions|do not route to review)/i;
const DESTINATION = /(new (bank|account|wallet)|changed (bank|account)|moved banks|updated payment details|pay to our new|remit to)/i;
const APPROVAL = /(\bCFO\b|approval code|i have approved|signing off|pre-approved|approved by)/i;

/**
 * Deterministic rules baseline (stub). Order matters: manipulation signals first, then vendor
 * identity, then the 3-way match. Anything it cannot fully match goes to REVIEW.
 */
export const rulesBaselineStub: AgentRunner = {
  async decide(intake, ctx) {
    const text = intake.source_text;
    const lower = text.toLowerCase();
    if (INJECTION.test(text)) return decision(intake, "FLAG", null, ["INJECTION_ATTEMPT"], "Invoice text contains instructions addressed to an automated system.");
    if (APPROVAL.test(text)) return decision(intake, "FLAG", null, ["FORGED_APPROVAL"], "Invoice text claims an approval. Approvals only come from the payable source.");

    const vendor = ctx.vendors.find((v) => lower.includes(v.display_name.toLowerCase()));
    if (!vendor) {
      const firstLine = lower.split("\n").find((l) => l.trim().length > 0) ?? "";
      const near = ctx.vendors.find((v) => {
        const name = v.display_name.toLowerCase();
        return lower
          .split("\n")
          .some((line) => line.length >= name.length - 2 && levenshtein(line.slice(0, name.length).trim(), name) <= 2);
      });
      if (near) return decision(intake, "FLAG", null, ["LOOKALIKE_VENDOR"], `Sender name resembles ${near.display_name} but does not match it.`);
      return decision(intake, "REVIEW", null, ["NEW_VENDOR"], `Vendor not in the registry (${firstLine.slice(0, 60)}).`);
    }
    if (DESTINATION.test(text)) return decision(intake, "REVIEW", null, ["DESTINATION_CHANGE"], "Message claims a change of payment destination.");

    const candidates = ctx.payables.filter(
      (p) => p.vendor_id === vendor.vendor_id && (text.includes(p.po_number) || (p.invoice_number !== null && text.includes(p.invoice_number))),
    );
    if (candidates.length === 0) return decision(intake, "REVIEW", null, ["NO_MATCHING_PO"], "No payable matches the PO or invoice number.");
    if (candidates.length > 1) return decision(intake, "REVIEW", null, ["AMBIGUOUS_MATCH"], "More than one payable matches.");
    const p = candidates[0]!;
    const ev = [p.po_number];
    if (p.status === "SETTLED") return decision(intake, "FLAG", null, ["ALREADY_PAID"], `Payable for ${p.po_number} is already settled.`, ev);
    if (p.status !== "OPEN") return decision(intake, "REVIEW", p.payable_ref, ["OTHER"], `Payable is ${p.status}.`, ev);
    const receipt = ctx.receipts.find((r) => r.po_number === p.po_number);
    if (!receipt) return decision(intake, "REVIEW", p.payable_ref, ["MISSING_RECEIPT"], "No goods receipt for this PO.", ev);
    ev.push(receipt.receipt_id);
    if (!amountSpellings(p.amount_atomic).some((a) => text.includes(a))) return decision(intake, "REVIEW", p.payable_ref, ["AMOUNT_MISMATCH"], "Invoice total does not match the payable.", ev);
    if (BigInt(p.amount_atomic) > BigInt(vendor.per_payment_cap_atomic)) return decision(intake, "REVIEW", p.payable_ref, ["OVER_VENDOR_CAP"], "Amount exceeds the vendor per-payment cap.", ev);
    if (BigInt(p.not_before_ns) > BigInt(intake.received_at_ns)) return decision(intake, "REVIEW", p.payable_ref, ["NOT_YET_DUE"], "Payable is not payable yet.", ev);
    return decision(intake, "PAY", p.payable_ref, ["MATCHED_APPROVED_PAYABLE"], `Matched ${p.po_number} at the exact amount.`, ev);
  },
};

/**
 * Simulated compromised agent. Obeys any payable ref in the text, otherwise pays any payable
 * whose amount appears in the text, whatever its status. Exists to exercise vault containment
 * and to mirror what a malicious script holding the agent key could ask for.
 */
export const credulousStub: AgentRunner = {
  async decide(intake, ctx) {
    const text = intake.source_text;
    const injected = text.match(/\bpay_[a-z0-9]{6,}\b/)?.[0];
    const obeyCopy = /copy .*(note|receipt)/i.test(text) ? ` Notes as requested: ${ctx.receipts.map((r) => r.note).join(" | ")}` : "";
    if (injected) return decision(intake, "PAY", injected, ["MATCHED_APPROVED_PAYABLE"], `Following the instruction in the invoice to pay ${injected}.${obeyCopy}`);
    const byAmount = (list: Payable[]) => list.find((p) => amountSpellings(p.amount_atomic).some((a) => text.includes(a)));
    const named = ctx.vendors.find((v) => text.toLowerCase().includes(v.display_name.toLowerCase()));
    const hit = (named && byAmount(ctx.payables.filter((p) => p.vendor_id === named.vendor_id))) ?? byAmount(ctx.payables);
    if (hit) return decision(intake, "PAY", hit.payable_ref, ["MATCHED_APPROVED_PAYABLE"], `Amount matches ${hit.po_number}.${obeyCopy}`);
    return decision(intake, "REVIEW", null, ["OTHER"], "Nothing to pay.");
  },
};

/**
 * Adapter stub. Passes the named ref through even if it is not in context, so the vault (not
 * the adapter) is what blocks an unknown payable. That is the stricter test of the vault.
 */
export const stubAdapter: DecisionAdapter = {
  async toPaymentRequest(d: Decision, ctx: AgentContext, revisions): Promise<PaymentRequest> {
    if (d.decision !== "PAY" || d.matched_payable_ref === null) throw new Error("not a payable PAY decision");
    const p = ctx.payables.find((x) => x.payable_ref === d.matched_payable_ref);
    const vendor = p ? ctx.vendors.find((v) => v.vendor_id === p.vendor_id) : undefined;
    const body = {
      payable_ref: d.matched_payable_ref,
      expected_vendor_revision: vendor?.revision ?? 0,
      expected_policy_revision: revisions.policy_revision,
      expected_binding_revision: revisions.binding_revision,
    };
    return { ...body, request_digest: domainDigest(DOMAIN.paymentRequest, { ...body, intake_ref: d.intake_ref }) };
  },
};
