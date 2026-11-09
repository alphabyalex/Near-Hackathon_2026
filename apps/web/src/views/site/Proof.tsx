/** The proof engine: why the Mutual's yield is safe. What used to be the home page. */
import { PROOF } from "../../brand";
import { Button } from "../../components/Button";
import { TextLink } from "../../components/TextLink";
import { engineLabel, percent, REDTEAM } from "../../redteam";

export function ResultsStrip() {
  const { headline, cases, engine } = REDTEAM;
  const cells = [
    ["Attacks stopped", percent(headline.attackCatchRate), `${cases.attacks} written, ${cases.adversarial} model-invented`],
    ["Unsafe payments", String(headline.unsafePays), "PAY on a scam payee"],
    ["False positives", percent(headline.legitFalsePositiveRate), `${cases.legit} legitimate invoices`],
    ["Check latency", `${headline.latencyP50Ms} ms`, `p50 in process, p95 ${headline.latencyP95Ms} ms`],
  ] as const;
  return (
    <section className="sec tight" aria-labelledby="results-title">
      <div className="wrap">
        <span className="label">{PROOF.resultsLabel}</span>
        <h2 className="h2 results-title" id="results-title">
          {PROOF.resultsTitle}
        </h2>
        <div className="strip results">
          {cells.map(([label, value, note]) => (
            <div key={label}>
              <div className="l">{label}</div>
              <div className="v num">{value}</div>
              <div className="s">{note}</div>
            </div>
          ))}
        </div>
        <p className="engine-note" data-engine={engine.name}>
          Verdicts from the {engineLabel(engine.name)}. Source: evidence/redteam/report.json.
        </p>
      </div>
    </section>
  );
}

export function Proof() {
  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <span className="label">{PROOF.label}</span>
          <h1 className="h2 proof-h1">
            {PROOF.heroLead} {PROOF.heroRest}
            <em>.</em>
          </h1>
          <p className="lede ink">{PROOF.sub}</p>
          <div className="actions page-actions">
            <Button href="#/demo">{PROOF.primary}</Button>
            <TextLink href="#/try">{PROOF.secondary}</TextLink>
            <TextLink href="#/verify">{PROOF.verifyLink}</TextLink>
          </div>
        </div>
      </section>

      <section className="sec tight" aria-label={PROOF.featuresLabel}>
        <div className="wrap">
          <div className="specs">
            {PROOF.features.map(([name, line]) => (
              <div className="spec" key={name}>
                <b>{name}</b>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ResultsStrip />
    </main>
  );
}
