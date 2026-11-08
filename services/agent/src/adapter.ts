import {
  type AgentContext,
  type Decision,
  type DecisionAdapter,
  DecisionSchema,
  type Digest,
  type ExpectedRevisions,
  type Payable,
  type PaymentRequest,
  PaymentRequestSchema,
} from "@wardline/schemas";
import { digestOf } from "./canonical.js";
import { checkPayable } from "./checks.js";

export class NotPayableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotPayableError";
  }
}

/**
 * "Same request" for the vault's retry check (docs/VAULT_RULES.md, request_payment checks 6 and 7):
 * one invoice intake paying one payable. Revisions are left out on purpose. A retry after a
 * harmless policy change must still map to the operation already in flight, and the vault
 * compares this digest before it compares revisions. A new submission of the same invoice has a
 * new intake_ref, so it is not a retry, and the vault answers ALREADY_PAID or ALREADY_PENDING.
 * The vault stores this digest and does not recompute it.
 */
export function requestDigest(intakeRef: string, payable: Payable): Digest {
  return digestOf({
    schema: "wardline-payment-request-digest-v1",
    intake_ref: intakeRef,
    vault_id: payable.vault_id,
    payable_ref: payable.payable_ref,
    vendor_id: payable.vendor_id,
    amount_atomic: payable.amount_atomic,
    token_contract_id: payable.token_contract_id,
  });
}

/**
 * Turns a PAY into a PaymentRequest. Re-parsing the decision drops every field that is not in
 * the schema, and the only value used from it is the payable reference, which is looked up in
 * the trusted records. Anything an agent says about amounts or recipients has nowhere to go.
 * Throws for anything that is not a payable PAY, so no request exists for REVIEW or FLAG.
 *
 * It also throws once a payable is PENDING or SETTLED, so a caller retrying after a timeout must
 * re-send the PaymentRequest it already has, not build a new one.
 */
export class PaymentRequestAdapter implements DecisionAdapter {
  async toPaymentRequest(decision: Decision, ctx: AgentContext, revisions: ExpectedRevisions): Promise<PaymentRequest> {
    const parsed = DecisionSchema.parse(decision);
    if (parsed.decision !== "PAY") throw new NotPayableError(`cannot build a payment from a ${parsed.decision} decision`);

    const payable = ctx.payables.find((p) => p.payable_ref === parsed.matched_payable_ref);
    if (!payable) throw new NotPayableError(`decision names unknown payable ${String(parsed.matched_payable_ref)}`);

    const issues = checkPayable(payable, ctx);
    if (issues.length > 0) throw new NotPayableError(issues.map((i) => i.detail).join(" "));

    const vendor = ctx.vendors.find((v) => v.vendor_id === payable.vendor_id);
    if (!vendor) throw new NotPayableError(`payable names unknown vendor ${payable.vendor_id}`);

    return PaymentRequestSchema.parse({
      payable_ref: payable.payable_ref,
      request_digest: requestDigest(parsed.intake_ref, payable),
      expected_vendor_revision: vendor.revision,
      expected_policy_revision: revisions.policy_revision,
      expected_binding_revision: revisions.binding_revision,
    });
  }
}
