import { useState } from "react";
import type { ReviewQueueEntry } from "@redline/schemas";
import { apiPost, type Loaded } from "../api/client";
import { dueIn, nowNs } from "../format";
import { LoadError, Loading } from "./Loading";
import { Money } from "./Money";
import { Panel } from "./Panel";
import { Status } from "./Status";

const invoiceHref = (ref: string) => `#/app/invoices/${encodeURIComponent(ref)}`;

function Actions({ item, busy, onAct }: { item: ReviewQueueEntry; busy: boolean; onAct: (action: "owner-pay" | "reject") => void }) {
  // Outcome uncertain blocks both actions, to avoid paying twice.
  if (item.payment_status === "outcome uncertain") return <p className="act-note">{item.owner_pay_blocked_reason}</p>;
  return (
    <>
      <div className="act">
        <button type="button" className="sbtn" disabled={busy || item.owner_pay_blocked_reason !== null} onClick={() => onAct("owner-pay")}>
          Approve and pay
        </button>
        <button type="button" className="sbtn ghost" disabled={busy} onClick={() => onAct("reject")}>
          Reject
        </button>
      </div>
      {item.owner_pay_blocked_reason && <p className="act-note">{item.owner_pay_blocked_reason}</p>}
    </>
  );
}

export function ReviewQueue({ queue, onChanged }: { queue: Loaded<ReviewQueueEntry[]>; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = nowNs();

  const act = async (item: ReviewQueueEntry, action: "owner-pay" | "reject") => {
    const prompt =
      action === "owner-pay"
        ? `Pay ${item.payable_ref} as owner? This sends the payable's locked amount to its approved vendor.`
        : `Reject ${item.review_id}? No payment will be made.`;
    if (!window.confirm(prompt)) return;
    setBusy(item.review_id);
    setActionError(null);
    try {
      await apiPost(`/owner/review/${encodeURIComponent(item.review_id)}/${action}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  return (
    <Panel title="Review queue" note="Soonest due first">
      {actionError && (
        <p className="notice" role="alert" style={{ margin: "16px 22px" }}>
          {actionError}
        </p>
      )}
      {queue.error && <div className="pb"><LoadError message={queue.error} /></div>}
      {!queue.error && !queue.data && <div className="pb"><Loading /></div>}
      {queue.data?.length === 0 && <p className="empty">Nothing needs review.</p>}
      {queue.data && queue.data.length > 0 && (
        <div className="scrollx">
          <table className="rows">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Why it is here</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data.map((item) => {
                const refs = item.invoice_number ? `${item.invoice_number} · ${item.po_number ?? "no PO"}` : `${item.intake_ref} · no PO`;
                return (
                  <tr key={item.review_id}>
                    <td>
                      {item.vendor_name ?? "Unmatched vendor"}
                      <span className="ref">
                        <a href={invoiceHref(item.intake_ref)}>{refs}</a>
                      </span>
                      {!item.vendor_name && (
                        <span className="ref clip" title={item.excerpt}>
                          {item.excerpt}
                        </span>
                      )}
                    </td>
                    <td className="num">{item.amount_atomic ? <Money atomic={item.amount_atomic} /> : <span className="ref">None</span>}</td>
                    <td>
                      {item.payment_status === "outcome uncertain" ? (
                        <Status status={item.payment_status} />
                      ) : (
                        <span className="codes">
                          {(item.vault_rejection ? [item.vault_rejection] : item.reason_codes).map((code) => (
                            <span className={item.payment_status === "flagged" ? "code danger" : "code"} key={code}>
                              {code}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className={item.due_within_48h ? "due-soon" : ""}>
                      {dueIn(item.due_at_ns, now)}
                      {item.due_within_48h && <span className="ref">due within 48 hours</span>}
                    </td>
                    <td>
                      <Actions item={item} busy={busy !== null} onAct={(action) => void act(item, action)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
