import type { OverviewView } from "@spendgym/schemas";
import { Facts } from "../components/Facts";
import { Money } from "../components/Money";
import { Status } from "../components/Status";
import { formatNs } from "../format";

export function Overview({ data }: { data: OverviewView }) {
  const { manifest, binding, policy, usage, headroom, vendors, unresolved_payments: unresolved } = data;
  return (
    <div className="stack">
      <section className="grid" aria-label="Agent and vault state">
        <div className="card">
          <h2>Active agent version</h2>
          <Facts
            rows={[
              ["Name", manifest.name],
              ["Version", manifest.version],
              ["Model", `${manifest.model_provider} / ${manifest.model_id}`],
              ["Agent account", <span className="mono">{binding?.agent_account_id ?? "None"}</span>],
              ["Agent access", binding?.enabled ? "\u2713 Enabled" : "\u2298 Revoked"],
              ["Binding revision", binding?.revision ?? "None"],
              ["Assessment", <span className="mono">{binding?.assessment_ref ?? "None"}</span>],
            ]}
          />
        </div>
        <div className="card">
          <h2>Vault policy</h2>
          <Facts
            rows={[
              ["Paused state", policy.paused ? "\u2298 Paused: agent payments are stopped" : "\u2713 Running"],
              ["Policy revision", policy.revision],
              ["Weekly cap (rolling 7 days)", <Money atomic={policy.weekly_cap_atomic} />],
              ["Lifetime ceiling", <Money atomic={policy.lifetime_cap_atomic} />],
              ["Policy expires", formatNs(policy.expires_at_ns)],
            ]}
          />
        </div>
        <div className="card">
          <h2>Usage and headroom</h2>
          <Facts
            rows={[
              ["Vault balance", <Money atomic={usage.balance_atomic} />],
              ["Settled, 7 days", <Money atomic={usage.weekly_settled_atomic} />],
              ["Reserved, 7 days", <Money atomic={usage.weekly_reserved_atomic} />],
              ["Weekly headroom", <Money atomic={headroom.weekly_atomic} />],
              ["Settled, lifetime", <Money atomic={usage.lifetime_settled_atomic} />],
              ["Reserved, lifetime", <Money atomic={usage.lifetime_reserved_atomic} />],
              ["Lifetime headroom", <Money atomic={headroom.lifetime_atomic} />],
            ]}
          />
          <p className="muted small" style={{ marginTop: "var(--space-2)" }}>
            Agent payments only. Owner payments do not use these caps.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Per-vendor caps</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Account</th>
                <th className="num">Per-payment cap</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.vendor_id}>
                  <td>{v.display_name}</td>
                  <td className="mono">{v.account_id}</td>
                  <td className="num">
                    <Money atomic={v.per_payment_cap_atomic} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Unresolved payments</h2>
        {unresolved.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Payable</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {unresolved.map((p) => (
                  <tr key={p.intake_ref}>
                    <td>
                      <a href={`#/invoices/${encodeURIComponent(p.intake_ref)}`}>{p.intake_ref}</a>
                    </td>
                    <td className="mono">{p.payable_ref}</td>
                    <td>
                      <Status status={p.payment_status} />
                    </td>
                    <td className="num">
                      <Money atomic={p.amount_atomic} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
