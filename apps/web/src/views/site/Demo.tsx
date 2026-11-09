/** Seven scenes, each calling the real /v1/demo endpoint and showing its real numbers. */
import { useEffect, useRef, useState } from "react";
import type { PayeeCheckRequest, PayeeCheckResult } from "@wardline/schemas";
import { runDemoScene, type BudgetView, type CallView, type ClaimView, type PoolView, type ReputationView, type SceneName } from "../../api/ai";
import { errorText } from "../../api/public";
import { callWords, modelName } from "../../ai/words";
import { DEMO, REP } from "../../brand";
import { feeText } from "../../components/TierBadge";
import { formatUsdc } from "../../format";
import { ResultCard } from "../../payee/ResultCard";
import { firstContact, onFile } from "../../redteam";

const SCENES = Object.keys(DEMO.scenes) as SceneName[];
const L = DEMO.labels;

/** Same first and last six hex characters as the real address, different in between. */
export function poisonedAddress(real: string): string {
  const hex = real.slice(2);
  const middle = [...hex.slice(6, -6)].map((c) => ((parseInt(c, 16) + 7) % 16).toString(16)).join("");
  return `0x${hex.slice(0, 6)}${middle}${hex.slice(-6)}`;
}

interface MutualSceneResult {
  stats: { total_pooled: string; yield_earned: string; groups_covered: number; proven_payments: number };
  deposit: { account: string; usdc: string; ward: string; price: string; tx: string };
  position: { value: string };
}
interface GroupResult {
  group: { name: string };
  proposal: { description: string; status: string; approvals: number; fund_tx: string | null };
  calls: { proof: string; call: CallView & { settlement_tx: string }; reply: string | null }[];
  batch: { member: string; proven: number; spent: string };
  budget: BudgetView;
  ward: { before: string; after: string; fees: string };
}
interface SwapResult {
  claimed: string;
  call: CallView;
}
interface LeakResult {
  bursts: { member: string; sent: number; paid: number; refused: number; reasons: string[] }[];
  spent: string;
  cap: string;
  refused: number;
}
interface InvoiceResult {
  proposal: { description: string; receiver: string; amount: string };
  payee: string;
  vendor: string;
  result: PayeeCheckResult;
}
interface PayoutResult {
  payouts: { claim: ClaimView; pool: PoolView }[];
  refill: { calls: number; spent: string; fees: string; ward_before: string; ward_after: string };
}
interface TierResult {
  before: ReputationView;
  after: ReputationView;
  first: { n: number; fee: string };
  last: { n: number; fee: string };
  calls: number;
}
type SceneResult = MutualSceneResult | GroupResult | SwapResult | LeakResult | InvoiceResult | PayoutResult | TierResult;

type Tone = "above" | "below" | "tier";
type Row = { k: string; v: string; tone?: "above" | "below" | "mono" | undefined };
interface Outcome {
  tone: Tone;
  verdict: string;
  rows: Row[];
}

const p4 = (scaled: string) => (Number(BigInt(scaled)) / 1e6).toFixed(4);
const p6 = (scaled: string) => (Number(BigInt(scaled)) / 1e6).toFixed(6);
const u4 = (atomic: string) => (Number(BigInt(atomic)) / 1e6).toFixed(4);

/** Each scene's verdict and rows, from its real result. */
function outcome(id: SceneName, raw: SceneResult): Outcome {
  switch (id) {
    case "mutual": {
      const r = raw as MutualSceneResult;
      return {
        tone: "above",
        verdict: DEMO.verdicts.mutual(formatUsdc(r.deposit.ward)),
        rows: [
          { k: L.pooled, v: `${formatUsdc(r.stats.total_pooled)} USDC` },
          { k: L.earned, v: `${formatUsdc(r.stats.yield_earned)} USDC` },
          { k: L.groups, v: String(r.stats.groups_covered) },
          { k: L.deposited, v: `${formatUsdc(r.deposit.usdc)} USDC from ${r.deposit.account}` },
          { k: L.atPrice, v: `${p4(r.deposit.price)} USDC` },
          { k: L.received, v: `${formatUsdc(r.deposit.ward)} WARD`, tone: "above" },
          { k: L.settlement, v: r.deposit.tx, tone: "mono" },
        ],
      };
    }
    case "group": {
      const r = raw as GroupResult;
      const proven = r.calls.filter((c) => c.proof === "verified").length + r.batch.proven;
      return {
        tone: "above",
        verdict: DEMO.verdicts.group(proven),
        rows: [
          { k: L.daoVote, v: `${r.proposal.status}, ${L.approvals(r.proposal.approvals)}` },
          { k: L.funded, v: `${formatUsdc(r.budget.deposit)} USDC` },
          ...r.calls.map((c) => ({ k: modelName(c.call.model_proven), v: `${u4(c.call.amount)} USDC, ${c.proof}`, tone: "above" as const })),
          { k: L.batch(r.batch.proven, r.batch.member), v: `${formatUsdc(r.batch.spent)} USDC` },
          { k: L.feesToWard, v: `${u4(r.ward.fees)} USDC` },
          { k: L.wardPrice, v: `${p6(r.ward.before)} to ${p6(r.ward.after)}`, tone: "above" },
        ],
      };
    }
    case "swap": {
      const r = raw as SwapResult;
      return {
        tone: "below",
        verdict: DEMO.verdicts.swap,
        rows: [
          { k: L.claimed, v: modelName(r.claimed) },
          { k: L.proven, v: modelName(r.call.model_proven) || L.noneProven, tone: "below" },
          { k: "Why", v: callWords(r.call.reason) },
          { k: L.paid, v: `${u4(r.call.amount)} USDC` },
          { k: L.refunded, v: `${u4(r.call.refund)} USDC` },
          { k: L.refund, v: r.call.release_tx ?? "", tone: "mono" },
        ],
      };
    }
    case "leak": {
      const r = raw as LeakResult;
      return {
        tone: "below",
        verdict: DEMO.verdicts.leak(formatUsdc(r.cap)),
        rows: [
          ...r.bursts.map((b) => ({ k: b.member, v: `${L.burst(b.paid, b.refused)} (${b.reasons.map(callWords).join(" ")})` })),
          { k: "Total", v: L.spentOf(formatUsdc(r.spent), formatUsdc(r.cap)) },
          { k: "Refused", v: L.refusedCount(r.refused), tone: "below" },
        ],
      };
    }
    case "invoice": {
      const r = raw as InvoiceResult;
      return {
        tone: "below",
        verdict: DEMO.verdicts.invoice,
        rows: [
          { k: "Proposal", v: r.proposal.description },
          { k: L.paid, v: `${formatUsdc(r.proposal.amount)} USDC to ${r.proposal.receiver}`, tone: "below" },
          { k: "Verdict", v: r.result.verdict, tone: r.result.verdict === "PAY" ? "above" : "below" },
        ],
      };
    }
    case "payout": {
      const r = raw as PayoutResult;
      return {
        tone: "below",
        verdict: DEMO.verdicts.payout,
        rows: [
          ...r.payouts.flatMap(({ claim, pool }, i) => [
            { k: `${L.payout(i + 1)}: ${formatUsdc(claim.amount)} USDC`, v: `${L.junior} ${formatUsdc(claim.paid_from_junior)}, ${L.senior.toLowerCase()} ${formatUsdc(claim.paid_from_senior)}` },
            { k: L.wardPrice, v: `${p4(claim.ward_price_before)} to ${p4(claim.ward_price_after)}`, tone: claim.ward_price_after !== claim.ward_price_before ? ("below" as const) : undefined },
            ...(i === 1 ? [{ k: L.stakeLeft, v: `${formatUsdc(pool.junior)} USDC` }] : []),
          ]),
          { k: L.refill, v: L.refillCalls(r.refill.calls, formatUsdc(r.refill.spent)) },
          { k: L.wardPrice, v: `${p4(r.refill.ward_before)} to ${p4(r.refill.ward_after)}`, tone: "above" },
        ],
      };
    }
    case "tier": {
      const r = raw as TierResult;
      return {
        tone: "tier",
        verdict: DEMO.verdicts.tier(REP.names[r.after.tier], feeText(r.after.fee_bps)),
        rows: [
          { k: L.tierBefore, v: `${REP.names[r.before.tier]}, ${feeText(r.before.fee_bps)} fee, ${formatUsdc(r.before.coverage_cap)} USDC coverage` },
          { k: L.tierAfter(r.calls), v: `${REP.names[r.after.tier]}, ${feeText(r.after.fee_bps)} fee, ${formatUsdc(r.after.coverage_cap)} USDC coverage` },
          { k: L.feeOnCall(r.first.n), v: `${u4(r.first.fee)} USDC` },
          { k: L.feeOnCall(r.last.n), v: `${u4(r.last.fee)} USDC`, tone: "above" },
        ],
      };
    }
  }
}

type Run = null | { state: "busy" } | { state: "done"; result: SceneResult } | { state: "error"; message: string };

function Stage({ id, run, onRun, onNext, hasNext }: { id: SceneName; run: Run; onRun: () => void; onNext: () => void; hasNext: boolean }) {
  const scene = DEMO.scenes[id];
  const n = SCENES.indexOf(id) + 1;
  const out = run?.state === "done" ? outcome(id, run.result) : null;
  return (
    <div className="stage" data-testid="stage">
      <div className="stage-head">
        <span className="stage-n num">Scene {n} of 7</span>
        <h2>{scene.name}</h2>
        <p>{scene.line}</p>
      </div>
      <ol className="stage-setup">
        {scene.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {run?.state !== "busy" && (
        <button type="button" className="btn" onClick={onRun} data-run={id}>
          {run ? DEMO.replay : DEMO.run}
        </button>
      )}
      <div aria-live="polite">
        {run?.state === "busy" && (
          <p className="stage-busy" role="status">
            <span className="spinner" aria-hidden="true" />
            {DEMO.doing[id]}
          </p>
        )}
        {run?.state === "error" && (
          <p className="notice" role="alert">
            {run.message}
          </p>
        )}
        {out && (
          <div className="stage-result" data-outcome={out.tone} data-scene-result={id}>
            <p className={`verdict v-${out.tone}`}>{out.verdict}</p>
            <dl className="result-rows">
              {out.rows.map((r, i) => (
                <div key={`${r.k}-${i}`} className="rr" style={{ animationDelay: `${0.12 * i}s` }}>
                  <dt>{r.k}</dt>
                  <dd className={r.tone === "mono" ? "acct" : r.tone ? `t-${r.tone} num` : "num"}>{r.v}</dd>
                </div>
              ))}
            </dl>
            {id === "invoice" && run?.state === "done" && (
              <ResultCard
                result={{ ...(run.result as InvoiceResult).result, receipt: null }}
                request={{ payee: (run.result as InvoiceResult).payee, vendor: { domain: (run.result as InvoiceResult).vendor } } as PayeeCheckRequest}
              />
            )}
            {hasNext && (
              <button type="button" className="btn ghost" onClick={onNext}>
                {DEMO.next}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DotRow({ label, paid, of }: { label: string; paid: number; of: number }) {
  return (
    <div className="cmp-row">
      <div className="cmp-label">{label}</div>
      <div className="cmp-dots" role="img" aria-label={`${paid} of ${of} ${DEMO.scamsThrough}`}>
        {Array.from({ length: of }, (_, i) => (
          <i key={i} className={i < paid ? "paid" : ""} />
        ))}
      </div>
      <div className="cmp-value num">
        {paid} of {of} <small>{DEMO.scamsThrough}</small>
      </div>
    </div>
  );
}

export function Comparison() {
  const first = firstContact();
  const known = onFile();
  if (!first) return null;
  return (
    <section className="sec" aria-labelledby="cmp-title">
      <div className="wrap">
        <h2 className="h2 cmp-title" id="cmp-title">
          {DEMO.comparisonTitle}
        </h2>
        <div className="cmp">
          <DotRow label={DEMO.agentAlone} paid={first.agentAlone.unsafePayees} of={first.attacks} />
          <DotRow label={DEMO.withWardline} paid={first.agentWithWardline.unsafePayees} of={first.attacks} />
        </div>
        <p className="fine engine-note">
          {first.cases} cases, {first.attacks} of them scams, through the invoice agent on {first.model}. Both paid {first.agentWithWardline.legitPaid} of {first.legitRecurring}{" "}
          legitimate invoices.
          {known && ` ${DEMO.onFileNote} ${known.agentAlone.unsafePayees} and ${known.agentWithWardline.unsafePayees} scams paid.`}
        </p>
      </div>
    </section>
  );
}

export function Demo() {
  const [current, setCurrent] = useState<SceneName>("mutual");
  const [runs, setRuns] = useState<Partial<Record<SceneName, Run>>>({});
  const live = useRef(true);
  useEffect(() => {
    // StrictMode runs effects twice in development, so set it on every mount.
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const play = (id: SceneName) => {
    setRuns((r) => ({ ...r, [id]: { state: "busy" } }));
    runDemoScene<SceneResult>(id).then(
      (result) => live.current && setRuns((r) => ({ ...r, [id]: { state: "done", result } })),
      (error: unknown) => live.current && setRuns((r) => ({ ...r, [id]: { state: "error", message: errorText(error) } })),
    );
  };
  const idx = SCENES.indexOf(current);

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <h1 className="h1">{DEMO.title}</h1>
          <p className="lede">{DEMO.lede}</p>
        </div>
      </section>
      <section className="sec tight">
        <div className="wrap demo">
          <ol className="scenes">
            {SCENES.map((id, i) => (
              <li key={id} className={id === current ? "scene on" : "scene"}>
                <button type="button" onClick={() => setCurrent(id)} aria-current={id === current ? "step" : undefined} data-scene={id}>
                  <span className="scene-n num">{i + 1}</span>
                  <span className="scene-t">
                    <b>{DEMO.scenes[id].name}</b>
                    <span>{DEMO.scenes[id].line}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <Stage id={current} run={runs[current] ?? null} onRun={() => play(current)} onNext={() => setCurrent(SCENES[idx + 1]!)} hasNext={idx < SCENES.length - 1} />
        </div>
      </section>
      <Comparison />
    </main>
  );
}
