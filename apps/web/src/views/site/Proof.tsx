/** The proof engine: why the Mutual's yield is safe. */
import { useEffect, useState } from "react";
import { Problem } from "../../components/Problem";
import { TxLink } from "../../components/TxLink";
import { getProofs, type ProofRow } from "../../data/proofs";
import { callWords, modelName } from "../../ai/words";
import { CONNECT, PROOF } from "../../brand";
import { CodeBlock } from "../../components/CodeBlock";
import { Fingerprint } from "../../components/HorizonMark";
import { SNIPPET_API_URL, SNIPPET_IS_PLACEHOLDER } from "../../config";
import { percent, REDTEAM } from "../../redteam";

/** USDC for the table: two decimals, "<0.01" for a fraction of a cent, "0.00" when nothing moved. */
export function proofAmount(atomic: string): string {
  const n = BigInt(atomic);
  if (n === 0n) return "0.00";
  if (n < 10_000n) return PROOF.under;
  return (Number(n) / 1e6).toFixed(2);
}

/** One table row: a call, or a run of the same outcome from the same group shown once with its count. */
export interface ProofGroup {
  row: ProofRow;
  count: number;
  /** Atomic USDC, summed over the run. */
  total: string;
}

/** Collapses back-to-back rows with the same group, outcome and side into one, so repeats read as one line. */
export function collapseProofs(rows: ProofRow[], key: (p: ProofRow) => string): ProofGroup[] {
  const out: ProofGroup[] = [];
  for (const p of rows) {
    const value = BigInt(p.side === "above" ? p.amount : p.refund);
    const last = out[out.length - 1];
    if (last && key(last.row) === key(p)) {
      last.count++;
      last.total = (BigInt(last.total) + value).toString();
    } else out.push({ row: p, count: 1, total: value.toString() });
  }
  return out;
}

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
  const { headline } = REDTEAM;
  const R = PROOF.results;
  const cells = [
    [R.caught, percent(headline.attackCatchRate), R.caughtNote],
    [R.unsafe, String(headline.unsafePays), R.unsafeNote],
    [R.falsePositive, percent(headline.legitFalsePositiveRate), R.falsePositiveNote],
    [R.latency, `${headline.latencyP50Ms} ms`, R.latencyNote],
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
    getProofs(30).then(
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
                {collapseProofs(rows, (p) => `${p.group}|${p.side}|${whatHappened(p)}`)
                  .slice(0, 12)
                  .map(({ row: p, count, total }) => (
                  <tr key={p.call_id} data-side={p.side} data-count={count}>
                    <td>
                      <Fingerprint id={p.call_id} side={p.side} />
                    </td>
                    <td>{p.group}</td>
                    <td>
                      {whatHappened(p)}
                      {count > 1 && (
                        <span className="proof-repeat num">
                          <span aria-hidden="true"> {PROOF.repeat(count)}</span>
                          <span className="sr-only">, {PROOF.repeatLabel(count)}</span>
                        </span>
                      )}
                    </td>
                    <td className="num r">{proofAmount(total)} USDC</td>
                    <td className={p.side === "above" ? "side-above" : "side-below"}>
                      {sideText(p)}
                      {p.tx && (
                        <>
                          {" "}
                          <TxLink hash={p.tx} plain={false} />
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
              <a className="btn" href="#/how-it-works">
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
            {SNIPPET_IS_PLACEHOLDER && <p className="fine" data-testid="snippet-placeholder">{CONNECT.placeholder}</p>}
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
