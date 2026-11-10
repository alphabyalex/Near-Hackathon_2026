/** The proof engine: why the Mutual's yield is safe. */
import { useEffect, useState } from "react";
import { Problem } from "../../components/Problem";
import { TxLink } from "../../components/TxLink";
import { getProofs, type ProofRow } from "../../data/proofs";
import { callWords, modelName } from "../../ai/words";
import { PROOF } from "../../brand";
import { CodeBlock } from "../../components/CodeBlock";
import { Fingerprint } from "../../components/HorizonMark";
import { SNIPPET_API_URL } from "../../config";
import { percent, REDTEAM } from "../../redteam";

const usd = (atomic: string) => (Number(BigInt(atomic)) / 1e6).toFixed(6);

const SNIPPET = (apiUrl: string) => `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: ${JSON.stringify(`${apiUrl}/v1/ai`)}, // the one line
  apiKey: process.env.WARDLINE_METER_KEY,
});`;

function sideText(p: ProofRow): string {
  if (p.side === "above") return PROOF.above;
  if (p.reason === "ALLOWANCE_EXHAUSTED" || p.reason === "BUDGET_EXHAUSTED") return PROOF.below(PROOF.how.capped);
  return PROOF.below(PROOF.how.refunded);
}

function whatHappened(p: ProofRow): string {
  if (p.side === "above") return `${modelName(p.model_proven)} proven and paid`;
  return callWords(p.reason) || p.status;
}

export function ResultsStrip() {
  const { headline, cases } = REDTEAM;
  const cells = [
    ["Attacks stopped", percent(headline.attackCatchRate), `${cases.attacks} written, ${cases.adversarial} model-invented`],
    ["Unsafe payments", String(headline.unsafePays), "PAY on a scam payee"],
    ["False positives", percent(headline.legitFalsePositiveRate), `${cases.legit} legitimate invoices`],
    ["Check latency", `${headline.latencyP50Ms} ms`, `p50 in process, p95 ${headline.latencyP95Ms} ms`],
  ] as const;
  return (
    <section className="sec" aria-labelledby="results-title">
      <div className="wrap">
        <h2 className="h2" id="results-title">
          {PROOF.resultsTitle}
        </h2>
        <dl className="stat-row results">
          {cells.map(([label, value, note]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="num">{value}</dd>
              <dd className="stat-note">{note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function LatestProofs() {
  const [rows, setRows] = useState<ProofRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setError(null);
    getProofs(12).then(
      (r) => setRows(r.proofs),
      (e: unknown) => setError(e),
    );
  }, [tick]);
  return (
    <section className="sec" aria-labelledby="latest-title">
      <div className="wrap">
        <h2 className="h2" id="latest-title">
          {PROOF.latestTitle}
        </h2>
        {error !== null && <Problem error={error} onRetry={() => setTick((t) => t + 1)} />}
        {rows === null && error === null && <div className="skel-card proofs-skel" aria-hidden="true" />}
        {rows && rows.length === 0 && <p className="empty">{PROOF.latestEmpty}</p>}
        {rows && rows.length > 0 && (
          <div className="scrollx" role="region" aria-label={PROOF.latestTitle} tabIndex={0}>
            <table className="tbl proofs" data-testid="proofs">
              <thead>
                <tr>
                  <th>{PROOF.col.fingerprint}</th>
                  <th>{PROOF.col.group}</th>
                  <th>{PROOF.col.what}</th>
                  <th className="r">{PROOF.col.amount}</th>
                  <th>{PROOF.col.side}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.call_id} data-side={p.side}>
                    <td>
                      <Fingerprint id={p.call_id} side={p.side} />
                    </td>
                    <td>{p.group}</td>
                    <td>{whatHappened(p)}</td>
                    <td className="num r">{usd(p.side === "above" ? p.amount : p.refund)} USDC</td>
                    <td className={p.side === "above" ? "side-above" : "side-below"}>
                      {sideText(p)}
                      {p.tx && (
                        <>
                          {" "}
                          · <TxLink hash={p.tx} plain={false} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function Proof() {
  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap proof-intro">
          <div>
            <h1 className="h1">{PROOF.title}</h1>
            <p className="lede">{PROOF.sub}</p>
            <div className="actions">
              <a className="btn" href="#/demo">
                {PROOF.primary}
              </a>
              <a className="btn ghost" href="#/try">
                {PROOF.secondary}
              </a>
            </div>
          </div>
          <div className="snippet">
            <p className="snippet-label">{PROOF.snippetLabel}</p>
            <CodeBlock code={SNIPPET(SNIPPET_API_URL)} label="OpenAI client" language="js" />
            <p className="fine">{PROOF.snippetNote}</p>
          </div>
        </div>
      </section>

      <section className="sec tight" aria-label={PROOF.steps.map(([s]) => s).join(", ")}>
        <div className="wrap">
          <ol className="steps-row">
            {PROOF.steps.map(([name, line], i) => (
              <li key={name}>
                <span className="step-n num">{i + 1}</span>
                <b>{name}</b>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <LatestProofs />
      <ResultsStrip />
      <div className="wrap proof-verify">
        <a className="link" href="#/verify">
          {PROOF.verifyLink}
        </a>
      </div>
    </main>
  );
}
