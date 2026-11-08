import { useEffect, useRef, useState } from "react";
import type { PayeeCheckRequest, PayeeCheckResult } from "@wardline/schemas";
import { WardlineBlockedError, seedEvmAddress, type PayeeRequest, type PayeeResult } from "@wardline/sdk";
import { withWardline } from "@wardline/x402-guard";
import { errorText, wardline } from "../../api/public";
import { DEMO } from "../../brand";
import { ResultCard } from "../../payee/ResultCard";
import { firstContact, onFile } from "../../redteam";

type SceneId = keyof typeof DEMO.scenes;
const SCENES = Object.keys(DEMO.scenes) as SceneId[];
const STEP_MS = 900;

/** Same first and last six hex characters as the real address, different in between. */
export function poisonedAddress(real: string): string {
  const hex = real.slice(2);
  const middle = [...hex.slice(6, -6)].map((c) => ((parseInt(c, 16) + 7) % 16).toString(16)).join("");
  return `0x${hex.slice(0, 6)}${middle}${hex.slice(-6)}`;
}

const ATTACKER_PAY_TO = "0x7a3e9c41d2b85f60e1a4c3b2d9f0e8a7c6b5d4e3";

/** A paid endpoint that answers 402 with a swapped payTo, run in the page. */
function swappedMerchant(): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        x402Version: 2,
        error: "PAYMENT_REQUIRED",
        resource: { url: "https://fernhill.example/v1/usage-report", description: "Usage report", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "eip155:84532", amount: "250000", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", payTo: ATTACKER_PAY_TO }],
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
}

/** Runs the scene's real call. The x402 scene goes through the real guard, which calls the API. */
async function runScene(id: SceneId): Promise<{ result: PayeeResult; request: PayeeRequest; guard?: string }> {
  if (id === "resolve") {
    const request = { domain: "northwind.example", chain: "near:testnet" };
    return { result: await wardline.resolve(request), request };
  }
  if (id === "x402") {
    let seen: { result: PayeeCheckResult; request: PayeeCheckRequest } | null = null;
    const guarded = withWardline(swappedMerchant(), {
      wardline: {
        check: async (request) => {
          const result = await wardline.check(request);
          seen = { result, request };
          return result;
        },
      },
    });
    let guard = "The guard let the payment through.";
    try {
      await guarded("https://fernhill.example/v1/usage-report");
    } catch (error) {
      guard = error instanceof WardlineBlockedError ? "Stopped by the x402 guard before anything was signed." : errorText(error);
    }
    const checked = seen as { result: PayeeCheckResult; request: PayeeCheckRequest } | null;
    if (!checked) throw new Error(guard);
    return { ...checked, guard };
  }
  const request: PayeeCheckRequest =
    id === "bank"
      ? { payee: "near:testnet:northw1nd.testnet", vendor: { domain: "northwind.example", name: "Northwind Trading" }, source: "invoice" }
      : { payee: `eip155:84532:${poisonedAddress(seedEvmAddress("larkspur.example"))}`, vendor: { domain: "larkspur.example" }, source: "manual" };
  return { result: await wardline.check(request), request };
}

const reducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

type Run = { shown: number; outcome: null | { state: "busy" } | { state: "done"; result: PayeeResult; request: PayeeRequest; guard?: string } | { state: "error"; message: string } };

function Stage({ id, run }: { id: SceneId; run: Run }) {
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
      {run.outcome?.state === "busy" && <p className="loading">Asking the API</p>}
      {run.outcome?.state === "error" && (
        <p className="notice" role="alert">
          {run.outcome.message}
        </p>
      )}
      {run.outcome?.state === "done" && (
        <>
          {run.outcome.guard && <p className="guard-line">{run.outcome.guard}</p>}
          <ResultCard result={run.outcome.result} request={run.outcome.request} />
        </>
      )}
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
  const [current, setCurrent] = useState<SceneId>("bank");
  const [run, setRun] = useState<Run>({ shown: 0, outcome: null });
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const play = (id: SceneId) => {
    clear();
    setCurrent(id);
    const steps = DEMO.scenes[id].steps.length;
    const call = () => {
      setRun({ shown: steps, outcome: { state: "busy" } });
      runScene(id).then(
        (done) => setRun({ shown: steps, outcome: { state: "done", ...done } }),
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
            {SCENES.map((id) => (
              <div role="listitem" key={id} className={`scene${id === current ? " on" : ""}`}>
                <button type="button" onClick={() => play(id)} aria-pressed={id === current && run.shown > 0} data-scene={id}>
                  <b>{DEMO.scenes[id].name}</b>
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
