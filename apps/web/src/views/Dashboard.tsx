import { Group } from "./owner/Group";
import { MeterKeys } from "./owner/MeterKeys";
import { useEffect, useState } from "react";
import type { OverviewView } from "@wardline/schemas";
import { apiPost, SIGNED_OUT_EVENT, useApi } from "../api/client";
import { getSession, signOut, type Session } from "../api/owner";
import { OWNER } from "../brand";
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
import { ApiKeys } from "./owner/ApiKeys";
import { ReviewDesk } from "./owner/ReviewDesk";
import { Share } from "./owner/Share";
import { SignIn } from "./owner/SignIn";

const TABS: readonly { tab: DashboardTab; label: string }[] = [
  { tab: "overview", label: OWNER.tabs.overview },
  { tab: "share", label: OWNER.tabs.share },
  { tab: "group", label: OWNER.tabs.group },
  { tab: "invoices", label: OWNER.tabs.invoices },
  { tab: "review", label: OWNER.tabs.review },
  { tab: "keys", label: OWNER.tabs.keys },
  { tab: "evaluation", label: OWNER.tabs.evaluation },
  { tab: "controls", label: OWNER.tabs.controls },
];

const VAULTS = [
  { id: "vault-a.wardline.testnet", label: "Business A (vault-a)" },
  { id: "vault-b.wardline.testnet", label: "Business B (vault-b)" },
] as const;

type Gate = { state: "checking" } | { state: "signed-out" } | { state: "signed-in"; session: Session };

/** The owner app: sign-in first, then the dashboard. A 401 from any owner call returns here. */
export function OwnerApp({ tab, invoice }: { tab: DashboardTab; invoice: string | null }) {
  const [gate, setGate] = useState<Gate>({ state: "checking" });
  useEffect(() => {
    let cancelled = false;
    getSession().then(
      (session) => !cancelled && setGate({ state: "signed-in", session }),
      () => !cancelled && setGate({ state: "signed-out" }),
    );
    const out = () => setGate({ state: "signed-out" });
    window.addEventListener(SIGNED_OUT_EVENT, out);
    return () => {
      cancelled = true;
      window.removeEventListener(SIGNED_OUT_EVENT, out);
    };
  }, []);
  if (gate.state === "checking") return <main className="signin"><Loading /></main>;
  if (gate.state === "signed-out") return <SignIn onSignedIn={(session) => setGate({ state: "signed-in", session })} />;
  return (
    <Dashboard
      tab={tab}
      invoice={invoice}
      session={gate.session}
      onSignOut={async () => {
        await signOut().catch(() => undefined);
        setGate({ state: "signed-out" });
      }}
    />
  );
}

export function Dashboard({ tab, invoice, session, onSignOut }: { tab: DashboardTab; invoice: string | null; session: Session; onSignOut: () => void }) {
  // Every view refetches when this changes, so an owner action updates the whole dashboard.
  const [version, setVersion] = useState(0);
  const simulation = useApi<{ enabled: boolean; compromised: boolean }>("/owner/agent/simulation", version);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const toggleSimulation = async () => {
    setSimulationBusy(true);
    setSimulationError(null);
    try { await apiPost("/owner/agent/simulation", { compromised: !simulation.data?.compromised }); changed(); }
    catch (error) { setSimulationError(error instanceof Error ? error.message : "Could not change simulation mode."); }
    finally { setSimulationBusy(false); }
  };
  const [vaultId, setVaultId] = useState<string>("vault-a.wardline.testnet");
  const changed = () => setVersion((v) => v + 1);
  const overviewPath = vaultId === "vault-a.wardline.testnet" ? "/overview" : `/overview?vault_id=${encodeURIComponent(vaultId)}`;
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
        await apiPost("/owner/vault/unpause", { vault_id: vaultId });
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
        await apiPost("/owner/vault/pause", { vault_id: vaultId });
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
            <Logo />
            <Tabs label="Dashboard" items={TABS.map((t) => ({ href: `#/app/${t.tab}`, label: t.label, current: t.tab === tab }))} />
            <div className="whoami">
              <span className="acct" title={session.role}>
                {session.account}
              </span>
              <span className="role">{session.role}</span>
              {session.account !== "local" && (
                <button type="button" className="btn ghost sm" onClick={onSignOut}>
                  {OWNER.signOut}
                </button>
              )}
            </div>
          </div>
        </header>
        <div className="app-bar">
          <div className="wrap">
            <div className="dash-actions">
              {simulation.data?.enabled && <button type="button" disabled={simulationBusy} aria-pressed={simulation.data.compromised}
                onClick={() => void toggleSimulation()}>{simulation.data.compromised ? "Simulated compromise ON" : "Simulate compromised agent"}</button>}
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
        </div>

        <div className="appmain" key={`${tab}-${vaultId}`}>
          {simulation.data?.compromised && <p className="notice" role="status">Simulated compromised agent: invoices attempt payment without safety checks. Vault limits still apply.</p>}
          {simulationError && <p role="alert">{simulationError}</p>}
          {pauseError && (
            <p className="notice" role="alert">
              {pauseError}
            </p>
          )}
          {tab === "share" && <Share account={session.account} version={version} />}
          {tab !== "share" && overview.error && <LoadError message={overview.error} />}
          {tab !== "share" && !overview.error && !data && <Loading />}
          {tab !== "share" && data && (
            <>
              <div className="apphead">
                <div>
                  <h1>{businessName(data.vault_id)}</h1>
                  <div className="sub">
                    {data.vault_id}, agent version {data.manifest.version}
                  </div>
                </div>
                <div className="apphead-side">
                  <div className="sub">Amounts in {data.token.symbol}</div>
                </div>
              </div>
              {tab === "overview" && <Overview data={data} version={version} onChanged={changed} />}
              {tab === "group" && <Group version={version} />}
              {tab === "invoices" && <Invoices selected={invoice} version={version} onChanged={changed} vaultId={vaultId} />}
              {tab === "review" && <ReviewDesk version={version} onChanged={changed} />}
              {tab === "keys" && (
                <>
                  <MeterKeys version={version} onChanged={changed} />
                  <ApiKeys version={version} onChanged={changed} defaultPayer={vaultId} />
                </>
              )}
              {tab === "evaluation" && <Evaluation />}
              {tab === "controls" && <Controls data={data} version={version} />}
            </>
          )}
        </div>
      </div>
    </TokenContext.Provider>
  );
}
