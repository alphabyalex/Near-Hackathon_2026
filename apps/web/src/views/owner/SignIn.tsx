import { useMemo, useState, type FormEvent } from "react";
import { rememberWallet, signIn, type Session } from "../../api/owner";
import { errorText } from "../../api/public";
import { OWNER } from "../../brand";
import { Logo } from "../../components/Logo";
import { NEAR_NETWORK } from "../../config";
import { nearWallets, typesAccount, type NearWalletId } from "../../wallets/near";

export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState<NearWalletId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wallets = useMemo(() => nearWallets(), []);
  // Only the test wallet and the local test signer take a typed account; NEAR Connect asks the wallet.
  const typed = wallets.some((w) => typesAccount(w.id));

  const go = async (walletId: NearWalletId) => {
    setBusy(walletId);
    setError(null);
    try {
      const session = await signIn(account, walletId);
      rememberWallet(walletId);
      onSignedIn(session);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const first = wallets[0];
    if (first) void go(first.id);
  };

  return (
    <>
      <header className="top">
        <div className="wrap">
          <Logo />
          <a className="link small" href="#/">
            Back to the site
          </a>
        </div>
      </header>
      <main className="signin">
        <h1>{OWNER.signInTitle}</h1>
        <p className="lede ink">{OWNER.signInLede}</p>
        <form className="form" onSubmit={submit}>
          {typed && (
            <label className="field">
              <span>{OWNER.account}</span>
              <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder={`you.${NEAR_NETWORK}`} autoComplete="username" spellCheck={false} />
            </label>
          )}
          <fieldset className="wallet-pick" disabled={busy !== null}>
            <legend>{OWNER.chooseWallet}</legend>
            {wallets.map((w) => (
              <button key={w.id} type="button" className="pick" disabled={typesAccount(w.id) && !account.trim()} onClick={() => void go(w.id)} data-wallet={w.id}>
                <b>{w.name}</b>
                <span>{busy === w.id ? OWNER.signing : "Sign the challenge"}</span>
              </button>
            ))}
          </fieldset>
        </form>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
      </main>
    </>
  );
}
