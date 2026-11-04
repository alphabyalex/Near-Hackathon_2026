import type { HistoryEntry, HistoryView, OverviewView } from "@redline/schemas";
import { useApi } from "../api/client";
import { Facts } from "../components/Facts";
import { LoadError, Loading } from "../components/Loading";
import { Money } from "../components/Money";
import { Panel } from "../components/Panel";
import { formatNs } from "../format";

function Events({ title, empty, entries }: { title: string; empty: string; entries: HistoryEntry[] }) {
  return (
    <Panel title={title} padded>
      {entries.length === 0 ? (
        <p className="loading">{empty}</p>
      ) : (
        <ul className="events">
          {entries.map((e) => (
            <li key={e.id}>
              <time>{formatNs(e.at_ns)}</time>
              {e.summary}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Pausing lives in the top bar, which every dashboard tab shares. */
export function Controls({ data, version }: { data: OverviewView; version: number }) {
  const history = useApi<HistoryView>("/history", version);
  if (history.error) return <LoadError message={history.error} />;
  if (!history.data) return <Loading />;
  const { vendors, policy, policy_changes: policyChanges, agent_events: agentEvents, incidents } = history.data;
  const { manifest, binding, usage, headroom } = data;

  return (
    <div className="stack">
      <div className="pair">
        <Panel title="Active agent version" padded>
          <Facts
            rows={[
              ["Name", manifest.name],
              ["Version", manifest.version],
              ["Model", `${manifest.model_provider} / ${manifest.model_id}`],
              ["Agent account", <span className="mono">{binding?.agent_account_id ?? "None"}</span>],
              ["Agent access", binding?.enabled ? <span className="ok">{"✓ Enabled"}</span> : <span className="bad">{"⊘ Revoked"}</span>],
              ["Binding revision", <span className="mono">{binding?.revision ?? "None"}</span>],
              ["Assessment", <span className="mono">{binding?.assessment_ref ?? "None"}</span>],
            ]}
          />
        </Panel>
        <Panel title="Vault policy" note="Agent payments only" padded>
          <Facts
            rows={[
              ["State", policy.paused ? <span className="bad">{"⊘ Paused: agent payments are stopped"}</span> : <span className="ok">{"✓ Running"}</span>],
              ["Policy revision", <span className="mono">{policy.revision}</span>],
              ["Weekly cap", <Money atomic={policy.weekly_cap_atomic} />],
              ["Weekly headroom", <Money atomic={headroom.weekly_atomic} />],
              ["Lifetime ceiling", <Money atomic={policy.lifetime_cap_atomic} />],
              ["Lifetime headroom", <Money atomic={headroom.lifetime_atomic} />],
              ["Settled, 7 days", <Money atomic={usage.weekly_settled_atomic} />],
              ["Reserved, 7 days", <Money atomic={usage.weekly_reserved_atomic} />],
              ["Settled, lifetime", <Money atomic={usage.lifetime_settled_atomic} />],
              ["Reserved, lifetime", <Money atomic={usage.lifetime_reserved_atomic} />],
              ["Policy expires", formatNs(policy.expires_at_ns)],
            ]}
          />
        </Panel>
      </div>
      <Panel title="Vendors">
        <div className="scrollx">
          <table className="rows">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Account</th>
                <th>Revision</th>
                <th>State</th>
                <th>Per-payment cap</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.vendor_id}>
                  <td>{v.display_name}</td>
                  <td className="code">{v.account_id}</td>
                  <td className="mono num">{v.revision}</td>
                  <td>{v.active ? <span className="ok">{"✓ Active"}</span> : <span className="bad">{"⊘ Inactive"}</span>}</td>
                  <td className="num">
                    <Money atomic={v.per_payment_cap_atomic} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="triple">
        <Events title="Policy and owner actions" empty="None." entries={policyChanges} />
        <Events title="Agent activations" empty="None." entries={agentEvents} />
        <Events title="Incidents" empty="None." entries={incidents} />
      </div>
    </div>
  );
}
