import { DecisionSchema, ReasonCodeSchema } from "@redline/schemas";
import type {
  AgentContext,
  Decision,
  Intake,
  Payable,
  PaymentStatus,
  ReasonCode,
  ReviewItem,
  VaultRejection,
} from "@redline/schemas";
import { randomUUID } from "node:crypto";
import type { Gateways } from "./gateways/index.js";
import type { MockWorld } from "./mock/seed.js";
import type { Store } from "./store.js";
import type { Clock } from "./time.js";

export interface Deps {
  store: Store;
  gateways: Gateways;
  world: MockWorld;
  now: Clock;
}

export type ServiceFailure = { ok: false; status: 404 | 409 | 502; error: string; message: string; rejection?: VaultRejection };
export type ServiceResult = { ok: true } | ServiceFailure;

export const OUTCOME_UNCERTAIN_REASON =
  "The vault has not confirmed whether this payment went through. Paying or closing it now could pay the same bill twice.";

const fail = (status: ServiceFailure["status"], error: string, message: string, rejection?: VaultRejection): ServiceFailure =>
  rejection === undefined ? { ok: false, status, error, message } : { ok: false, status, error, message, rejection };

const reasonFor = (rejection: VaultRejection): ReasonCode => {
  const parsed = ReasonCodeSchema.safeParse(rejection);
  return parsed.success ? parsed.data : "OTHER";
};

export async function buildContext(deps: Deps, vaultId: string): Promise<AgentContext> {
  const vault = deps.world.vaults.get(vaultId);
  if (!vault) throw new Error(`unknown vault ${vaultId}`);
  const payables = (
    await Promise.all([...vault.payables.keys()].map((ref) => deps.gateways.vault.getPayable(vaultId, ref)))
  ).filter((p): p is Payable => p !== null);
  const poNumbers = new Set(payables.map((p) => p.po_number));
  return {
    vendors: [...deps.world.vendors.values()],
    payables,
    purchase_orders: [...deps.world.purchase_orders.values()].filter((p) => poNumbers.has(p.po_number)),
    receipts: [...deps.world.receipts.values()].filter((r) => poNumbers.has(r.po_number)),
  };
}

/** Runs one invoice through the agent and, on PAY, the vault. Every failure path ends in the human queue with no money moved. */
export async function processIntake(
  deps: Deps,
  input: { vault_id: string; source_text: string; attachments_note: string | null },
): Promise<string> {
  const { store, gateways, now } = deps;
  const intake: Intake = {
    intake_ref: `int_${randomUUID()}`,
    vault_id: input.vault_id,
    received_at_ns: now().toString(),
    source_text: input.source_text,
    attachments_note: input.attachments_note,
  };
  store.saveInvoice({ intake, decision: null, payable_ref: null, operation_id: null, payment_status: "requested" });

  const ctx = await buildContext(deps, intake.vault_id);
  const payableIn = (ref: string | null): Payable | null => ctx.payables.find((p) => p.payable_ref === ref) ?? null;

  const finish = (fields: {
    decision: Decision | null;
    payable: Payable | null;
    operation_id?: string | null;
    status: PaymentStatus;
    review?: { source: ReviewItem["source"]; reasons: ReasonCode[]; rejection: VaultRejection | null };
  }): void => {
    store.saveInvoice({
      intake,
      decision: fields.decision,
      payable_ref: fields.payable?.payable_ref ?? null,
      operation_id: fields.operation_id ?? null,
      payment_status: fields.status,
    });
    if (fields.review) {
      store.saveReview({
        review_id: `rev_${randomUUID()}`,
        intake_ref: intake.intake_ref,
        payable_ref: fields.payable?.payable_ref ?? null,
        source: fields.review.source,
        reason_codes: fields.review.reasons,
        vault_rejection: fields.review.rejection,
        due_at_ns: fields.payable?.due_at_ns ?? null,
        status: "OPEN",
      });
    }
  };

  let decision: Decision;
  try {
    decision = DecisionSchema.parse(await gateways.agent.decide(intake, ctx));
    if (decision.intake_ref !== intake.intake_ref) throw new Error("decision names a different intake");
  } catch (error) {
    console.error("agent failed, sending invoice to review", error);
    finish({ decision: null, payable: null, status: "review needed", review: { source: "AGENT", reasons: ["OTHER"], rejection: null } });
    return intake.intake_ref;
  }

  // The reference comes from the agent, so a payable outside this vault's context is treated as no match.
  const payable = payableIn(decision.matched_payable_ref);

  if (decision.decision !== "PAY") {
    finish({
      decision,
      payable,
      status: decision.decision === "FLAG" ? "flagged" : "review needed",
      review: { source: "AGENT", reasons: decision.reason_codes, rejection: null },
    });
    return intake.intake_ref;
  }

  let request;
  try {
    const [policy, binding] = await Promise.all([
      gateways.vault.getPolicy(intake.vault_id),
      gateways.vault.getBinding(intake.vault_id),
    ]);
    if (!binding) throw new Error("vault has no agent binding");
    request = await gateways.adapter.toPaymentRequest(decision, ctx, {
      policy_revision: policy.revision,
      binding_revision: binding.revision,
    });
  } catch (error) {
    console.error("could not build a payment request, sending invoice to review", error);
    finish({ decision, payable, status: "review needed", review: { source: "AGENT", reasons: ["OTHER"], rejection: null } });
    return intake.intake_ref;
  }

  let result;
  try {
    result = await gateways.vault.requestPayment(intake.vault_id, request);
  } catch (error) {
    // The transaction may have landed, so this must not read as "not paid".
    console.error("vault call failed with unknown outcome", error);
    finish({ decision, payable, status: "outcome uncertain", review: { source: "VAULT", reasons: ["OTHER"], rejection: null } });
    return intake.intake_ref;
  }

  if (!result.ok) {
    const rejection = result.rejection as VaultRejection;
    finish({ decision, payable, status: "rejected by policy", review: { source: "VAULT", reasons: [reasonFor(rejection)], rejection } });
    return intake.intake_ref;
  }

  const operationId = result.operation_id as string;
  const operation = await gateways.vault.getOperation(intake.vault_id, operationId);
  finish({ decision, payable, operation_id: operationId, status: operation?.status === "SETTLED" ? "settled" : "reserved" });
  return intake.intake_ref;
}

const inFlight = new Set<string>();

export async function ownerPay(deps: Deps, reviewId: string): Promise<ServiceResult> {
  const { store, gateways, now } = deps;
  const item = store.getReview(reviewId);
  if (!item) return fail(404, "NOT_FOUND", "No such review item.");
  if (item.status !== "OPEN") return fail(409, "REVIEW_CLOSED", "This review item is already closed.");
  if (!item.payable_ref) {
    return fail(409, "NO_APPROVED_PAYABLE", "This item has no approved payable, so there is nothing the owner can pay yet.");
  }
  const invoice = store.getInvoice(item.intake_ref);
  if (!invoice) return fail(404, "NOT_FOUND", "No invoice for this review item.");
  if (invoice.payment_status === "outcome uncertain") return fail(409, "OUTCOME_UNCERTAIN", OUTCOME_UNCERTAIN_REASON);
  if (inFlight.has(reviewId)) return fail(409, "IN_PROGRESS", "An owner payment for this item is already running.");

  inFlight.add(reviewId);
  try {
    let result;
    try {
      result = await gateways.vault.ownerPay(invoice.intake.vault_id, item.payable_ref);
    } catch (error) {
      console.error("owner payment failed with unknown outcome", error);
      store.saveInvoice({ ...invoice, payment_status: "outcome uncertain" });
      return fail(502, "OUTCOME_UNCERTAIN", OUTCOME_UNCERTAIN_REASON);
    }
    if (!result.ok) {
      const rejection = result.rejection as VaultRejection;
      return fail(409, "VAULT_REJECTED", `The vault rejected this payment: ${rejection}.`, rejection);
    }
    store.saveInvoice({
      ...invoice,
      operation_id: result.operation_id,
      payment_status: "settled",
    });
    store.saveReview({ ...item, status: "APPROVED_OWNER_PAID" });
    store.addHistory("POLICY", now().toString(), `Owner paid ${item.payable_ref} directly from review item ${reviewId}.`);
    return { ok: true };
  } finally {
    inFlight.delete(reviewId);
  }
}

export function rejectReview(deps: Deps, reviewId: string): ServiceResult {
  const { store, now } = deps;
  const item = store.getReview(reviewId);
  if (!item) return fail(404, "NOT_FOUND", "No such review item.");
  if (item.status !== "OPEN") return fail(409, "REVIEW_CLOSED", "This review item is already closed.");
  if (store.getInvoice(item.intake_ref)?.payment_status === "outcome uncertain") {
    return fail(409, "OUTCOME_UNCERTAIN", OUTCOME_UNCERTAIN_REASON);
  }
  store.saveReview({ ...item, status: "REJECTED" });
  store.addHistory("POLICY", now().toString(), `Owner rejected review item ${reviewId}. No payment made.`);
  return { ok: true };
}
