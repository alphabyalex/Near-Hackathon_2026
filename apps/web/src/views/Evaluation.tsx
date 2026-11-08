import { useState } from "react";
import type { EvaluationDetail, EvaluationSummary } from "@wardline/schemas";
import { useApi } from "../api/client";
import { Facts } from "../components/Facts";
import { LoadError, Loading } from "../components/Loading";
import { Panel } from "../components/Panel";

const AI_LABEL = {
  PASS: <span className="ok">{"✓ Pass"}</span>,
  FAIL: <span className="bad">{"✗ Fail"}</span>,
} as const;
const VAULT_LABEL = {
  NOT_REACHED: "Not reached",
  PAID_CORRECTLY: <span className="ok">{"✓ Paid correctly"}</span>,
  CONTAINED: <span className="warn-text">{"⊘ Blocked by vault"}</span>,
  BREACHED: <span className="bad">{"✗ Unsafe payment went through"}</span>,
} as const;

function Report({ runId }: { runId: string }) {
  const detail = useApi<EvaluationDetail>(`/evaluations/${encodeURIComponent(runId)}`);
  if (detail.error) return <LoadError message={detail.error} />;
  if (!detail.data) return <Loading />;
  const { report, verification } = detail.data;
  return (
    <div className="stack">
      <div className="pair">
        <Panel title="Run identity" padded>
          <Facts
            rows={[
              ["Run", <span className="mono">{report.run_id}</span>],
              ["Issuer", report.issuer],
              ["Agent manifest", <span className="mono">{report.manifest_digest}</span>],
              ["Suite commitment", <span className="mono">{report.suite_commitment}</span>],
              ["Execution", <span className="code">{report.execution_status}</span>],
              ["Assessment outcome", <span className="code">{report.assessment_outcome}</span>],
              [
                "On-chain check",
                verification.on_chain_digest === null ? (
                  <span className="warn-text">? Not checked: no on-chain record for this run</span>
                ) : verification.matches ? (
                  <span className="ok">{"✓ Report matches the on-chain record"}</span>
                ) : (
                  <span className="bad">{"✗ Report does not match the on-chain record"}</span>
                ),
              ],
            ]}
          />
        </Panel>
        <Panel title="Metrics">
          <div className="scrollx">
            <table className="rows" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {report.metrics.map((m) => (
                  <tr key={m.metric_id}>
                    <td>{m.label}</td>
                    <td className="mono num" style={{ whiteSpace: "nowrap" }}>
                      {m.numerator} of {m.denominator}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel title="Per-case results" note="AI and vault scored separately">
        <div className="scrollx">
          <table className="rows">
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
                  <td className="code">{c.scenario_id}</td>
                  <td>{c.family}</td>
                  <td className={c.decision === "FLAG" ? "code danger" : "code"}>{c.decision ?? "None"}</td>
                  <td className="nowrap">{AI_LABEL[c.ai_result]}</td>
                  <td className="nowrap">{VAULT_LABEL[c.vault_result]}</td>
                  <td>{c.note}{c.provenance && <div className="sub">
                    {c.provenance.source}{c.provenance.fallback ? " · fallback decision" : ""}
                    {" · "}{c.provenance.proof_status === "collected" ? "TEE evidence collected (not verified)" : "TEE evidence unavailable"}
                    {c.provenance.completion_id && <div className="mono">{c.provenance.completion_id}</div>}
                  </div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="pair">
        <Panel title="Limitations" padded>
          <ul className="limit-list">
            {report.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Costs" padded>
          <Facts
            rows={[
              ["LLM input tokens", <span className="mono">{report.costs.llm_input_tokens}</span>],
              ["LLM output tokens", <span className="mono">{report.costs.llm_output_tokens}</span>],
              ["Wall clock", <span className="mono">{report.costs.wall_clock_ms} ms</span>],
              ["Estimated USD", report.costs.estimated_usd ?? "Not estimated"],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

export function Evaluation() {
  const runs = useApi<EvaluationSummary[]>("/evaluations");
  const [chosen, setChosen] = useState<string | null>(null);
  if (runs.error) return <LoadError message={runs.error} />;
  if (!runs.data) return <Loading />;
  const [latest] = runs.data;
  if (!latest) return <p className="loading">No evaluation runs yet.</p>;
  const runId = chosen ?? latest.run_id;
  return (
    <div className="stack">
      {runs.data.length > 1 && (
        <label className="runpick">
          Run
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
