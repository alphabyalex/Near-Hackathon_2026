import { useState } from "react";
import type { OverviewView } from "@redline/schemas";
import { apiPost, useApi } from "../api/client";
import { LoadError, Loading } from "../components/Loading";
import { Logo } from "../components/Logo";
import { TokenContext } from "../components/Money";
import { Tabs } from "../components/Tabs";
import { businessName } from "../format";
import type { DashboardTab } from "../router";
import { Controls } from "./Controls";
import { Evaluation } from "./Evaluation";
import { Invoices } from "./Invoices";
import { Overview } from "./Overview";

const TABS: readonly { tab: DashboardTab; label: string }[] = [
  { tab: "overview", label: "Overview" },
  { tab: "invoices", label: "Invoices" },
  { tab: "evaluation", label: "Evaluation" },
  { tab: "controls", label: "Controls" },
];

const VAULTS = [
  { id: "vault-a.redline.testnet", label: "Business A (vault-a)" },
  { id: "vault-b.redline.testnet", label: "Business B (vault-b)" },
] as const;

export function Dashboard({ tab, invoice }: { tab: DashboardTab; invoice: string | null }) {
  // Every view refetches when this changes, so an owner action updates the whole dashboard.
  const [version, setVersion] = useState(0);
  const [vaultId, setVaultId] = useState<string>("vault-a.redline.testnet");
  const changed = () => setVersion((v) => v + 1);
  const overviewPath = vaultId === "vault-a.redline.testnet" ? "/overview" : `/overview?vault_id=${encodeURIComponent(vaultId)}`;
  const overview = useApi<OverviewView>(overviewPath, version);
  const data = overview.data;
  const paused = data?.policy.paused ?? false;
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const togglePause = async () => {
    if (paused) {
      if (!window.confirm("Unpause this vault? Agent payments will resume.")) return;
      setPausing(true);
      setPauseError(null);
      try {
        await apiPost("/vault/unpause", { vault_id: vaultId });
      } catch (error) {
        setPauseError(error instanceof Error ? error.message : "Could not unpause.");
      } finally {
        setPausing(false);
        changed();
      }
    } else {
      if (!window.confirm("Pause this vault? All agent payments stop.")) return;
      setPausing(true);
      setPauseError(null);
      try {
        await apiPost("/vault/pause", { vault_id: vaultId });
      } catch (error) {
        setPauseError(error instanceof Error ? error.message : "Could not pause.");
      } finally {
        setPausing(false);
        changed();
      }
    }
  };

  return (
    <TokenContext.Provider value={data?.token ?? null}>
      <div className={paused ? "paused" : ""}>
        <header className="top app-top">
          <div className="wrap">
            <div className="dash-brand">
              <Logo markSize={26} textSize={20} />
              <Tabs label="Dashboard" items={TABS.map((t) => ({ href: `#/app/${t.tab}`, label: t.label, current: t.tab === tab }))} />
            </div>
            <div className="dash-actions">
              <div className="runpick">
                <select
                  aria-label="Select vault"
                  value={vaultId}
                  onChange={(e) => {
                    setVaultId(e.target.value);
                    changed();
                  }}
                >
                  {VAULTS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              {data && (
                <span className="live">
                  <i />
                  <span>{paused ? "Vault paused" : "Vault active"}</span>
                </span>
              )}
              <button className="pause" type="button" disabled={!data || pausing} onClick={() => void togglePause()}>
                {paused ? "Unpause vault" : "Pause vault"}
              </button>
            </div>
          </div>
        </header>

        <div className="appmain" key={`${tab}-${vaultId}`}>
          {pauseError && (
            <p className="notice" role="alert">
              {pauseError}
            </p>
          )}
          {overview.error && <LoadError message={overview.error} />}
          {!overview.error && !data && <Loading />}
          {data && (
            <>
              <div className="apphead">
                <div>
                  <h1>{businessName(data.vault_id)}</h1>
                  <div className="sub">
                    {data.vault_id} · agent version {data.manifest.version}
                  </div>
                </div>
                <div className="sub">Amounts in {data.token.symbol}</div>
              </div>
              {tab === "overview" && <Overview data={data} version={version} onChanged={changed} />}
              {tab === "invoices" && <Invoices selected={invoice} version={version} onChanged={changed} vaultId={vaultId} />}
              {tab === "evaluation" && <Evaluation />}
              {tab === "controls" && <Controls data={data} version={version} />}
            </>
          )}
        </div>
      </div>
    </TokenContext.Provider>
  );
}
