import { useState, type FormEvent } from "react";
import { createMeterKey, revokeMeterKey, type GroupView, type MeterKeyRow } from "../../api/ai";
import { useApi } from "../../api/client";
import { errorText } from "../../api/public";
import { KEYS } from "../../brand";
import { CodeBlock } from "../../components/CodeBlock";
import { LoadError, Loading } from "../../components/Loading";
import { modelName } from "../../ai/words";

/** Per-member keys for the OpenAI-compatible gateway. Shown once, stored hashed. */
export function MeterKeys({ version, onChanged }: { version: number; onChanged: () => void }) {
  const keys = useApi<{ keys: MeterKeyRow[] }>("/owner/meter-keys", version);
  const group = useApi<GroupView>("/owner/group", version);
  const [member, setMember] = useState("");
  const [label, setLabel] = useState("");
  const [model, setModel] = useState("");
  const [created, setCreated] = useState<{ key: string; row: MeterKeyRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = group.data?.budget.members.map((m) => m.member) ?? [];
  const chosen = member || members[0] || "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await createMeterKey({ member: chosen, ...(label.trim() ? { label: label.trim() } : {}), ...(model ? { models: [model] } : {}) }));
      setLabel("");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: MeterKeyRow) => {
    if (!window.confirm(`Revoke ${row.label || row.id}? Calls with it stop at once.`)) return;
    try {
      await revokeMeterKey(row.id);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="keys meter-keys">
      <div className="desk-intro">
        <h2>{KEYS.meterTitle}</h2>
        <p>{KEYS.meterLede}</p>
      </div>
      <form className="panel pb keyform" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>{KEYS.member}</span>
          <select value={chosen} onChange={(e) => setMember(e.target.value)} required>
            {members.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{KEYS.label}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Research notebook" maxLength={60} />
        </label>
        <label className="field">
          <span>{KEYS.models}</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">{KEYS.allModels}</option>
            {(group.data?.routes ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button className="btn sm" type="submit" disabled={busy || !chosen}>
            {KEYS.createMeter}
          </button>
        </div>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {created && (
        <div className="newkey" role="status">
          <p>{KEYS.once}</p>
          <CodeBlock code={created.key} label="New meter key" language="key" />
        </div>
      )}
      {keys.error && <LoadError message={keys.error} />}
      {!keys.data && !keys.error && <Loading />}
      {keys.data && (
        <section className="panel">
          {keys.data.keys.length === 0 ? (
            <p className="empty">{KEYS.empty}</p>
          ) : (
            <div className="scrollx">
              <table className="rows">
                <thead>
                  <tr>
                    <th>{KEYS.label}</th>
                    <th>{KEYS.member}</th>
                    <th>{KEYS.models}</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.data.keys.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.label || <span className="muted">{row.prefix}...</span>}
                        <span className="ref">{row.id}</span>
                      </td>
                      <td className="mono">{row.member}</td>
                      <td>{row.models ? row.models.map(modelName).join(", ") : KEYS.allModels}</td>
                      <td className="act">
                        {row.revokedAt ? (
                          <span className="muted">{KEYS.revoked}</span>
                        ) : (
                          <button type="button" className="sbtn ghost" onClick={() => void revoke(row)}>
                            {KEYS.revoke}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
