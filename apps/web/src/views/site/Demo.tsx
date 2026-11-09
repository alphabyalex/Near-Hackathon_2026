import { useEffect, useRef, useState } from "react";
import type { PayeeCheckRequest, PayeeCheckResult } from "@wardline/schemas";
import { runDemoScene, type BudgetView, type CallView, type ClaimView, type PoolView, type ReputationView, type SceneName } from "../../api/ai";
import { feeText, TierBadge } from "../../components/TierBadge";
import { errorText } from "../../api/public";
import { callWords, modelName } from "../../ai/words";
import { DEMO } from "../../brand";
import { formatUsdc } from "../../format";
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

interface MutualSceneResult {
  stats: { total_pooled: string; yield_earned: string; groups_covered: number; proven_payments: number };
  deposit: { account: string; usdc: string; ward: string; price: string; tx: string };
  position: { value: string };
}
interface GroupResult {
  group: { name: string; owner: string };
  proposal: { id: number; description: string; status: string; approvals: number; fund_tx: string | null };
  calls: { status: number; proof: string; call: CallView & { settlement_tx: string }; reply: string | null }[];
  batch: { member: string; sent: number; proven: number; spent: string };
  budget: BudgetView;
  ward: { before: string; after: string; fees: string };
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
  proposal: { id: number; description: string; receiver: string; amount: string; dao: string };
  payee: string;
  vendor: string;
  result: PayeeCheckResult;
}
interface PayoutResult {
  before: PoolView;
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

function Row({ k, v, cls }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className={`out-row${cls ? ` ${cls}` : ""}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

const usd4 = (atomic: string): string => (Number(BigInt(atomic)) / 1e6).toFixed(4);
const wardPrice6 = (scaled: string): string => (Number(BigInt(scaled)) / 1e6).toFixed(6);

function MutualSceneOut({ r }: { r: MutualSceneResult }) {
  return (
    <div className="scene-out" data-outcome="deposited">
      <div className="out-card">
        <Row k={L.pooled} v={`${formatUsdc(r.stats.total_pooled)} USDC`} />
        <Row k={L.earned} v={`${formatUsdc(r.stats.yield_earned)} USDC`} />
        <Row k={L.groups} v={String(r.stats.groups_covered)} />
        <Row k={L.provenPayments} v={r.stats.proven_payments.toLocaleString("en-US")} />
      </div>
      <div className="out-card">
        <div className="out-head">
          <span className="badge ok">WARD</span>
          <b className="mono">{r.deposit.account}</b>
        </div>
        <Row k={L.deposited} v={`${formatUsdc(r.deposit.usdc)} USDC`} />
        <Row k={L.atPrice} v={`${wardPrice(r.deposit.price)} USDC`} />
        <Row k={L.received} v={`${formatUsdc(r.deposit.ward)} WARD`} />
        <Row k={L.worth} v={`${formatUsdc(r.position.value)} USDC`} />
        <Row k={L.settlement} v={<span className="mono">{r.deposit.tx}</span>} />
      </div>
    </div>
  );
}

function GroupOut({ r }: { r: GroupResult }) {
  return (
    <div className="scene-out" data-outcome="verified">
      <div className="out-card">
        <div className="out-head">
          <span className="badge ok">{r.proposal.status}</span>
          <b>{r.group.name}</b>
        </div>
        <Row k={L.daoVote} v={`${r.proposal.description} (${L.approvals(r.proposal.approvals)})`} />
        <Row k={L.funded} v={<span className="mono">{r.proposal.fund_tx}</span>} />
      </div>
      {r.calls.map((c) => (
        <div className="out-card" key={c.call.call_id}>
          <div className="out-head">
            <span className="badge ok">{c.proof}</span>
            <b>{modelName(c.call.model_proven)}</b>
          </div>
          {c.reply && <p className="out-reply">{c.reply}</p>}
          <Row k={L.paid} v={`${usd4(c.call.amount)} USDC`} />
          <Row k={L.settlement} v={<span className="mono">{c.call.settlement_tx}</span>} />
        </div>
      ))}
      <div className="out-card" data-testid="ward-tick">
        <Row k={L.batch(r.batch.proven, r.batch.member)} v={`${formatUsdc(r.batch.spent)} USDC`} />
        <Row k={L.feesToWard} v={`${usd4(r.ward.fees)} USDC`} />
        <Row k={L.wardPrice} v={`${wardPrice6(r.ward.before)} to ${wardPrice6(r.ward.after)} USDC`} cls="up" />
      </div>
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
        <Row k={L.paid} v={`${formatUsdc(r.call.amount)} USDC`} />
        <Row k={L.refunded} v={`${formatUsdc(r.call.refund)} USDC`} />
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
          <b className="num">{L.spentOf(formatUsdc(r.spent), formatUsdc(r.cap))}</b>
        </div>
        {r.bursts.map((b) => (
          <Row key={b.member} k={b.member} v={`${L.burst(b.paid, b.refused)} (${b.reasons.map(callWords).join(" ")})`} />
        ))}
        <p className="out-foot">{L.refusedCount(r.refused)}</p>
      </div>
    </div>
  );
}

const wardPrice = (scaled: string): string => (Number(BigInt(scaled)) / 1e6).toFixed(4);

function PayoutOut({ r }: { r: PayoutResult }) {
  return (
    <div className="scene-out" data-outcome={r.payouts.every((p) => p.claim.status === "paid") ? "paid" : "pending"}>
      {r.payouts.map(({ claim, pool }, i) => {
        const dipped = claim.ward_price_after !== claim.ward_price_before;
        return (
          <div className="out-card" key={claim.claim_id} data-payout={i + 1}>
            <div className="out-head">
              <span className="badge ok">{claim.status}</span>
              <b className="num">
                {L.payout(i + 1)}: {formatUsdc(claim.amount)} USDC
              </b>
            </div>
            <Row k={L.junior} v={`${formatUsdc(claim.paid_from_junior)} USDC`} />
            <Row k={L.senior} v={`${formatUsdc(claim.paid_from_senior)} USDC`} />
            <Row k={L.stakeLeft} v={`${formatUsdc(pool.junior)} USDC`} />
            <Row k={L.wardPrice} v={`${wardPrice(claim.ward_price_before)} to ${wardPrice(claim.ward_price_after)} USDC`} cls={dipped ? "mismatch" : ""} />
            <Row k={L.settlement} v={<span className="mono">{claim.tx}</span>} />
          </div>
        );
      })}
      <div className="out-card" data-testid="refill">
        <div className="out-head">
          <b>{L.refill}</b>
        </div>
        <Row k={L.refillCalls(r.refill.calls, formatUsdc(r.refill.spent))} v={`${usd4(r.refill.fees)} USDC`} />
        <Row k={L.wardPrice} v={`${wardPrice(r.refill.ward_before)} to ${wardPrice(r.refill.ward_after)} USDC`} cls="up" />
      </div>
    </div>
  );
}

function TierOut({ r }: { r: TierResult }) {
  const line = (x: ReputationView) => `${feeText(x.fee_bps)} fee, ${formatUsdc(x.coverage_cap)} USDC coverage, ${x.proven_calls} proven calls`;
  return (
    <div className="scene-out" data-outcome={r.after.tier}>
      <div className="out-card">
        <div className="out-head">
          <TierBadge tier={r.before.tier} />
          <b>{L.tierBefore}</b>
        </div>
        <p className="out-foot">{line(r.before)}</p>
      </div>
      <div className="out-card">
        <div className="out-head">
          <TierBadge tier={r.after.tier} />
          <b>{L.tierAfter(r.calls)}</b>
        </div>
        <p className="out-foot">{line(r.after)}</p>
        <Row k={L.feeOnCall(r.first.n)} v={`${usd4(r.first.fee)} USDC`} />
        <Row k={L.feeOnCall(r.last.n)} v={`${usd4(r.last.fee)} USDC`} cls="up" />
      </div>
    </div>
  );
}

function Outcome({ id, r }: { id: SceneName; r: SceneResult }) {
  if (id === "mutual") return <MutualSceneOut r={r as MutualSceneResult} />;
  if (id === "group") return <GroupOut r={r as GroupResult} />;
  if (id === "swap") return <SwapOut r={r as SwapResult} />;
  if (id === "leak") return <LeakOut r={r as LeakResult} />;
  if (id === "payout") return <PayoutOut r={r as PayoutResult} />;
  if (id === "tier") return <TierOut r={r as TierResult} />;
  const inv = r as InvoiceResult;
  const request: PayeeCheckRequest = { payee: inv.payee, vendor: { domain: inv.vendor } };
  return (
    <div className="scene-out" data-outcome="flagged">
      <div className="out-card refused">
        <div className="out-head">
          <span className="badge bad">{L.flagged}</span>
          <b>{inv.proposal.description}</b>
        </div>
        <Row k={L.paid} v={`${formatUsdc(inv.proposal.amount)} USDC to ${inv.proposal.receiver}`} cls="mismatch" />
      </div>
      <ResultCard result={{ ...inv.result, receipt: null }} request={request} />
    </div>
  );
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
  const [current, setCurrent] = useState<SceneName>("mutual");
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
