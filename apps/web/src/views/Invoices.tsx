import type { InvoiceDetail, InvoiceSummary, ReviewQueueEntry } from "@spendgym/schemas";
import { useApi } from "../api/client";
import { DecisionTable } from "../components/DecisionTable";
import { Facts } from "../components/Facts";
import { LoadError, Loading } from "../components/Loading";
import { Money } from "../components/Money";
import { Panel } from "../components/Panel";
import { ReviewQueue } from "../components/ReviewQueue";
import { Status } from "../components/Status";
import { formatNs, REVIEW_STATUS_LABEL } from "../format";

function Codes({ values }: { values: string[] }) {
  return (
    <span className="codes" style={{ justifyContent: "flex-end" }}>
      {values.map((v) => (
        <span className="code" key={v}>
          {v}
        </span>
      ))}
    </span>
  );
}

function InvoiceList({ version }: { version: number }) {
  const invoices = useApi<InvoiceSummary[]>("/invoices", version);
  return (
    <Panel title="Invoices" note="Pick one to see its detail">
      {invoices.error && (
        <div className="pb">
          <LoadError message={invoices.error} />
        </div>
      )}
      {!invoices.error && !invoices.data && (
        <div className="pb">
          <Loading />
        </div>
      )}
      {invoices.data && <DecisionTable invoices={invoices.data} showRefs />}
    </Panel>
  );
}

export function InvoiceDetailCard({ detail }: { detail: InvoiceDetail }) {
  const { intake, decision, payable, vendor, purchase_order: po, receipt, operation, review } = detail;
  return (
    <div className="stack" aria-label="Invoice detail">
      <section className="panel">
        <div className="ph">
          <div className="detail-head">
            <h2>Invoice {payable?.invoice_number ?? intake.intake_ref}</h2>
            <Status status={detail.payment_status} />
          </div>
          <span>Untrusted input, shown as plain text</span>
        </div>
        <pre className="source-text" data-testid="source-text">
          {intake.source_text}
        </pre>
        {intake.attachments_note && <div className="source-note">Attachments: {intake.attachments_note}</div>}
      </section>
      <div className="pair">
        <Panel title="Agent decision" padded>
          {decision ? (
            <Facts
              rows={[
                ["Decision", <span className="code">{decision.decision}</span>],
                ["Reason codes", <Codes values={decision.reason_codes} />],
                ["Summary", decision.summary],
                ["Evidence", decision.evidence_refs.length ? decision.evidence_refs.join(", ") : "None"],
              ]}
            />
          ) : (
            <p className="loading">The agent returned no usable decision, so this went to a human.</p>
          )}
        </Panel>
        <Panel title="Matched payable" padded>
          {payable ? (
            <Facts
              rows={[
                ["Payable", <span className="mono">{payable.payable_ref}</span>],
                ["Vendor", vendor ? `${vendor.display_name} (revision ${vendor.revision})` : payable.vendor_id],
                ["Recipient", <span className="mono">{vendor?.account_id ?? "Unknown"}</span>],
                ["Locked amount", <Money atomic={payable.amount_atomic} />],
                ["Vendor cap", vendor ? <Money atomic={vendor.per_payment_cap_atomic} /> : "Unknown"],
                ["Due", formatNs(payable.due_at_ns)],
              ]}
            />
          ) : (
            <p className="loading">No approved payable matched.</p>
          )}
        </Panel>
        <Panel title="Purchase order and receipt" padded>
          {po ? (
            <Facts
              rows={[
                ["PO", po.po_number],
                ["PO total", <Money atomic={po.total_atomic} />],
                ["Approved by", <span className="mono">{po.approved_by}</span>],
                ["Lines", po.lines.map((l) => `${l.quantity} x ${l.description}`).join("; ")],
                ["Receipt", receipt ? `${receipt.receipt_id}: ${receipt.note}` : "No goods receipt on file"],
              ]}
            />
          ) : (
            <p className="loading">No purchase order.</p>
          )}
        </Panel>
        <Panel title="Payment status" padded>
          <Facts
            rows={[
              ["Status", <Status status={detail.payment_status} />],
              ["Operation", operation ? <span className="mono">{operation.operation_id}</span> : "None"],
              ["Transaction", operation?.tx_hash ? <span className="mono">{operation.tx_hash}</span> : "None"],
              ["Vault rejection", review?.vault_rejection ? <span className="code">{review.vault_rejection}</span> : "None"],
              ["Review", review ? REVIEW_STATUS_LABEL[review.status] : "Not needed"],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

function SelectedInvoice({ intakeRef, version }: { intakeRef: string; version: number }) {
  const detail = useApi<InvoiceDetail>(`/invoices/${encodeURIComponent(intakeRef)}`, version);
  return (
    <>
      <a className="back" href="#/app/invoices">
        All invoices
      </a>
      {detail.error && <LoadError message={detail.error} />}
      {!detail.error && !detail.data && <Loading />}
      {detail.data && <InvoiceDetailCard detail={detail.data} />}
    </>
  );
}

export function Invoices({ selected, version, onChanged }: { selected: string | null; version: number; onChanged: () => void }) {
  const queue = useApi<ReviewQueueEntry[]>(selected ? null : "/review-queue", version);
  if (selected) return <SelectedInvoice intakeRef={selected} version={version} />;
  return (
    <div className="stack">
      <ReviewQueue queue={queue} onChanged={onChanged} />
      <InvoiceList version={version} />
    </div>
  );
}
