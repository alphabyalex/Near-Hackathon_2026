import { useEffect, useRef, useState } from "react";
import type { PayeeCheckRequest, PayeeCheckResult } from "@wardline/schemas";
import { runDemoScene, type BudgetView, type CallView, type ClaimView, type PoolView, type SceneName } from "../../api/ai";
import { errorText } from "../../api/public";
import { callWords, modelName } from "../../ai/words";
import { DEMO } from "../../brand";
import { formatWusd } from "../../format";
import { ResultCard } from "../../payee/ResultCard";
import { firstContact, onFile } from "../../redteam";

const SCENES = Object.keys(DEMO.scenes) as SceneName[];
const STEP_MS = 900;
const L = DEMO.labels;

/** Same first and last six hex characters as the real address, different in between. */
export function poisonedAddress(real: string): string {
  const hex = real.slice(2);
  const middle = [...hex.slice(6, -6)].map((c) => ((parseInt(c, 16) + 7) % 16).toString(16)).join("");
  return `0x${hex.slice(0, 6)}${middle}${hex.slice(-6)}`;
}

interface PluginResult {
  calls: { status: number; proof: string; call: CallView & { settlement_tx: string }; reply: string | null }[];
  budget: BudgetView;
}
interface SwapResult {
  claimed: string;
  status: number;
  proof: string;
  error: { code: string; message: string } | null;
  call: CallView;
}
interface LeakResult {
  bursts: { member: string; sent: number; paid: number; refused: number; reasons: string[] }[];
  spent: string;
  cap: string;
  refused: number;
}
interface InvoiceResult {
  payee: string;
  vendor: string;
  result: PayeeCheckResult;
}
interface MutualResult {
  before: PoolView;
  after: PoolView;
  claim: ClaimView;
}
type SceneResult = PluginResult | SwapResult | LeakResult | InvoiceResult | MutualResult;

function Row({ k, v, cls }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className={`out-row${cls ? ` ${cls}` : ""}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function PluginOut({ r }: { r: PluginResult }) {
  return (
    <div className="scene-out" data-outcome="verified">
      {r.calls.map((c) => (
        <div className="out-card" key={c.call.call_id}>
          <div className="out-head">
            <span className="badge ok">{c.proof}</span>
            <b>{modelName(c.call.model_proven)}</b>
          </div>
          {c.reply && <p className="out-reply">{c.reply}</p>}
          <Row k={L.paid} v={`${formatWusd(c.call.amount)} WUSD`} />
          <Row k={L.refunded} v={`${formatWusd(c.call.refund)} WUSD`} />
          <Row k={L.settlement} v={<span className="mono">{c.call.settlement_tx}</span>} />
        </div>
      ))}
    </div>
  );
}

function SwapOut({ r }: { r: SwapResult }) {
  return (
    <div className="scene-out" data-outcome={r.proof}>
      <div className="out-card refused">
        <div className="out-head">
          <span className="badge bad">{r.proof}</span>
          <b>{callWords(r.call.reason)}</b>
        </div>
        <Row k={L.claimed} v={modelName(r.claimed)} />
        <Row k={L.proven} v={modelName(r.call.model_proven) || L.noneProven} cls="mismatch" />
        <Row k={L.paid} v={`${formatWusd(r.call.amount)} WUSD`} />
        <Row k={L.refunded} v={`${formatWusd(r.call.refund)} WUSD`} />
        <Row k={L.refund} v={<span className="mono">{r.call.release_tx}</span>} />
      </div>
    </div>
  );
}

function LeakOut({ r }: { r: LeakResult }) {
  return (
    <div className="scene-out" data-outcome="capped">
      <div className="out-card">
        <div className="out-head">
          <b className="num">{L.spentOf(formatWusd(r.spent), formatWusd(r.cap))}</b>
        </div>
        {r.bursts.map((b) => (
          <Row key={b.member} k={b.member} v={`${L.burst(b.paid, b.refused)} (${b.reasons.map(callWords).join(" ")})`} />
        ))}
        <p className="out-foot">{L.refusedCount(r.refused)}</p>
      </div>
    </div>
  );
}

function MutualOut({ r }: { r: MutualResult }) {
  return (
    <div className="scene-out" data-outcome={r.claim.status}>
      <div className="out-card">
        <div className="out-head">
          <span className="badge ok">{r.claim.status}</span>
          <b className="num">
            {L.claim} {formatWusd(r.claim.amount)} WUSD
          </b>
        </div>
        <Row k={`${L.junior}: ${L.before} / ${L.after}`} v={`${formatWusd(r.before.junior)} / ${formatWusd(r.after.junior)}`} />
        <Row k={`${L.senior}: ${L.before} / ${L.after}`} v={`${formatWusd(r.before.senior)} / ${formatWusd(r.after.senior)}`} />
        <Row k={L.settlement} v={<span className="mono">{r.claim.tx}</span>} />
      </div>
    </div>
  );
}

function Outcome({ id, r }: { id: SceneName; r: SceneResult }) {
  if (id === "plugin") return <PluginOut r={r as PluginResult} />;
  if (id === "swap") return <SwapOut r={r as SwapResult} />;
  if (id === "leak") return <LeakOut r={r as LeakResult} />;
  if (id === "mutual") return <MutualOut r={r as MutualResult} />;
  const inv = r as InvoiceResult;
  const request: PayeeCheckRequest = { payee: inv.payee, vendor: { domain: inv.vendor } };
  return <ResultCard result={{ ...inv.result, receipt: null }} request={request} />;
}

const reducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

type Run = { shown: number; outcome: null | { state: "busy" } | { state: "done"; result: SceneResult } | { state: "error"; message: string } };

function Stage({ id, run }: { id: SceneName; run: Run }) {
  const scene = DEMO.scenes[id];
  return (
    <div className="stage" aria-live="polite">
      <ol className="steps">
        {scene.steps.map((step, i) => (
          <li key={step} className={i < run.shown ? "on" : ""}>
            <span className="tick" aria-hidden="true" />
            {step}
          </li>
        ))}
      </ol>
      {run.outcome?.state === "busy" && <p className="loading">{DEMO.running}</p>}
      {run.outcome?.state === "error" && (
        <p className="notice" role="alert">
          {run.outcome.message}
        </p>
      )}
      {run.outcome?.state === "done" && <Outcome id={id} r={run.outcome.result} />}
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
        <span className="label">{DEMO.comparisonLabel}</span>
        <h2 className="h2 cmp-title" id="cmp-title">
          {DEMO.comparisonTitle}
        </h2>
        <div className="cmp">
          <DotRow label={DEMO.agentAlone} paid={first.agentAlone.unsafePayees} of={first.attacks} />
          <DotRow label={DEMO.withWardline} paid={first.agentWithWardline.unsafePayees} of={first.attacks} />
        </div>
        <p className="engine-note">
          {first.cases} cases, {first.attacks} of them scams, through the invoice agent on {first.model}. Both paid {first.agentWithWardline.legitPaid} of {first.legitRecurring}{" "}
          legitimate invoices.
          {known && ` ${DEMO.onFileNote} ${known.agentAlone.unsafePayees} and ${known.agentWithWardline.unsafePayees} scams paid.`}
        </p>
      </div>
    </section>
  );
}

export function Demo() {
  const [current, setCurrent] = useState<SceneName>("plugin");
  const [run, setRun] = useState<Run>({ shown: 0, outcome: null });
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const play = (id: SceneName) => {
    clear();
    setCurrent(id);
    const steps = DEMO.scenes[id].steps.length;
    const call = () => {
      setRun({ shown: steps, outcome: { state: "busy" } });
      runDemoScene<SceneResult>(id).then(
        (result) => setRun({ shown: steps, outcome: { state: "done", result } }),
        (error: unknown) => setRun({ shown: steps, outcome: { state: "error", message: errorText(error) } }),
      );
    };
    if (reducedMotion()) {
      call();
      return;
    }
    setRun({ shown: 0, outcome: null });
    for (let i = 1; i <= steps; i++) timers.current.push(window.setTimeout(() => setRun({ shown: i, outcome: null }), i * STEP_MS));
    timers.current.push(window.setTimeout(call, (steps + 0.6) * STEP_MS));
  };

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <span className="label">{DEMO.label}</span>
          <h1 className="h2">{DEMO.title}</h1>
          <p className="lede ink">{DEMO.lede}</p>
        </div>
      </section>
      <section className="sec tight">
        <div className="wrap demo">
          <div className="scenes" role="list">
            {SCENES.map((id, i) => (
              <div role="listitem" key={id} className={`scene${id === current ? " on" : ""}`}>
                <button type="button" onClick={() => play(id)} aria-pressed={id === current && run.shown > 0} data-scene={id}>
                  <b>
                    <span className="scene-n num">{i + 1}</span> {DEMO.scenes[id].name}
                  </b>
                  <span>{DEMO.scenes[id].line}</span>
                  <em>{id === current && run.shown > 0 ? DEMO.replay : DEMO.run}</em>
                </button>
              </div>
            ))}
          </div>
          <Stage id={current} run={run} />
        </div>
      </section>
      <Comparison />
    </main>
  );
}
