import { useState } from "react";
import type { EvaluationDetail, EvaluationSummary } from "@spendgym/schemas";
import { useApi } from "../api/client";
import { Facts } from "../components/Facts";
import { LoadError, Loading } from "../components/Loading";

const AI_LABEL = { PASS: "\u2713 Pass", FAIL: "\u2717 Fail" } as const;
const VAULT_LABEL = {
  NOT_REACHED: "Not reached",
  PAID_CORRECTLY: "\u2713 Paid correctly",
  CONTAINED: "\u2298 Blocked by vault",
  BREACHED: "\u2717 Unsafe payment went through",
} as const;

function Report({ runId }: { runId: string }) {
  const detail = useApi<EvaluationDetail>(`/evaluations/${encodeURIComponent(runId)}`);
  if (detail.error) return <LoadError message={detail.error} />;
  if (!detail.data) return <Loading />;
  const { report, verification } = detail.data;
  return (
    <div className="stack">
      <section className="card">
        <h2>Run identity</h2>
        <Facts
          rows={[
            ["Run", <span className="mono">{report.run_id}</span>],
            ["Issuer", report.issuer],
            ["Agent manifest", <span className="mono">{report.manifest_digest}</span>],
            ["Suite commitment", <span className="mono">{report.suite_commitment}</span>],
            ["Execution", report.execution_status],
            ["Assessment outcome", report.assessment_outcome],
            [
              "On-chain check",
              verification.on_chain_digest === null
                ? "? Not checked: no on-chain record for this run"
                : verification.matches
                  ? "\u2713 Report matches the on-chain record"
                  : "\u2717 Report does not match the on-chain record",
            ],
          ]}
        />
      </section>
      <section className="card">
        <h2>Metrics</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Numerator</th>
                <th className="num">Denominator</th>
              </tr>
            </thead>
            <tbody>
              {report.metrics.map((m) => (
                <tr key={m.metric_id}>
                  <td>{m.label}</td>
                  <td className="num">{m.numerator}</td>
                  <td className="num">{m.denominator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>Per-case results</h2>
        <p className="muted small" style={{ marginBottom: "var(--space-3)" }}>
          The AI and the vault are scored separately. An unsafe AI proposal the vault blocks is one AI failure and one vault containment success.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Family</th>
                <th>Decision</th>
                <th>AI result</th>
                <th>Vault result</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {report.cases.map((c) => (
                <tr key={c.scenario_id}>
                  <td className="mono">{c.scenario_id}</td>
                  <td>{c.family}</td>
                  <td>{c.decision ?? "None"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{AI_LABEL[c.ai_result]}</td>
                  <td>{VAULT_LABEL[c.vault_result]}</td>
                  <td>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid">
        <div className="card">
          <h2>Limitations</h2>
          <ul>
            {report.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Costs</h2>
          <Facts
            rows={[
              ["LLM input tokens", report.costs.llm_input_tokens],
              ["LLM output tokens", report.costs.llm_output_tokens],
              ["Wall clock", `${report.costs.wall_clock_ms} ms`],
              ["Estimated USD", report.costs.estimated_usd ?? "Not estimated"],
            ]}
          />
        </div>
      </section>
    </div>
  );
}

export function Evaluation() {
  const runs = useApi<EvaluationSummary[]>("/evaluations");
  const [chosen, setChosen] = useState<string | null>(null);
  if (runs.error) return <LoadError message={runs.error} />;
  if (!runs.data) return <Loading />;
  if (runs.data.length === 0) return <p className="muted">No evaluation runs yet.</p>;
  const runId = chosen ?? (runs.data[0] as EvaluationSummary).run_id;
  return (
    <div className="stack">
      {runs.data.length > 1 && (
        <label>
          Run{" "}
          <select value={runId} onChange={(e) => setChosen(e.target.value)}>
            {runs.data.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id}
              </option>
            ))}
          </select>
        </label>
      )}
      <Report runId={runId} />
    </div>
  );
}
