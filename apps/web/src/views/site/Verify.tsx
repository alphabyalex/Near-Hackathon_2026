import { useMemo, useState, type FormEvent } from "react";
import { normalizeAccount, normalizeDomain } from "@wardline/sdk";
import type { EvidenceTier, PayeeVendor } from "@wardline/schemas";
import { errorText } from "../../api/public";
import { VERIFY } from "../../brand";
import { CodeBlock } from "../../components/CodeBlock";
import { API_BASE, NEAR_NETWORK } from "../../config";
import { TierBadge, TierFacts } from "../../payee/ResultCard";
import { connectEvm, hasEvmWallet, signEvm } from "../../wallets/evm";
import { accountFrom, nearWallets, randomNonce, signNep413, typesAccount, type NearWalletId } from "../../wallets/near";
import { connectSolana, hasPhantom, signSolana } from "../../wallets/solana";

export const PAYEE_RECIPIENT = "wardline-payee-registry";
export const payeeMessage = (domain: string, caip10: string, issuedAt: string): string => `wardline-payee:v2:${domain}:${caip10}:${issuedAt}`;

type Proof = { type: "nep413"; public_key: string; nonce: string; signature: string } | { type: "eip191"; signature: string } | { type: "solana-ed25519"; signature: string };
interface Entry {
  account: string;
  proof: Proof;
}

export function proofFile(domain: string, name: string, issuedAt: string, accounts: Entry[]) {
  return { version: 2 as const, domain, name, issued_at: issuedAt, accounts };
}

type VerifyOutcome =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "ok"; vendor: PayeeVendor & { accounts: { account: string; status: string; activatesAt: string | null; evidenceTier?: string }[] } }
  | { state: "fail"; message: string; accounts: { account: string; ok: boolean; reason?: string }[] };

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function Verify() {
  const [step, setStep] = useState(0);
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nearAccount, setNearAccount] = useState("");
  const [cluster, setCluster] = useState("devnet");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<VerifyOutcome>({ state: "idle" });
  const wallets = useMemo(() => nearWallets(), []);

  const file = proofFile(domain, name.trim(), issuedAt, entries);
  const fileText = `${JSON.stringify(file, null, 2)}\n`;

  const addEntry = (entry: Entry) => setEntries((list) => [...list.filter((e) => e.account !== entry.account), entry]);

  const guarded = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const submitBusiness = (event: FormEvent) => {
    event.preventDefault();
    try {
      const d = normalizeDomain(domain);
      if (!name.trim()) throw new Error("Enter the name payers should see.");
      setDomain(d);
      // One issue time for every signature in the file.
      if (d !== file.domain || !issuedAt) setIssuedAt(new Date().toISOString());
      setError(null);
      setStep(1);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const signNear = (walletId: NearWalletId) =>
    guarded(`near-${walletId}`, async () => {
      // NEAR Connect: the account the wallet signs in with. The test wallet takes the typed one.
      const caip10 = normalizeAccount(await accountFrom(walletId, nearAccount), NEAR_NETWORK);
      if (!caip10.startsWith("near:")) throw new Error("Enter a NEAR account id, like yourname.testnet.");
      const nonce = randomNonce();
      const accountId = caip10.split(":")[2] as string;
      const signed = await signNep413(walletId, { message: payeeMessage(domain, caip10, issuedAt), recipient: PAYEE_RECIPIENT, nonce }, accountId);
      addEntry({ account: caip10, proof: { type: "nep413", public_key: signed.publicKey, nonce: toBase64(nonce), signature: signed.signature } });
    });

  const signWithEvm = () =>
    guarded("evm", async () => {
      const { caip10, address } = await connectEvm();
      addEntry({ account: caip10, proof: { type: "eip191", signature: await signEvm(address, payeeMessage(domain, caip10, issuedAt)) } });
    });

  const signWithSolana = () =>
    guarded("solana", async () => {
      const { caip10 } = await connectSolana(cluster);
      addEntry({ account: caip10, proof: { type: "solana-ed25519", signature: await signSolana(payeeMessage(domain, caip10, issuedAt)) } });
    });

  const check = async () => {
    setOutcome({ state: "busy" });
    try {
      const res = await fetch(`${API_BASE}/v1/vendors/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) });
      const body = (await res.json().catch(() => null)) as { vendor?: unknown; message?: string; accounts?: { account: string; ok: boolean; reason?: string }[] } | null;
      if (res.ok && body?.vendor) setOutcome({ state: "ok", vendor: body.vendor as Extract<VerifyOutcome, { state: "ok" }>["vendor"] });
      else setOutcome({ state: "fail", message: body?.message ?? `The API answered ${res.status}.`, accounts: body?.accounts ?? [] });
    } catch (e) {
      setOutcome({ state: "fail", message: errorText(e), accounts: [] });
    }
  };

  const reachable = [true, issuedAt !== "", entries.length > 0, entries.length > 0];
  // Every account passed its own proof and the domain lists it: that is T2, whether or not it is still cooling off.
  const reachedTier = (outcome.state === "ok" ? (outcome.vendor.accounts.find((a) => a.evidenceTier)?.evidenceTier as EvidenceTier | undefined) : undefined) ?? "T2_DOMAIN_LINKED";

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <h1 className="h2">{VERIFY.title}</h1>
          <p className="lede ink">{VERIFY.lede}</p>
        </div>
      </section>
      <section className="sec tight">
        <div className="wrap verify">
          <nav aria-label="Verification steps">
            <ol className="stepper">
              {VERIFY.steps.map((label, i) => (
                <li key={label} className={i < step ? "done" : ""}>
                  {i < step && reachable[i] ? (
                    <button type="button" onClick={() => setStep(i)}>
                      {label}
                    </button>
                  ) : (
                    <span {...(i === step ? { "aria-current": "step" as const } : {})}>{label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}

          {step === 0 && (
            <form className="form narrow" onSubmit={submitBusiness}>
              <label className="field">
                <span>{VERIFY.domain}</span>
                <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourcompany.com" required autoComplete="url" spellCheck={false} inputMode="url" />
              </label>
              <label className="field">
                <span>{VERIFY.displayName}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your Company Ltd" maxLength={120} required autoComplete="organization" />
              </label>
              <div className="form-actions">
                <button className="btn" type="submit">
                  {VERIFY.next}
                </button>
              </div>
            </form>
          )}

          {step === 1 && (
            <div className="wallets">
              <div className="wallet-row">
                <div className="wr-name">
                  <b>{VERIFY.near}</b>
                  <span>NEP-413 message signing</span>
                </div>
                <div className="wr-act">
                  {wallets.some((w) => typesAccount(w.id)) && (
                    <label className="field compact">
                      <span>{VERIFY.nearAccount}</span>
                      <input value={nearAccount} onChange={(e) => setNearAccount(e.target.value)} placeholder={`yourname.${NEAR_NETWORK}`} autoComplete="off" spellCheck={false} />
                    </label>
                  )}
                  <div className="wr-buttons">
                    {wallets.map((w) => (
                      <button key={w.id} type="button" className="sbtn" disabled={(typesAccount(w.id) && !nearAccount.trim()) || busy !== null} onClick={() => void signNear(w.id)}>
                        {busy === `near-${w.id}` ? "Waiting for wallet" : `Sign with ${w.name}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="wallet-row">
                <div className="wr-name">
                  <b>{VERIFY.evm}</b>
                  <span>Injected wallet, personal_sign</span>
                </div>
                <div className="wr-act">
                  <div className="wr-buttons">
                    <button type="button" className="sbtn" disabled={busy !== null} onClick={() => void signWithEvm()}>
                      {busy === "evm" ? "Waiting for wallet" : VERIFY.connectSign}
                    </button>
                  </div>
                  {!hasEvmWallet() && <small className="muted">No EVM wallet found in this browser.</small>}
                </div>
              </div>
              <div className="wallet-row">
                <div className="wr-name">
                  <b>{VERIFY.solana}</b>
                  <span>Phantom, signMessage</span>
                </div>
                <div className="wr-act">
                  <label className="field compact">
                    <span>Cluster</span>
                    <select value={cluster} onChange={(e) => setCluster(e.target.value)}>
                      <option value="devnet">devnet</option>
                      <option value="mainnet">mainnet</option>
                    </select>
                  </label>
                  <div className="wr-buttons">
                    <button type="button" className="sbtn" disabled={busy !== null} onClick={() => void signWithSolana()}>
                      {busy === "solana" ? "Waiting for wallet" : VERIFY.connectSign}
                    </button>
                  </div>
                  {!hasPhantom() && <small className="muted">Phantom was not found in this browser.</small>}
                </div>
              </div>

              <div className="signed">
                <h2>{VERIFY.signedCount(entries.length)}</h2>
                <ul>
                  {entries.map((entry) => (
                    <li key={entry.account}>
                      <span className="mono">{entry.account}</span>
                      <code>{entry.proof.type}</code>
                      <button type="button" className="back" onClick={() => setEntries((list) => list.filter((e) => e.account !== entry.account))}>
                        {VERIFY.remove}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="form-actions">
                <button className="btn" type="button" disabled={entries.length === 0} onClick={() => setStep(2)}>
                  {VERIFY.next}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="host">
              <div className="host-text">
                <h2>{VERIFY.hostTitle}</h2>
                <p className="mono host-url">https://{domain}/.well-known/wardline-payee.json</p>
                <ul className="limit-list">
                  {VERIFY.hostRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
                <div className="form-actions">
                  <button className="btn" type="button" onClick={() => download("wardline-payee.json", fileText)}>
                    {VERIFY.download}
                  </button>
                  <button className="link" type="button" onClick={() => setStep(3)}>
                    {VERIFY.next}
                  </button>
                </div>
              </div>
              <CodeBlock code={fileText} label="wardline-payee.json" language="json" />
            </div>
          )}

          {step === 3 && (
            <div className="checkstep" aria-live="polite">
              <p>
                {VERIFY.fetches} <span className="mono">https://{domain}/.well-known/wardline-payee.json</span> {VERIFY.fetchesRest}
              </p>
              <div className="form-actions">
                <button className="btn" type="button" disabled={outcome.state === "busy"} onClick={() => void check()}>
                  {outcome.state === "busy" ? "Checking" : VERIFY.checkButton}
                </button>
              </div>
              {outcome.state === "fail" && (
                <div className="notice" role="alert">
                  <p>{outcome.message}</p>
                  {outcome.accounts.filter((a) => !a.ok).map((a) => (
                    <p key={a.account} className="mono">
                      {a.account}: {a.reason}
                    </p>
                  ))}
                </div>
              )}
              {outcome.state === "ok" && (
                <div className="reached" data-reached={reachedTier}>
                  <div className="reached-head">
                    <span>{VERIFY.reached}</span>
                    <TierBadge tier={reachedTier} />
                  </div>
                  <TierFacts tier={reachedTier} />
                  <ul className="acct-list">
                    {outcome.vendor.accounts.map((a) => (
                      <li key={a.account}>
                        <span className="mono">{a.account}</span>
                        <span className={a.status === "active" ? "ok" : "warn-text"}>{a.status === "active" ? "active" : `cooldown until ${a.activatesAt ?? ""}`}</span>
                      </li>
                    ))}
                  </ul>
                  {outcome.vendor.accounts.some((a) => a.status !== "active") && <p className="muted">{VERIFY.pendingNote}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
