import { useState } from "react";
import type { InvoiceDetail, InvoiceSummary, ReviewQueueEntry } from "@spendgym/schemas";
import { apiPost, useApi } from "../api/client";
import { Facts } from "../components/Facts";
import { LoadError, Loading } from "../components/Loading";
import { Money } from "../components/Money";
import { Status } from "../components/Status";
import { formatNs, REVIEW_STATUS_LABEL } from "../format";

const invoiceHref = (ref: string) => `#/invoices/${encodeURIComponent(ref)}`;

function Chips({ values }: { values: string[] }) {
  return (
    <span className="chips">
      {values.map((v) => (
        <span className="chip" key={v}>
          {v}
        </span>
      ))}
    </span>
  );
}

function ReviewQueue({ onChanged }: { onChanged: () => void }) {
  const queue = useApi<ReviewQueueEntry[]>("/review-queue");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (item: ReviewQueueEntry, action: "owner-pay" | "reject") => {
    const prompt =
      action === "owner-pay"
        ? `Pay ${item.payable_ref} as owner? This sends the payable's locked amount to its approved vendor.`
        : `Reject ${item.review_id}? No payment will be made.`;
    if (!window.confirm(prompt)) return;
    setBusy(item.review_id);
    setActionError(null);
    try {
      await apiPost(`/review/${encodeURIComponent(item.review_id)}/${action}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(null);
      queue.reload();
      onChanged();
    }
  };

  return (
    <section className="card">
      <h2>Review Queue</h2>
      <p className="muted small" style={{ marginBottom: "var(--space-3)" }}>
        Soonest due first. Bills due within 48 hours are marked so nothing is paid late.
      </p>
      {actionError && (
        <p className="notice" role="alert" style={{ marginBottom: "var(--space-3)" }}>
          {actionError}
        </p>
      )}
      {queue.error && <LoadError message={queue.error} />}
      {!queue.error && !queue.data && <Loading />}
      {queue.data?.length === 0 && <p className="muted">Nothing needs review.</p>}
      {queue.data && queue.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Due</th>
                <th>Invoice</th>
                <th>Status</th>
                <th>Why</th>
                <th className="num">Amount</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.data.map((item) => (
                <tr key={item.review_id}>
                  <td>
                    <div className="stack-sm">
                      <span style={{ whiteSpace: "nowrap" }}>{formatNs(item.due_at_ns)}</span>
                      {item.due_within_48h && <span className="due-warning">{"\u26A0"} Due within 48h</span>}
                    </div>
                  </td>
                  <td>
                    <a href={invoiceHref(item.intake_ref)}>{item.intake_ref}</a>
                    <div className="muted small">{item.excerpt}</div>
                  </td>
                  <td>
                    <Status status={item.payment_status} />
                    <div className="muted small">From {item.source === "VAULT" ? "vault" : "agent"}</div>
                  </td>
                  <td>
                    <Chips values={item.vault_rejection ? [item.vault_rejection] : item.reason_codes} />
                  </td>
                  <td className="num">{item.amount_atomic ? <Money atomic={item.amount_atomic} /> : <span className="muted">None</span>}</td>
                  <td>
                    {item.payment_status === "outcome uncertain" ? (
                      <span className="small">{item.owner_pay_blocked_reason}</span>
                    ) : (
                      <div className="stack-sm">
                        <div className="actions">
                          <button
                            className="primary"
                            disabled={busy !== null || item.owner_pay_blocked_reason !== null}
                            onClick={() => void act(item, "owner-pay")}
                          >
                            Approve and pay as owner
                          </button>
                          <button disabled={busy !== null} onClick={() => void act(item, "reject")}>
                            Reject
                          </button>
                        </div>
                        {item.owner_pay_blocked_reason && <span className="muted small">{item.owner_pay_blocked_reason}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InvoiceList({ selected, version }: { selected: string | null; version: number }) {
  const invoices = useApi<InvoiceSummary[]>("/invoices", version);
  return (
    <section className="card">
      <h2>Invoices</h2>
      {invoices.error && <LoadError message={invoices.error} />}
      {!invoices.error && !invoices.data && <Loading />}
      {invoices.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Vendor</th>
                <th>Received</th>
                <th>Decision</th>
                <th>Status</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.map((inv) => (
                <tr key={inv.intake_ref} {...(selected === inv.intake_ref ? { "aria-current": "true" as const } : {})}>
                  <td>
                    <a href={invoiceHref(inv.intake_ref)}>{inv.invoice_number ?? inv.intake_ref}</a>
                  </td>
                  <td>{inv.vendor_name ?? <span className="muted">Unmatched</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatNs(inv.received_at_ns)}</td>
                  <td>{inv.decision ?? <span className="muted">None</span>}</td>
                  <td>
                    <Status status={inv.payment_status} />
                    {inv.review_status && inv.review_status !== "OPEN" && (
                      <div className="muted small">{REVIEW_STATUS_LABEL[inv.review_status]}</div>
                    )}
                  </td>
                  <td className="num">{inv.amount_atomic ? <Money atomic={inv.amount_atomic} /> : <span className="muted">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function InvoiceDetailCard({ detail }: { detail: InvoiceDetail }) {
  const { intake, decision, payable, vendor, purchase_order: po, receipt, operation, review } = detail;
  return (
    <section className="card stack" aria-label="Invoice detail">
      <h2>
        Invoice {payable?.invoice_number ?? intake.intake_ref} <Status status={detail.payment_status} />
      </h2>
      <div>
        <h3>Source text</h3>
        <p className="muted small">Untrusted input, shown as plain text.</p>
        <pre className="source-text" data-testid="source-text">
          {intake.source_text}
        </pre>
        {intake.attachments_note && <p className="small">Attachments: {intake.attachments_note}</p>}
      </div>
      <div className="grid">
        <div>
          <h3>Agent decision</h3>
          {decision ? (
            <Facts
              rows={[
                ["Decision", decision.decision],
                ["Reason codes", <Chips values={decision.reason_codes} />],
                ["Summary", decision.summary],
                ["Evidence", decision.evidence_refs.length ? decision.evidence_refs.join(", ") : "None"],
              ]}
            />
          ) : (
            <p className="muted">The agent returned no usable decision, so this went to a human.</p>
          )}
        </div>
        <div>
          <h3>Matched payable</h3>
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
            <p className="muted">No approved payable matched.</p>
          )}
        </div>
        <div>
          <h3>Purchase order and receipt</h3>
          {po ? (
            <Facts
              rows={[
                ["PO", po.po_number],
                ["PO total", <Money atomic={po.total_atomic} />],
                ["Approved by", <span className="mono">{po.approved_by}</span>],
                ["Lines", po.lines.map((l) => `${l.quantity} x ${l.description}`).join("; ")],
                ["Receipt", receipt ? `${receipt.receipt_id}: ${receipt.note}` : "\u2298 No goods receipt on file"],
              ]}
            />
          ) : (
            <p className="muted">No purchase order.</p>
          )}
        </div>
        <div>
          <h3>Payment status</h3>
          <Facts
            rows={[
              ["Status", <Status status={detail.payment_status} />],
              ["Operation", operation ? <span className="mono">{operation.operation_id}</span> : "None"],
              ["Transaction", operation?.tx_hash ? <span className="mono">{operation.tx_hash}</span> : "None"],
              ["Vault rejection", review?.vault_rejection ?? "None"],
              ["Review", review ? REVIEW_STATUS_LABEL[review.status] : "Not needed"],
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function SelectedInvoice({ intakeRef, version }: { intakeRef: string; version: number }) {
  const detail = useApi<InvoiceDetail>(`/invoices/${encodeURIComponent(intakeRef)}`, version);
  if (detail.error) return <LoadError message={detail.error} />;
  if (!detail.data) return <Loading />;
  return <InvoiceDetailCard detail={detail.data} />;
}

export function Invoices({ selected, onChanged }: { selected: string | null; onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const changed = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  return (
    <div className="stack">
      <ReviewQueue onChanged={changed} />
      <InvoiceList selected={selected} version={version} />
      {selected ? <SelectedInvoice intakeRef={selected} version={version} /> : <p className="muted">Pick an invoice to see its detail.</p>}
    </div>
  );
}
