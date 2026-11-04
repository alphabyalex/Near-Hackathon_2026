import { useEffect, useState } from "react";
import type { OverviewView } from "@spendgym/schemas";
import { useApi } from "./api/client";
import { LoadError, Loading } from "./components/Loading";
import { TokenContext } from "./components/Money";
import { Controls } from "./views/Controls";
import { Evaluation } from "./views/Evaluation";
import { Invoices } from "./views/Invoices";
import { Overview } from "./views/Overview";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "invoices", label: "Invoices" },
  { id: "evaluation", label: "Evaluation" },
  { id: "controls", label: "Controls and History" },
] as const;

function useHashRoute(): [tab: string, param: string | null] {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const [, tab, param] = hash.split("/");
  return [tab || "overview", param ? decodeURIComponent(param) : null];
}

export function App() {
  const [tab, param] = useHashRoute();
  const overview = useApi<OverviewView>("/overview");
  const data = overview.data;

  return (
    <TokenContext.Provider value={data?.token ?? null}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand-row">
            <span className="wordmark">Spend Gym</span>
            {data && (
              <span className="muted small">
                {data.vault_id} on {data.token.network}
              </span>
            )}
          </div>
          <nav className="tabs" aria-label="Views">
            {TABS.map((t) => (
              <a key={t.id} className="tab" href={`#/${t.id}`} {...(tab === t.id ? { "aria-current": "page" as const } : {})}>
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {data?.data_source === "mock" && (
        <div className="mock-banner">
          <p>Mock data. No contract or LLM is connected yet, so nothing on this page is a real payment or a real evaluation.</p>
        </div>
      )}
      <main className="app-main">
        {overview.error && <LoadError message={overview.error} />}
        {!overview.error && !data && <Loading />}
        {data && tab === "overview" && <Overview data={data} />}
        {data && tab === "invoices" && <Invoices selected={param} onChanged={overview.reload} />}
        {data && tab === "evaluation" && <Evaluation />}
        {data && tab === "controls" && <Controls onChanged={overview.reload} />}
        {data && !TABS.some((t) => t.id === tab) && <p>No such view. Pick a tab above.</p>}
      </main>
    </TokenContext.Provider>
  );
}
