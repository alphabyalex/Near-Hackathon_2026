/** Home (M): the agent alone against the agent with Wardline, on the same first-contact scams, laid out on the line. */
import { DEMO } from "../../brand";
import { LineStats } from "../../components/LineStats";
import { firstContact } from "../../redteam";

/** A row of 20 scam invoices: red for paid, grey for not paid, violet rings for stopped by Wardline. */
function Dots({ paid, of, stopped, label }: { paid: number; of: number; stopped: boolean; label: string }) {
  return (
    <span className="cmp-dots" role="img" aria-label={label}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < paid ? "paid" : stopped ? "stopped" : ""} />
      ))}
    </span>
  );
}

/** Home (M): the agent alone against the agent with Wardline, on the same 20 first-contact scams. */
export function Comparison() {
  const first = firstContact();
  if (!first) return null;
  const of = first.attacks;
  const alone = first.agentAlone.unsafePayees;
  const withUs = first.agentWithWardline.unsafePayees;
  return (
    <section className="sec cmp-sec" aria-labelledby="cmp-title">
      <div className="wrap">
        <h2 className="h2 cmp-title" id="cmp-title">
          {DEMO.comparisonTitle(alone, withUs, of)}
        </h2>
        <p className="lede">{DEMO.comparisonSetup(of)}</p>
        <LineStats
          label={DEMO.comparisonLabel(of)}
          testId="comparison"
          good={{ label: DEMO.withWardline, value: withUs, note: DEMO.scamsThrough, sub: <Dots paid={withUs} of={of} stopped label={DEMO.dotsWith(withUs, of)} /> }}
          bad={{ label: DEMO.agentAlone, value: alone, note: DEMO.scamsThrough, sub: <Dots paid={alone} of={of} stopped={false} label={DEMO.dotsAlone(alone, of)} /> }}
        />
      </div>
    </section>
  );
}

