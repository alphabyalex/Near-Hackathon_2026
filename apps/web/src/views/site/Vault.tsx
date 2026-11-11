import type { OverviewView } from "@wardline/schemas";
import { useApi } from "../../api/client";
import { limitsFromOverview } from "../../api/limits";
import { DotBar } from "../../components/DotBar";
import { Terminal } from "../../components/Terminal";
import { VAULT } from "../../brand";

const STAGGER_SECONDS = 0.15;

export function Vault() {
  const overview = useApi<OverviewView>("/overview");
  const limits = limitsFromOverview(overview.data);
  return (
    <main className="vault-page">
      <section className="sec night pagetop">
        <div className="wrap split">
          <div>
            <h1 className="h2">{VAULT.title}</h1>
            <p className="lede">{VAULT.lede}</p>
          </div>
          <Terminal />
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2 className="h2" style={{ marginBottom: 56 }}>
            {VAULT.limitsTitle}
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
