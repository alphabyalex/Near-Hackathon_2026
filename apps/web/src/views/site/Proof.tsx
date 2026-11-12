/** The proof engine: why the Mutual's yield is safe. */
import { useEffect, useId, useState } from "react";
import { Problem } from "../../components/Problem";
import { TxLink } from "../../components/TxLink";
import { LineStats } from "../../components/LineStats";
import { getProofs, type ProofRow } from "../../data/proofs";
import { getGroups } from "../../data/groups";
import { callWords, modelName } from "../../ai/words";
import { CONNECT, PROOF } from "../../brand";
import { CodeBlock } from "../../components/CodeBlock";
import { Fingerprint } from "../../components/HorizonMark";
import { SNIPPET_API_URL, SNIPPET_IS_PLACEHOLDER } from "../../config";
import { percent, REDTEAM } from "../../redteam";
import "./proof.css";

/** USDC for the feed: two decimals, "<0.01" for a fraction of a cent, "0.00" when nothing moved. */
export function proofAmount(atomic: string): string {
  const n = BigInt(atomic);
  if (n === 0n) return "0.00";
  if (n < 10_000n) return PROOF.under;
  return (Number(n) / 1e6).toFixed(2);
}

/** USDC at its real precision, for the explanation: 200 atomic is "0.0002", 2000000 is "2.00". */
export function exactUsdc(atomic: string): string {
  const n = BigInt(atomic);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac.length >= 2 ? `${whole}.${frac}` : `${whole}.${frac.padEnd(2, "0")}`;
}

/** A fee in basis points as people say it: 200 is "2%", 150 is "1.5%". */
export const feePercent = (bps: number): string => `${Number((bps / 100).toFixed(2))}%`;

/** One feed row: a call, or a run of the same outcome from the same group shown once with its count. */
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

export type Verdict = keyof typeof PROOF.verdict;

/** Above the line is paid. Below, a spend limit caps, a non-member is blocked, anything else is refunded. */
export function verdictOf(p: Pick<ProofRow, "side" | "reason">): Verdict {
  if (p.side === "above") return "paid";
  if (p.reason === "ALLOWANCE_EXHAUSTED" || p.reason === "BUDGET_EXHAUSTED") return "capped";
  if (p.reason === "UNKNOWN_MEMBER") return "blocked";
  return "refunded";
}

/** The plain-English story of one row, from its own data. `feeBps` is the group's fee when known. */
export function explainProof(g: ProofGroup, feeBps: number | null): string {
  const { count, total } = g;
  // "Hassan (solo)" reads as "Hassan" in a sentence: the parenthetical is a label, not part of the name.
  const p = { ...g.row, group: g.row.group.replace(/\s*\([^)]*\)$/, "") || g.row.group };
  const E = PROOF.explain;
  const asked = modelName(p.model_claimed || null);
  let story: string;
  switch (verdictOf(p)) {
    case "paid":
      story = E.paid(p.group, modelName(p.model_proven ?? p.model_claimed), exactUsdc(p.amount), feeBps === null ? null : feePercent(feeBps));
      break;
    case "capped":
      story = p.reason === "BUDGET_EXHAUSTED" ? E.budget(p.group) : E.capped(p.group);
      break;
    case "blocked":
      story = E.blocked(p.group);
      break;
    default:
      story =
        p.reason === "MODEL_MISMATCH"
          ? E.swapped(p.group, asked, p.model_proven && p.model_proven !== p.model_claimed ? modelName(p.model_proven) : null)
          : E.failed(p.group, asked, callWords(p.reason));
  }
  if (count > 1) story += ` ${E.repeat(count, total !== "0" ? exactUsdc(total) : null)}`;
  return story;
}

/** Every attack the red-team report ran: the written attack cases plus the adversarial ones. */
export function attackCount(cases: { attacks: number; adversarial: number } = REDTEAM.cases): number {
  return cases.attacks + cases.adversarial;
}

/** "250+" once the test reaches 250 attacks, the exact count below that. */
export const attackCountText = (n: number): string => (n >= 250 ? "250+" : String(n));

/** The share of all attacks held, weighting the written and adversarial catch rates by their case counts. */
export function scamCatchRate(r: Pick<typeof REDTEAM, "cases" | "headline"> = REDTEAM): number {
  const n = attackCount(r.cases);
  return n === 0 ? 0 : (r.headline.attackCatchRate * r.cases.attacks + r.headline.adversarialCatchRate * r.cases.adversarial) / n;
}

/** Milliseconds as read aloud: 0.027 stays "0.027 ms", 12.34 becomes "12.3 ms". */
export const formatMs = (ms: number): string => `${ms < 1 ? Number(ms.toPrecision(2)) : Math.round(ms * 10) / 10} ms`;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const SNIPPET = (apiUrl: string) => `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: ${JSON.stringify(`${apiUrl}/v1/ai`)}, // the one line
  apiKey: process.env.WARDLINE_METER_KEY,
});`;

function whatHappened(p: ProofRow): string {
  if (p.side === "above") return `${modelName(p.model_proven)} proven and paid`;
  return callWords(p.reason) || p.status;
}

/** Time to check above the line, the share of scams held below it, and the smaller numbers under it. */
export function ProofStats() {
  const { headline, cases } = REDTEAM;
  const S = PROOF.stats;
  const attacks = attackCountText(attackCount());
  return (
    <section className="sec pf-stats" aria-labelledby="stats-title">
      <div className="wrap">
        <h2 className="h2" id="stats-title">
          {PROOF.statsTitle}
        </h2>
        <LineStats
          label={PROOF.statsLabel}
          testId="proof-stats"
          good={{ label: S.time, value: formatMs(headline.latencyP50Ms), note: S.timeNote, sub: S.timeSub }}
          bad={{ value: percent(scamCatchRate()), note: S.caughtNote, sub: S.attacks(attacks) }}
        />
        <div className="pf-minor">
          <dl>
            <div>
              <dt>{S.unsafe}</dt>
              <dd className="num">{headline.unsafePays}</dd>
            </div>
            <div>
              <dt>{S.falsePositive}</dt>
              <dd className="num">{percent(headline.legitFalsePositiveRate)}</dd>
            </div>
          </dl>
          <p>{S.rowNote(attacks, cases.legit)}</p>
        </div>
      </div>
    </section>
  );
}

function FeedRow({ group, open, onToggle, feeBps }: { group: ProofGroup; open: boolean; onToggle: () => void; feeBps: number | null }) {
  const { row: p, count, total } = group;
  const id = useId();
  const verdict = verdictOf(p);
  return (
    <li className="pf-item" data-side={p.side} data-count={count} data-open={open}>
      <div className="pf-line">
        <span className="pf-fp">
          <Fingerprint id={p.call_id} side={p.side} />
        </span>
        <button type="button" className="pf-row" id={`${id}-row`} aria-expanded={open} aria-controls={`${id}-why`} onClick={onToggle}>
          <span className="pf-group">{p.group}</span>
          <span className="pf-what">
            {whatHappened(p)}
            {count > 1 && (
              <span className="pf-repeat num">
                <span aria-hidden="true"> {PROOF.repeat(count)}</span>
                <span className="sr-only">, {PROOF.repeatLabel(count)}</span>
              </span>
            )}
          </span>
          <span className="pf-amt num">{proofAmount(total)} USDC</span>
          <span className={`pf-verdict ${verdict === "paid" ? "is-paid" : "is-below"}`}>{PROOF.verdict[verdict]}</span>
          <svg className="pf-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      <div className="pf-detail" id={`${id}-why`} role="region" aria-labelledby={`${id}-row`} inert={!open}>
        <div className="pf-detail-in">
          <div className="pf-detail-body">
            <p className="pf-story">{explainProof(group, feeBps)}</p>
            <p className="pf-receipt">{PROOF.explain.receipt}</p>
            <p className="pf-meta">
              <time className="num" dateTime={p.created_at}>
                {when(p.created_at)}
              </time>
              <TxLink hash={p.tx} plain={false} />
            </p>
          </div>
        </div>
      </div>
    </li>
  );
}

function LatestProofs() {
  const [rows, setRows] = useState<ProofRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fees, setFees] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    setError(null);
    getProofs(30).then(
      (r) => setRows(r.proofs),
      (e: unknown) => setError(e),
    );
  }, [tick]);
  // Each group's fee, for "and 2% to the pool". Without it the explanation leaves the fee out.
  useEffect(() => {
    let live = true;
    getGroups().then(
      (r) => {
        if (!live) return;
        const m = new Map<string, number>();
        for (const g of r.groups) {
          m.set(g.budget_id, g.fee_bps);
          m.set(g.name, g.fee_bps);
        }
        setFees(m);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const groups = rows ? collapseProofs(rows, (p) => `${p.group}|${p.side}|${whatHappened(p)}`).slice(0, 12) : [];
  return (
    <section className="sec" aria-labelledby="latest-title">
      <div className="wrap">
        <h2 className="h2" id="latest-title">
          {PROOF.latestTitle}
        </h2>
        <p className="lede">{PROOF.latestLede}</p>
        {error !== null && <Problem error={error} onRetry={() => setTick((t) => t + 1)} />}
        {rows === null && error === null && (
          <div className="pf-skel" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        )}
        {rows && rows.length === 0 && <p className="empty">{PROOF.latestEmpty}</p>}
        {groups.length > 0 && (
          <div className="pf-feed">
            <div className="pf-head" aria-hidden="true">
              <span>{PROOF.col.fingerprint}</span>
              <span>{PROOF.col.group}</span>
              <span>{PROOF.col.what}</span>
              <span className="r">{PROOF.col.amount}</span>
              <span>{PROOF.col.side}</span>
            </div>
            <ul className="pf-list" data-testid="proofs" aria-label={PROOF.latestTitle}>
              {groups.map((g) => (
                <FeedRow
                  key={g.row.call_id}
                  group={g}
                  open={openId === g.row.call_id}
                  onToggle={() => setOpenId((o) => (o === g.row.call_id ? null : g.row.call_id))}
                  feeBps={fees.get(g.row.budget_id) ?? fees.get(g.row.group) ?? null}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** Why verify, three steps, and the way into the verify flow. Open layout: hairlines and type, no panels. */
function VerifyBusiness() {
  const V = PROOF.verify;
  return (
    <section className="sec pf-verify" aria-labelledby="verify-title" data-testid="verify-business">
      <div className="wrap">
        <p className="pf-eyebrow">{V.label}</p>
        <h2 className="h2" id="verify-title">
          {V.title}
        </h2>
        <h3 className="pf-h3">{V.whyTitle}</h3>
        <ul className="pf-why">
          {V.why.map(([name, line]) => (
            <li key={name}>
              <b>{name}</b>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <h3 className="pf-h3">{V.stepsTitle}</h3>
        <ol className="pf-vsteps">
          {V.steps.map(([name, line], i) => (
            <li key={name}>
              <span className="pf-vstep-n num" aria-hidden="true">
                {i + 1}
              </span>
              <b>{name}</b>
              <span>{line}</span>
            </li>
          ))}
        </ol>
        <a className="btn" href="#/verify">
          {V.cta}
        </a>
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
      <ProofStats />
      <VerifyBusiness />
    </main>
  );
}
