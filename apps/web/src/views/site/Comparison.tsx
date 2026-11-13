/** Home: the same 20 first-contact scams, paid by the agent alone and by the agent with Wardline, as two aligned rows of dots. */
import { useEffect, useState } from "react";
import { DEMO } from "../../brand";
import { firstContact } from "../../redteam";
import { useInView } from "../../v2/motion";

/** Milliseconds between one dot and the next, and when the second row starts after the first. */
const STEP_MS = 55;
const ROW_GAP_MS = 500;

/** One dot per scam invoice: red when it was paid, grey when it was not, a violet ring when Wardline stopped it. */
function Dots({ paid, of, stopped, label, after }: { paid: number; of: number; stopped: boolean; label: string; after: number }) {
  return (
    <span className="cmp2-dots" role="img" aria-label={label}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < paid ? "paid" : stopped ? "stopped" : ""} style={{ ["--at" as string]: `${after + i * STEP_MS}ms` }} />
      ))}
    </span>
  );
}

/** The number counts up as each red dot lands, so the 5 is something you watch happen. Finished at once when motion is off. */
function useCount(target: number, seen: boolean, after: number): number {
  const [n, setN] = useState(() => (seen ? target : 0));
  useEffect(() => {
    if (!seen) return;
    const timers = Array.from({ length: target }, (_, k) => window.setTimeout(() => setN(k + 1), after + k * STEP_MS + 120));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [seen, target, after]);
  return seen ? n : 0;
}

function Row({ kind, label, value, seen, after, dots }: { kind: "alone" | "with"; label: string; value: number; seen: boolean; after: number; dots: React.ReactNode }) {
  const shown = useCount(value, seen, after);
  return (
    <div className={`cmp2-row ${kind}`}>
      <div className="cmp2-key">
        <p className="cmp2-label">{label}</p>
        <p className="cmp2-num">{shown}</p>
        <p className="cmp2-note">{DEMO.scamsThrough}</p>
      </div>
      {dots}
    </div>
  );
}

export function Comparison() {
  const [ref, seen] = useInView<HTMLDivElement>(0.35);
  const first = firstContact();
  if (!first) return null;
  const of = first.attacks;
  const alone = first.agentAlone.unsafePayees;
  const withUs = first.agentWithWardline.unsafePayees;
  const second = of * STEP_MS + ROW_GAP_MS;
  return (
    <section className="sec cmp-sec" aria-labelledby="cmp-title">
      <div className="wrap">
        <h2 className="h2" id="cmp-title">
          {DEMO.comparisonTitle(of)}
        </h2>
        <p className="lede">{DEMO.comparisonSetup(alone, withUs, of)}</p>
        <div className="cmp2" role="group" aria-label={DEMO.comparisonLabel(of)} data-testid="comparison" ref={ref} data-inview={seen || undefined}>
          <Row kind="alone" label={DEMO.agentAlone} value={alone} seen={seen} after={200} dots={<Dots paid={alone} of={of} stopped={false} label={DEMO.dotsAlone(alone, of)} after={200} />} />
          <Row kind="with" label={DEMO.withWardline} value={withUs} seen={seen} after={second} dots={<Dots paid={withUs} of={of} stopped label={DEMO.dotsWith(withUs, of)} after={second} />} />
        </div>
        <ul className="cmp2-key-list" aria-hidden="true">
          <li>
            <i className="paid" />
            {DEMO.legendPaid}
          </li>
          <li>
            <i />
            {DEMO.legendNot}
          </li>
          <li>
            <i className="stopped" />
            {DEMO.legendStopped}
          </li>
        </ul>
      </div>
    </section>
  );
}
