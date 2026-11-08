import { createHash } from "node:crypto";
import type {
  AgentContext,
  AgentRunner,
  Decision,
  DecisionAdapter,
  ExpectedRevisions,
  Intake,
  PaymentRequest,
  ReasonCode,
} from "@wardline/schemas";

const INJECTION = /ignore (all |any )?(prior|previous)|system (note|prompt)|disregard (all |any )?(prior|previous)/i;
const DESTINATION_CHANGE = /(changed|new|updated)\s+(our\s+)?(bank|wallet|payment|destination)/i;

const mentions = (text: string, token: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9-])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9-])`).test(text);

/** Keyword rules so the flow can run without an LLM. Not an agent; Kristian's replaces it. */
export class MockAgentGateway implements AgentRunner, DecisionAdapter {
  async decide(intake: Intake, ctx: AgentContext): Promise<Decision> {
    const text = intake.source_text;
    const result = (
      decision: Decision["decision"],
      reason: ReasonCode,
      summary: string,
      matched: string | null = null,
      evidence: string[] = [],
    ): Decision => ({
      schema: "wardline-decision-v1",
      intake_ref: intake.intake_ref,
      decision,
      matched_payable_ref: matched,
      reason_codes: [reason],
      evidence_refs: evidence,
      summary,
    });

    if (INJECTION.test(text)) return result("FLAG", "INJECTION_ATTEMPT", "Invoice text contains instructions aimed at the agent.");
    if (DESTINATION_CHANGE.test(text)) return result("REVIEW", "DESTINATION_CHANGE", "Invoice claims a changed payment destination.");

    const payable = ctx.payables.find((p) => p.invoice_number !== null && mentions(text, p.invoice_number));
    if (!payable) {
      const knownVendor = ctx.vendors.some((v) => text.includes(v.display_name));
      return knownVendor
        ? result("REVIEW", "NO_MATCHING_PO", "Known vendor, but no approved payable matches this invoice.")
        : result("REVIEW", "NEW_VENDOR", "Vendor is not on the approved list.");
    }

    const ref = payable.payable_ref;
    if (payable.status === "SETTLED") return result("FLAG", "ALREADY_PAID", "This invoice has already been paid.", ref);
    if (payable.status !== "OPEN") return result("REVIEW", "OTHER", `Payable is ${payable.status}.`, ref);

    const receipt = ctx.receipts.find((r) => r.po_number === payable.po_number);
    if (!receipt) return result("REVIEW", "MISSING_RECEIPT", "No goods receipt for this purchase order.", ref, [payable.po_number]);

    return result("PAY", "MATCHED_APPROVED_PAYABLE", `Invoice matches approved payable ${ref}.`, ref, [payable.po_number, receipt.receipt_id]);
  }

  async toPaymentRequest(decision: Decision, ctx: AgentContext, revisions: ExpectedRevisions): Promise<PaymentRequest> {
    if (decision.decision !== "PAY") throw new Error(`cannot build a payment from a ${decision.decision} decision`);
    const payable = ctx.payables.find((p) => p.payable_ref === decision.matched_payable_ref);
    if (!payable) throw new Error(`decision names unknown payable ${String(decision.matched_payable_ref)}`);
    const vendor = ctx.vendors.find((v) => v.vendor_id === payable.vendor_id);
    if (!vendor) throw new Error(`payable names unknown vendor ${payable.vendor_id}`);

    const digest = createHash("sha256").update(JSON.stringify([decision.intake_ref, payable.payable_ref])).digest("hex");
    return {
      payable_ref: payable.payable_ref,
      request_digest: `sha256:${digest}`,
      expected_vendor_revision: vendor.revision,
      expected_policy_revision: revisions.policy_revision,
      expected_binding_revision: revisions.binding_revision,
    };
  }
}
