import type { InvoiceSummary } from "@spendgym/schemas";
import { nowNs, REVIEW_STATUS_LABEL, timeOfDay } from "../format";
import { Money } from "./Money";
import { Status } from "./Status";

/** Time, vendor, amount, what the agent said, and where the payment stands. */
export function DecisionTable({ invoices, showRefs = false }: { invoices: readonly InvoiceSummary[]; showRefs?: boolean }) {
  const now = nowNs();
  return (
    <div className="scrollx">
      <table className="rows">
        <thead>
          <tr>
            <th>Time</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Agent said</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.intake_ref}>
              <td className="mono num" style={{ color: "var(--muted)" }}>
                {timeOfDay(inv.received_at_ns, now)}
              </td>
              <td>
                <a href={`#/app/invoices/${encodeURIComponent(inv.intake_ref)}`}>{inv.vendor_name ?? "Unmatched vendor"}</a>
                {showRefs && <span className="ref">{inv.invoice_number ?? inv.intake_ref}</span>}
              </td>
              <td className="num">{inv.amount_atomic ? <Money atomic={inv.amount_atomic} /> : <span className="ref">None</span>}</td>
              <td className={inv.decision === "FLAG" ? "code danger" : "code"}>{inv.decision ?? "None"}</td>
              <td>
                {inv.payment_status === "rejected by policy" && inv.review_status === "OPEN" ? <Status status={inv.payment_status} suffix=", review needed" /> : <Status status={inv.payment_status} />}
                {inv.review_status && inv.review_status !== "OPEN" && <span className="ref">{REVIEW_STATUS_LABEL[inv.review_status]}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
