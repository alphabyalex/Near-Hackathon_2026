import { PaymentRequestSchema, type AgentContext, type Decision, type DecisionAdapter, type ExpectedRevisions, type Intake } from "@redline/schemas";
import { requestDigest } from "./adapter.js";
import { makeDecision } from "./decisions.js";
import { NO_USAGE, type DecisionWithReport, type ReportingAgent } from "./report.js";

/** Deliberately bypasses the model guard, but still goes through the adapter and vault. */
export class CompromisedAgent implements ReportingAgent {
  async decide(intake: Intake, ctx: AgentContext): Promise<Decision> {
    return (await this.decideWithReport(intake, ctx)).decision;
  }

  async decideWithReport(intake: Intake, ctx: AgentContext): Promise<DecisionWithReport> {
    const payables = ctx.payables.filter((p) => p.vault_id === intake.vault_id);
    const target = payables.find((p) => intake.source_text.includes(p.payable_ref))
      ?? payables.find((p) => p.invoice_number && intake.source_text.includes(p.invoice_number))
      ?? payables[0];
    return {
      decision: makeDecision(intake, target ? "PAY" : "REVIEW",
        [target ? "MATCHED_APPROVED_PAYABLE" : "NO_MATCHING_PO"],
        "[SIMULATED COMPROMISE] Attempts payment without invoice safety checks. Vault policy still applies.",
        target?.payable_ref ?? null),
      report: { agent: "compromised", source: "simulated-compromise", manifest_digest: null,
        model_id: null, latency_ms: 0, attempts: 0, usage: NO_USAGE, cost_usd: null,
        fallback: null, guard: [], replay: null },
    };
  }
}

/** Simulates compromise of the entire agent process, including its local guard/adapter.
 * No caller-controlled recipient or amount: the vault resolves those from its own payable. */
export class CompromisedPaymentAdapter implements DecisionAdapter {
  async toPaymentRequest(decision: Decision, ctx: AgentContext, revisions: ExpectedRevisions) {
    const payable = ctx.payables.find((p) => p.payable_ref === decision.matched_payable_ref);
    const vendor = ctx.vendors.find((v) => v.vendor_id === payable?.vendor_id);
    if (decision.decision !== "PAY" || !payable || !vendor) throw new Error("No known payable/vendor to attempt");
    return PaymentRequestSchema.parse({ payable_ref: payable.payable_ref,
      request_digest: requestDigest(decision.intake_ref, payable), expected_vendor_revision: vendor.revision,
      expected_policy_revision: revisions.policy_revision, expected_binding_revision: revisions.binding_revision });
  }
}
