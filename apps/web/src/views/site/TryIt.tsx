import { useId, useState, type FormEvent } from "react";
import type { PayeeCheckRequest, PayeeResolveRequest } from "@wardline/schemas";
import type { PayeeRequest, PayeeResult } from "@wardline/sdk";
import { errorText, wardline } from "../../api/public";
import { TRY } from "../../brand";
import { ResultCard } from "../../payee/ResultCard";

export const CHAINS = [
  { id: "near:testnet", label: "NEAR" },
  { id: "eip155:84532", label: "Base Sepolia" },
  { id: "solana:devnet", label: "Solana devnet" },
] as const;

const RESOLVE_EXAMPLES = [
  { domain: "northwind.example", chain: "near:testnet" },
  { domain: "fernhill.example", chain: "eip155:84532" },
  { domain: "unknown-shop.example", chain: "near:testnet" },
] as const;

const CHECK_EXAMPLES = [
  { address: "northw1nd.testnet", domain: "northwind.example" },
  { address: "northwind.testnet", domain: "northwind.example" },
  { address: "fernhillcloud.testnet", domain: "" },
] as const;

type Mode = "resolve" | "check";
type Outcome = { state: "idle" } | { state: "busy" } | { state: "done"; result: PayeeResult; request: PayeeRequest } | { state: "error"; message: string };

export function TryIt() {
  const [mode, setMode] = useState<Mode>("resolve");
  const [domain, setDomain] = useState("northwind.example");
  const [chain, setChain] = useState<string>("near:testnet");
  const [address, setAddress] = useState("northw1nd.testnet");
  const [vendorDomain, setVendorDomain] = useState("northwind.example");
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const ids = useId();

  const run = async (request: { kind: "resolve"; body: PayeeResolveRequest } | { kind: "check"; body: PayeeCheckRequest }) => {
    setOutcome({ state: "busy" });
    try {
      const result = request.kind === "resolve" ? await wardline.resolve(request.body) : await wardline.check(request.body);
      setOutcome({ state: "done", result, request: request.body });
    } catch (error) {
      setOutcome({ state: "error", message: errorText(error) });
    }
  };

  const resolveRequest = (d = domain, c = chain): { kind: "resolve"; body: PayeeResolveRequest } => ({ kind: "resolve", body: { domain: d.trim(), chain: c } });
  const checkRequest = (a = address, v = vendorDomain): { kind: "check"; body: PayeeCheckRequest } => ({
    kind: "check",
    body: v.trim() ? { payee: a.trim(), vendor: { domain: v.trim() }, source: "manual" } : { payee: a.trim(), source: "manual" },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(mode === "resolve" ? resolveRequest() : checkRequest());
  };

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      id={`${ids}-${value}`}
      aria-selected={mode === value}
      aria-controls={`${ids}-panel`}
      tabIndex={mode === value ? 0 : -1}
      onClick={() => {
        setMode(value);
        setOutcome({ state: "idle" });
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const next = value === "resolve" ? "check" : "resolve";
          setMode(next);
          document.getElementById(`${ids}-${next}`)?.focus();
        }
      }}
    >
      {label}
    </button>
  );

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <span className="label">{TRY.label}</span>
          <h1 className="h2">{TRY.title}</h1>
          <p className="lede">{TRY.lede}</p>
        </div>
      </section>
      <section className="sec tight">
        <div className="wrap play">
          <div>
            <div className="tablist" role="tablist" aria-label="Request type">
              {tab("resolve", TRY.resolveTab)}
              {tab("check", TRY.checkTab)}
            </div>
            <form id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-${mode}`} className="form" onSubmit={submit}>
              {mode === "resolve" ? (
                <>
                  <label className="field">
                    <span>{TRY.domain}</span>
                    <input value={domain} onChange={(e) => setDomain(e.target.value)} required autoComplete="off" spellCheck={false} inputMode="url" />
                  </label>
                  <label className="field">
                    <span>{TRY.chain}</span>
                    <select value={chain} onChange={(e) => setChain(e.target.value)}>
                      {CHAINS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} ({c.id})
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>
                      {TRY.address} <small>{TRY.addressHint}</small>
                    </span>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} required autoComplete="off" spellCheck={false} />
                  </label>
                  <label className="field">
                    <span>{TRY.vendorDomain}</span>
                    <input value={vendorDomain} onChange={(e) => setVendorDomain(e.target.value)} autoComplete="off" spellCheck={false} inputMode="url" />
                  </label>
                </>
              )}
              <div className="form-actions">
                <button className="btn" type="submit" disabled={outcome.state === "busy"}>
                  {mode === "resolve" ? TRY.resolveButton : TRY.checkButton}
                </button>
              </div>
              <div className="examples">
                <span>{TRY.examples}</span>
                {mode === "resolve"
                  ? RESOLVE_EXAMPLES.map((ex) => (
                      <button
                        type="button"
                        key={`${ex.domain}-${ex.chain}`}
                        className="chip"
                        onClick={() => {
                          setDomain(ex.domain);
                          setChain(ex.chain);
                          void run(resolveRequest(ex.domain, ex.chain));
                        }}
                      >
                        {ex.domain} <small>{ex.chain}</small>
                      </button>
                    ))
                  : CHECK_EXAMPLES.map((ex) => (
                      <button
                        type="button"
                        key={ex.address}
                        className="chip"
                        onClick={() => {
                          setAddress(ex.address);
                          setVendorDomain(ex.domain);
                          void run(checkRequest(ex.address, ex.domain));
                        }}
                      >
                        {ex.address}
                        {ex.domain && <small>{ex.domain}</small>}
                      </button>
                    ))}
              </div>
            </form>
          </div>
          <div className="play-out" aria-live="polite">
            {outcome.state === "idle" && <p className="placeholder">The verdict, its reasons and a signed receipt show here.</p>}
            {outcome.state === "busy" && <p className="loading">Asking the API</p>}
            {outcome.state === "error" && (
              <p className="notice" role="alert">
                {outcome.message}
              </p>
            )}
            {outcome.state === "done" && <ResultCard result={outcome.result} request={outcome.request} />}
          </div>
        </div>
      </section>
    </main>
  );
}
