/** Home: the same 20 first-contact scams, paid by the agent alone and by the agent with Wardline, as two aligned rows of dots. */
import { DEMO } from "../../brand";
import { firstContact } from "../../redteam";

/** One dot per scam invoice: red when it was paid, grey when it was not, a violet ring when Wardline stopped it. */
function Dots({ paid, of, stopped, label }: { paid: number; of: number; stopped: boolean; label: string }) {
  return (
    <span className="cmp2-dots" role="img" aria-label={label}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < paid ? "paid" : stopped ? "stopped" : ""} />
      ))}
    </span>
  );
}

function Row({ kind, label, value, dots }: { kind: "alone" | "with"; label: string; value: number; dots: React.ReactNode }) {
  return (
    <div className={`cmp2-row ${kind}`}>
      <div className="cmp2-key">
        <p className="cmp2-label">{label}</p>
        <p className="cmp2-num">{value}</p>
        <p className="cmp2-note">{DEMO.scamsThrough}</p>
      </div>
      {dots}
    </div>
  );
}

export function Comparison() {
  const first = firstContact();
  if (!first) return null;
  const of = first.attacks;
  const alone = first.agentAlone.unsafePayees;
  const withUs = first.agentWithWardline.unsafePayees;
  return (
    <section className="sec cmp-sec" aria-labelledby="cmp-title">
      <div className="wrap">
        <h2 className="h2" id="cmp-title">
          {DEMO.comparisonTitle(of)}
        </h2>
        <p className="lede">{DEMO.comparisonSetup(alone, withUs, of)}</p>
        <div className="cmp2" role="group" aria-label={DEMO.comparisonLabel(of)} data-testid="comparison">
          <Row kind="alone" label={DEMO.agentAlone} value={alone} dots={<Dots paid={alone} of={of} stopped={false} label={DEMO.dotsAlone(alone, of)} />} />
          <Row kind="with" label={DEMO.withWardline} value={withUs} dots={<Dots paid={withUs} of={of} stopped label={DEMO.dotsWith(withUs, of)} />} />
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
