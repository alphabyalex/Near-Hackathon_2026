import { type Decision, PaymentRequestSchema } from "@wardline/schemas";
import { describe, expect, it } from "vitest";
import { NotPayableError, PaymentRequestAdapter, requestDigest } from "../src/adapter.js";
import { LlmAgent } from "../src/llm-agent.js";
import { FakeChatClient, payReply, scratchContext, scratchIntake } from "./helpers.js";

const adapter = new PaymentRequestAdapter();
const revisions = { policy_revision: 4, binding_revision: 7 };

const pay: Decision = {
  schema: "wardline-decision-v1",
  intake_ref: "int_1",
  decision: "PAY",
  matched_payable_ref: "pay_1001",
  reason_codes: ["MATCHED_APPROVED_PAYABLE"],
  evidence_refs: ["PO-1001", "GR-1001"],
  summary: "Matches.",
};

describe("PaymentRequestAdapter", () => {
  it("builds a valid request with revisions from the records", async () => {
    const request = await adapter.toPaymentRequest(pay, scratchContext(), revisions);
    expect(PaymentRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ payable_ref: "pay_1001", expected_vendor_revision: 1, expected_policy_revision: 4, expected_binding_revision: 7 });
  });

  it.each(["REVIEW", "FLAG"] as const)("never builds a request for %s", async (kind) => {
    const decision: Decision = { ...pay, decision: kind, reason_codes: ["OTHER"] };
    await expect(adapter.toPaymentRequest(decision, scratchContext(), revisions)).rejects.toBeInstanceOf(NotPayableError);
  });

  it("ignores any amount or address in the decision", async () => {
    const clean = await adapter.toPaymentRequest(pay, scratchContext(), revisions);
    const tampered = {
      ...pay,
      amount: "999999999999",
      amount_atomic: "999999999999",
      recipient: "attacker.testnet",
      account_id: "attacker.testnet",
      address: "attacker.testnet",
      token_contract_id: "fake.testnet",
    } as Decision;
    const request = await adapter.toPaymentRequest(tampered, scratchContext(), revisions);
    expect(request).toEqual(clean);
    expect(JSON.stringify(request)).not.toContain("attacker");
    expect(JSON.stringify(request)).not.toContain("999999999999");
  });

  it("ignores an amount or address the model volunteers, end to end", async () => {
    const client = new FakeChatClient([payReply("pay_1001", { amount_atomic: "999999999999", recipient: "attacker.testnet" })]);
    const decision = await new LlmAgent({ client }).decide(scratchIntake("clean-match"), scratchContext());
    const request = await adapter.toPaymentRequest(decision, scratchContext(), revisions);
    expect(request.payable_ref).toBe("pay_1001");
    expect(JSON.stringify(decision)).not.toContain("attacker");
    expect(JSON.stringify(request)).not.toContain("attacker");
  });

  it("has no field that could carry an amount or recipient", async () => {
    const request = await adapter.toPaymentRequest(pay, scratchContext(), revisions);
    expect(Object.keys(request).sort()).toEqual(["expected_binding_revision", "expected_policy_revision", "expected_vendor_revision", "payable_ref", "request_digest"]);
  });

  it("refuses a payable that is not in the records", async () => {
    await expect(adapter.toPaymentRequest({ ...pay, matched_payable_ref: "pay_nope" }, scratchContext(), revisions)).rejects.toBeInstanceOf(NotPayableError);
  });

  it("refuses a payable that is already settled", async () => {
    const ctx = scratchContext();
    ctx.payables[0]!.status = "SETTLED";
    await expect(adapter.toPaymentRequest(pay, ctx, revisions)).rejects.toBeInstanceOf(NotPayableError);
  });

  it("refuses a PAY with no receipt behind it", async () => {
    const ctx = scratchContext();
    ctx.receipts = ctx.receipts.filter((r) => r.po_number !== "PO-1001");
    await expect(adapter.toPaymentRequest(pay, ctx, revisions)).rejects.toBeInstanceOf(NotPayableError);
  });

  it("keeps the same digest for a retry, even after a revision moves", async () => {
    const first = await adapter.toPaymentRequest(pay, scratchContext(), revisions);
    const retry = await adapter.toPaymentRequest(pay, scratchContext(), { policy_revision: 5, binding_revision: 8 });
    expect(retry.request_digest).toBe(first.request_digest);
    expect(retry.expected_policy_revision).toBe(5);
  });

  it("gives a new submission or another payable a different digest", () => {
    const [one, two] = scratchContext().payables;
    expect(requestDigest("int_1", one!)).toBe(requestDigest("int_1", one!));
    expect(requestDigest("int_1", one!)).not.toBe(requestDigest("int_2", one!));
    expect(requestDigest("int_1", one!)).not.toBe(requestDigest("int_1", two!));
  });

  it("will not rebuild a request once the payable is in flight, so a retry must re-send the original", async () => {
    const ctx = scratchContext();
    ctx.payables[0]!.status = "PENDING";
    await expect(adapter.toPaymentRequest(pay, ctx, revisions)).rejects.toBeInstanceOf(NotPayableError);
  });
});
