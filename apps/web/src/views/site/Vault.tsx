import type { OverviewView } from "@redline/schemas";
import { useApi } from "../../api/client";
import { limitsFromOverview } from "../../api/limits";
import { DotBar } from "../../components/DotBar";
import { Terminal } from "../../components/Terminal";

const STAGGER_SECONDS = 0.15;

export function Vault() {
  const overview = useApi<OverviewView>("/overview");
  const limits = limitsFromOverview(overview.data);
  return (
    <main className="vault-page">
      <section className="sec night pagetop">
        <div className="wrap split">
          <div>
            <span className="label">The vault</span>
            <h2 className="h2">Steal the agent's key. The money stays put.</h2>
            <p className="lede">No AI here. Just the agent's own key, trying every way out.</p>
          </div>
          <Terminal />
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <span className="label">Limits</span>
          <h2 className="h2" style={{ marginBottom: 56 }}>
            Four limits the agent cannot move.
          </h2>
          <div className="limits">
            {limits.map((limit, index) => (
              <div className="lim" key={limit.title}>
                <div className="t">{limit.title}</div>
                <DotBar settled={limit.settled} reserved={limit.reserved} cap={limit.cap} delay={index * STAGGER_SECONDS} label={`${limit.title}: ${limit.value}, ${limit.note}`} />
                <div className="v num">
                  {limit.value}
                  <small>{limit.note}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
