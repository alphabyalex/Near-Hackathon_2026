import { Button } from "../../components/Button";
import { HeroSphere } from "../../components/HeroSphere";
import { TextLink } from "../../components/TextLink";

const FEATURES = [
  ["Tested before trusted", "Every agent version faces scam invoices first."],
  ["Limits in the contract", "They hold even if the agent is hacked."],
  ["Flags first, pays second", "It never picks an amount or a recipient."],
  ["Nothing gets declined", "Over-limit bills wait for you, soonest due first."],
  ["You sign every raise", "Limits never grow on their own."],
  ["Proof on NEAR", "Tested version and results, hashed on chain."],
] as const;

export function Home() {
  return (
    <main>
      <section className="hero" aria-label="Introduction">
        <HeroSphere />
        <div className="limitline" aria-hidden="true">
          <span>limit</span>
        </div>
        <div className="wrap">
          <h1>
            Every agent has a redline<em>.</em>
          </h1>
          <p>Test AI agents that pay invoices. Cap what they can spend, on chain.</p>
          <div className="actions">
            <Button href="#/vault">Watch an attack fail</Button>
            <TextLink href="#/about">How it works</TextLink>
          </div>
        </div>
      </section>

      <section className="sec tight">
        <div className="wrap">
          <div className="specs">
            {FEATURES.map(([name, line]) => (
              <div className="spec" key={name}>
                <b>{name}</b>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
