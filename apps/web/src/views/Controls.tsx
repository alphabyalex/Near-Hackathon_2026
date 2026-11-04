import { useState } from "react";
import type { HistoryEntry, HistoryView } from "@spendgym/schemas";
import { apiPost, useApi } from "../api/client";
import { LoadError, Loading } from "../components/Loading";
import { Money } from "../components/Money";
import { formatNs } from "../format";

function Events({ title, empty, entries }: { title: string; empty: string; entries: HistoryEntry[] }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {entries.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <span className="muted small">{formatNs(e.at_ns)}</span>
              <br />
              {e.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Controls({ onChanged }: { onChanged: () => void }) {
  const history = useApi<HistoryView>("/history");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pause = async () => {
    if (!window.confirm("Pause this vault? All agent payments stop.")) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/vault/pause");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pause.");
    } finally {
      setBusy(false);
      history.reload();
      onChanged();
    }
  };

  if (history.error) return <LoadError message={history.error} />;
  if (!history.data) return <Loading />;
  const { vendors, policy, policy_changes: policyChanges, agent_events: agentEvents, incidents } = history.data;

  return (
    <div className="stack">
      <section className="card stack-sm">
        <h2>Vault controls</h2>
        <p>{policy.paused ? "\u2298 Paused: agent payments are stopped." : "\u2713 Running: the agent can request payments within limits."}</p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary" disabled={busy || policy.paused} onClick={() => void pause()}>
            {policy.paused ? "Vault paused" : "Pause vault"}
          </button>
        </div>
      </section>
      <section className="card">
        <h2>Vendors</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Account</th>
                <th className="num">Revision</th>
                <th>State</th>
                <th className="num">Per-payment cap</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.vendor_id}>
                  <td>{v.display_name}</td>
                  <td className="mono">{v.account_id}</td>
                  <td className="num">{v.revision}</td>
                  <td>{v.active ? "\u2713 Active" : "\u2298 Inactive"}</td>
                  <td className="num">
                    <Money atomic={v.per_payment_cap_atomic} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid">
        <Events title="Policy changes and owner actions" empty="None." entries={policyChanges} />
        <Events title="Agent activations and revocations" empty="None." entries={agentEvents} />
        <Events title="Incidents" empty="None." entries={incidents} />
      </section>
    </div>
  );
}
