import { HOME } from "../../brand";
import { Button } from "../../components/Button";
import { HeroSphere } from "../../components/HeroSphere";
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
        <span className="label">{HOME.resultsLabel}</span>
        <h2 className="h2 results-title" id="results-title">
          {HOME.resultsTitle}
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

export function Home() {
  return (
    <main>
      <section className="hero" aria-label="Introduction">
        <HeroSphere />
        <div className="limitline" aria-hidden="true">
          <span>limit</span>
        </div>
        <div className="wrap">
          <h1 className="hero-h1">
            {HOME.heroLead} <span>{HOME.heroRest}</span>
            <em>.</em>
          </h1>
          <p>{HOME.sub}</p>
          <div className="actions">
            <Button href="#/demo">{HOME.primary}</Button>
            <TextLink href="#/try">{HOME.secondary}</TextLink>
          </div>
        </div>
      </section>

      <section className="sec tight" aria-label={HOME.featuresLabel}>
        <div className="wrap">
          <div className="specs">
            {HOME.features.map(([name, line]) => (
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
