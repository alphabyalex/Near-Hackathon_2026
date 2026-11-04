import type {
  EvaluationSummary,
  HistoryView,
  InvoiceDetail,
  InvoiceSummary,
  OverviewView,
  ReviewQueueEntry,
  UnresolvedPayment,
} from "@spendgym/schemas";
import { OUTCOME_UNCERTAIN_REASON, type Deps } from "./service.js";
import { NS_PER_HOUR } from "./time.js";
import type { InvoiceRow } from "./store.js";

const EXCERPT_LENGTH = 90;
const DUE_WARNING_NS = 48n * NS_PER_HOUR;

const excerpt = (text: string): string => (text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}...` : text);
const floorZero = (value: bigint): string => (value < 0n ? "0" : value.toString());

async function payableOf(deps: Deps, row: InvoiceRow) {
  return row.payable_ref ? deps.gateways.vault.getPayable(row.intake.vault_id, row.payable_ref) : null;
}

export async function overviewView(deps: Deps, vaultId: string): Promise<OverviewView> {
  const { vault } = deps.gateways;
  const [policy, binding, usage] = await Promise.all([vault.getPolicy(vaultId), vault.getBinding(vaultId), vault.getUsage(vaultId)]);

  const unresolved: UnresolvedPayment[] = [];
  for (const row of deps.store.listInvoices()) {
    if (row.intake.vault_id !== vaultId || !row.payable_ref) continue;
    if (row.payment_status !== "reserved" && row.payment_status !== "outcome uncertain" && row.payment_status !== "requested") continue;
    const payable = await payableOf(deps, row);
    unresolved.push({
      intake_ref: row.intake.intake_ref,
      payable_ref: row.payable_ref,
      payment_status: row.payment_status,
      amount_atomic: payable?.amount_atomic ?? "0",
      operation_id: row.operation_id,
    });
  }

  return {
    data_source: "mock",
    vault_id: vaultId,
    token: deps.world.token,
    manifest: deps.world.manifest,
    binding,
    policy,
    vendors: [...deps.world.vendors.values()],
    usage,
    headroom: {
      weekly_atomic: floorZero(BigInt(policy.weekly_cap_atomic) - BigInt(usage.weekly_settled_atomic) - BigInt(usage.weekly_reserved_atomic)),
      lifetime_atomic: floorZero(BigInt(policy.lifetime_cap_atomic) - BigInt(usage.lifetime_settled_atomic) - BigInt(usage.lifetime_reserved_atomic)),
    },
    unresolved_payments: unresolved,
  };
}

export async function invoiceList(deps: Deps): Promise<InvoiceSummary[]> {
  return Promise.all(
    deps.store.listInvoices().map(async (row) => {
      const payable = await payableOf(deps, row);
      return {
        intake_ref: row.intake.intake_ref,
        received_at_ns: row.intake.received_at_ns,
        excerpt: excerpt(row.intake.source_text),
        invoice_number: payable?.invoice_number ?? null,
        vendor_name: payable ? (deps.world.vendors.get(payable.vendor_id)?.display_name ?? null) : null,
        amount_atomic: payable?.amount_atomic ?? null,
        due_at_ns: payable?.due_at_ns ?? null,
        decision: row.decision?.decision ?? null,
        payment_status: row.payment_status,
        review_status: deps.store.getReviewForIntake(row.intake.intake_ref)?.status ?? null,
      };
    }),
  );
}

export async function invoiceDetail(deps: Deps, intakeRef: string): Promise<InvoiceDetail | null> {
  const row = deps.store.getInvoice(intakeRef);
  if (!row) return null;
  const payable = await payableOf(deps, row);
  return {
    intake: row.intake,
    decision: row.decision,
    payable,
    vendor: payable ? (deps.world.vendors.get(payable.vendor_id) ?? null) : null,
    purchase_order: payable ? (deps.world.purchase_orders.get(payable.po_number) ?? null) : null,
    receipt: payable ? (deps.world.receipts.get(payable.po_number) ?? null) : null,
    operation: row.operation_id ? await deps.gateways.vault.getOperation(row.intake.vault_id, row.operation_id) : null,
    payment_status: row.payment_status,
    review: deps.store.getReviewForIntake(intakeRef),
  };
}

/** Open items, soonest due first. Items with no due date sort last. */
export async function reviewQueue(deps: Deps): Promise<ReviewQueueEntry[]> {
  const now = deps.now();
  const entries = await Promise.all(
    deps.store
      .listReviews()
      .filter((item) => item.status === "OPEN")
      .map(async (item): Promise<ReviewQueueEntry> => {
        const row = deps.store.getInvoice(item.intake_ref);
        if (!row) throw new Error(`review ${item.review_id} has no invoice`);
        const payable = await payableOf(deps, row);
        return {
          ...item,
          excerpt: excerpt(row.intake.source_text),
          amount_atomic: payable?.amount_atomic ?? null,
          payment_status: row.payment_status,
          due_within_48h: item.due_at_ns !== null && BigInt(item.due_at_ns) - now <= DUE_WARNING_NS,
          owner_pay_blocked_reason:
            row.payment_status === "outcome uncertain"
              ? OUTCOME_UNCERTAIN_REASON
              : item.payable_ref === null
                ? "No approved payable exists for this invoice. A new payable must come from an approved purchase order."
                : null,
        };
      }),
  );
  return entries.sort((a, b) => {
    if (a.due_at_ns === null || b.due_at_ns === null) {
      if (a.due_at_ns === b.due_at_ns) return a.review_id.localeCompare(b.review_id);
      return a.due_at_ns === null ? 1 : -1;
    }
    const diff = BigInt(a.due_at_ns) - BigInt(b.due_at_ns);
    if (diff !== 0n) return diff < 0n ? -1 : 1;
    return a.review_id.localeCompare(b.review_id);
  });
}

export async function evaluationList(deps: Deps): Promise<EvaluationSummary[]> {
  const reports = await deps.gateways.evidence.getReports();
  return reports.map(({ run_id, issuer, execution_status, assessment_outcome, manifest_digest, suite_commitment }) => ({
    run_id,
    issuer,
    execution_status,
    assessment_outcome,
    manifest_digest,
    suite_commitment,
  }));
}

export async function historyView(deps: Deps, vaultId: string): Promise<HistoryView> {
  return {
    vendors: [...deps.world.vendors.values()],
    policy: await deps.gateways.vault.getPolicy(vaultId),
    policy_changes: deps.store.listHistory("POLICY"),
    agent_events: deps.store.listHistory("AGENT"),
    incidents: deps.store.listHistory("INCIDENT"),
  };
}
