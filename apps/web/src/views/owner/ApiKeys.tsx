import { useState, type FormEvent } from "react";
import { useApi } from "../../api/client";
import { createKey, revokeKey, type ApiKeyRow } from "../../api/owner";
import { errorText } from "../../api/public";
import { KEYS } from "../../brand";
import { CodeBlock } from "../../components/CodeBlock";
import { LoadError, Loading } from "../../components/Loading";

export function ApiKeys({ version, onChanged, defaultPayer }: { version: number; onChanged: () => void; defaultPayer: string }) {
  const keys = useApi<{ keys: ApiKeyRow[] }>("/owner/api-keys", version);
  const [payer, setPayer] = useState(defaultPayer);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"check" | "record">("check");
  const [created, setCreated] = useState<(ApiKeyRow & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await createKey({ payer: payer.trim(), ...(label.trim() ? { label: label.trim() } : {}), scopes: scope === "check" ? ["check"] : ["check", "record"] }));
      setLabel("");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: ApiKeyRow) => {
    if (!window.confirm(`Revoke ${row.label ?? row.id}? Calls with it stop working at once.`)) return;
    setError(null);
    try {
      await revokeKey(row.id);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="keys">
      <div className="desk-intro">
        <h2>{KEYS.title}</h2>
        <p>{KEYS.lede}</p>
      </div>
      <form className="panel pb keyform" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>{KEYS.payer}</span>
          <input value={payer} onChange={(e) => setPayer(e.target.value)} required spellCheck={false} />
        </label>
        <label className="field">
          <span>{KEYS.label}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Invoice agent" maxLength={120} />
        </label>
        <fieldset className="field scopes">
          <legend>{KEYS.scope}</legend>
          <label>
            <input type="radio" name="scope" checked={scope === "check"} onChange={() => setScope("check")} /> {KEYS.checkOnly}
          </label>
          <label>
            <input type="radio" name="scope" checked={scope === "record"} onChange={() => setScope("record")} /> {KEYS.checkRecord}
          </label>
        </fieldset>
        <div className="form-actions">
          <button className="btn sm" type="submit" disabled={busy}>
            {KEYS.create}
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
          <CodeBlock code={created.key} label="New API key" language={created.scopes.join(" + ")} />
        </div>
      )}
      {keys.error && <LoadError message={keys.error} />}
      {!keys.error && !keys.data && <Loading />}
      {keys.data && (
        <section className="panel">
          {keys.data.keys.length === 0 ? (
            <p className="empty">{KEYS.empty}</p>
          ) : (
            <div className="scrollx">
              <table className="rows">
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Payer</th>
                    <th scope="col">{KEYS.scope}</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.data.keys.map((row) => (
                    <tr key={row.id} data-key={row.id}>
                      <td>
                        {row.label ?? "Unlabelled"}
                        <span className="ref">{row.id}</span>
                      </td>
                      <td className="mono">{row.payer}</td>
                      <td className="mono">{row.scopes.join(" + ")}</td>
                      <td>
                        <span className="mono nowrap">{row.createdAt.slice(0, 16).replace("T", " ")}</span>
                        <span className="ref">{row.createdBy}</span>
                      </td>
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
