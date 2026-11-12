/**
 * Connect wallet: one Horizon panel. A click on a wallet's logo connects that wallet directly through
 * NEAR Connect (no NEAR Connect selection modal). Once a wallet connects, the panel closes.
 *
 * Anchored under the header on wide screens, a bottom sheet with a grab handle on phones (Dialog).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { WALLET } from "../brand";
import { Dialog } from "../components/Dialog";
import { HorizonMark } from "../components/HorizonMark";
import { explain } from "../data/errors";
import { localSignerAccounts } from "../data/mutual";
import { NEAR_NETWORK, TEST_WALLET } from "../config";
import { installedIds, isMobile, orderWallets, SIGN_UP, WALLETS, type WalletInfo } from "./catalog";
import { setConnected, useConnected } from "./connected";
import { connectNear, loadConnector, nearWallets, typesAccount, type NearWalletId } from "./near";
import "./wallet-panel.css";

/** After this long, the panel says it is still waiting. The connect itself never times out. */
export const STILL_WAITING_MS = 90_000;


/** Whether NEAR Connect is showing a wallet's own window (its iframe popup) on top of the page. */
function useCoveredByWallet(active: boolean): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!active) return setCovered(false);
    const check = () => setCovered([...document.querySelectorAll<HTMLElement>(".hot-connector-popup")].some((el) => el.style.display !== "none" && el.isConnected));
    check();
    const watch = new MutationObserver(check);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    return () => watch.disconnect();
  }, [active]);
  return covered;
}

function Tile({ wallet, index, installed, opening, disabled, onPick }: { wallet: WalletInfo; index: number; installed: boolean; opening: boolean; disabled: boolean; onPick: (w: WalletInfo) => void }) {
  return (
    <li className="wp-cell" style={{ "--i": index } as React.CSSProperties}>
      <button type="button" className="wp-tile" data-wallet-id={wallet.id} data-opening={opening || undefined} aria-busy={opening || undefined} disabled={disabled} onClick={() => onPick(wallet)}>
        {/* The tile's text names the wallet, so the logo (alt: its name) is not read twice. */}
        <span className="wp-logo" aria-hidden="true">
          <img src={wallet.logo} alt={WALLET.logoAlt(wallet.name)} width={32} height={32} decoding="async" />
        </span>
        {opening ? (
          <span className="wp-name wp-opening" role="status">
            <span className="wp-spin" aria-hidden="true" />
            {WALLET.opening(wallet.name)}
          </span>
        ) : (
          <span className="wp-name">{wallet.name}</span>
        )}
        {installed && !opening && (
          <span className="wp-installed">
            <span className="wp-dot" aria-hidden="true" />
            {WALLET.installed}
          </span>
        )}
      </button>
    </li>
  );
}

/** The wallets grid, More wallets, errors and the sign-up line. */
function Picker({ onConnected, onCancel }: { onConnected: () => void; onCancel: () => void }) {
  const installed = useMemo(() => installedIds(), []);
  const ordered = useMemo(() => orderWallets(WALLETS, { installed, mobile: isMobile() }), [installed]);
  const main = ordered.filter((w) => w.group === "main");
  const more = ordered.filter((w) => w.group === "more");
  const [opening, setOpening] = useState<WalletInfo | null>(null);
  const [last, setLast] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [slow, setSlow] = useState(false);
  const attempt = useRef(0);
  const covered = useCoveredByWallet(opening !== null);

  // Load NEAR Connect as the panel opens, so a click reaches the wallet at once.
  useEffect(() => {
    void loadConnector().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!opening) return setSlow(false);
    const t = window.setTimeout(() => setSlow(true), STILL_WAITING_MS);
    return () => window.clearTimeout(t);
  }, [opening]);

  const pick = (w: WalletInfo) => {
    const mine = ++attempt.current;
    setError(null);
    setOpening(w);
    setLast(w);
    connectNear(w.id).then(
      () => {
        if (mine === attempt.current) onConnected();
      },
      (e: unknown) => {
        if (mine !== attempt.current) return;
        setError(e);
        setOpening(null);
      },
    );
  };

  const retryable = error !== null ? explain(error) : null;
  return (
    <div className="wp" data-covered={covered || undefined}>
      <ul className="wp-grid" aria-label={WALLET.pickerLabel}>
        {main.map((w, i) => (
          <Tile key={w.id} wallet={w} index={i} installed={installed.has(w.id)} opening={opening?.id === w.id} disabled={opening !== null && opening.id !== w.id} onPick={pick} />
        ))}
      </ul>
      {more.length > 0 && (
        <details className="wp-more">
          <summary>{WALLET.moreWallets}</summary>
          <ul className="wp-grid">
            {more.map((w, i) => (
              <Tile key={w.id} wallet={w} index={i} installed={installed.has(w.id)} opening={opening?.id === w.id} disabled={opening !== null && opening.id !== w.id} onPick={pick} />
            ))}
          </ul>
        </details>
      )}
      {retryable && (
        <div className="wp-error" role="alert" data-problem={retryable.kind}>
          <b>{retryable.title}</b>
          <span>{retryable.next}</span>
          <button type="button" className="btn ghost sm" onClick={() => last && pick(last)}>
            {WALLET.tryAgain}
          </button>
        </div>
      )}
      {slow && opening && (
        <div className="wp-error" role="status" data-problem="walletTimeout">
          <b>{WALLET.stillWaiting(opening.name)}</b>
          <span>{WALLET.stillWaitingNext}</span>
          <button type="button" className="btn ghost sm" onClick={() => pick(opening)}>
            {WALLET.tryAgain}
          </button>
        </div>
      )}
      <p className="wp-net">
        <span className="wp-net-dot" aria-hidden="true" />
        {WALLET.network(NEAR_NETWORK)}
      </p>
      <div className="wp-foot">
        <p className="wp-new">
          {WALLET.newToNear} {WALLET.createWith}{" "}
          <a href={SIGN_UP[0].href} target="_blank" rel="noreferrer">
            {SIGN_UP[0].name}
          </a>{" "}
          {WALLET.or}{" "}
          <a href={SIGN_UP[1].href} target="_blank" rel="noreferrer">
            {SIGN_UP[1].name}
          </a>
          .
        </p>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          {WALLET.cancel}
        </button>
      </div>
    </div>
  );
}

/** Local development only: the e2e test wallet and the local test signer, which take a typed account. */
function Developer({ onDone }: { onDone: () => void }) {
  const wallets = useMemo(() => nearWallets().filter((w) => typesAccount(w.id)), []);
  const [wallet, setWallet] = useState<NearWalletId | null>(wallets[0]?.id ?? null);
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const local = wallet === "local-signer";
  useEffect(() => {
    if (!local) return;
    let live = true;
    localSignerAccounts().then((a) => live && setAccounts(a), () => live && setAccounts([]));
    return () => {
      live = false;
    };
  }, [local]);
  if (wallets.length === 0) return null;
  return (
    <details className="wp-dev" open={TEST_WALLET || undefined}>
      <summary>{WALLET.developer}</summary>
      <p className="wp-dev-note">{WALLET.developerNote}</p>
      <fieldset className="wallet-choice">
        <legend>{WALLET.wallet}</legend>
        {wallets.map((w) => (
          <button key={w.id} type="button" className="choice" aria-pressed={wallet === w.id} onClick={() => setWallet(w.id)} data-wallet={w.id}>
            {w.name}
          </button>
        ))}
      </fieldset>
      <label className="field">
        <span>{WALLET.account}</span>
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder={`you.${NEAR_NETWORK}`} spellCheck={false} autoComplete="username" list={local ? "local-signer-accounts" : undefined} />
        {local && (
          <datalist id="local-signer-accounts">
            {accounts.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        )}
      </label>
      {local && (
        <p className="local-signer-note" role="note">
          {WALLET.localSigner}
        </p>
      )}
      <button
        type="button"
        className="btn ghost"
        disabled={!account.trim() || !wallet}
        onClick={() => {
          setConnected({ account: account.trim(), wallet: wallet! });
          onDone();
        }}
      >
        {WALLET.save}
      </button>
    </details>
  );
}

/**
 * The connect panel: the wallet picker. It closes as soon as a wallet connects; the header then shows the
 * Joined control, and the account menu and the Balance page carry everything the old connected view did.
 */
export function WalletPanel({ onClose, anchor }: { onClose: () => void; anchor?: HTMLElement | null }) {
  const connected = useConnected();
  const was = useRef(connected);
  useEffect(() => {
    if (connected && connected !== was.current) onClose();
    was.current = connected;
  }, [connected, onClose]);
  return (
    <Dialog title={WALLET.title} onClose={onClose} testId="connect-dialog" anchor={anchor} className="wp-panel" mark={<HorizonMark size={20} step={20} className="wp-mark" />}>
      <p className="dlg-lede wp-lede">{WALLET.lede}</p>
      <Picker onConnected={onClose} onCancel={onClose} />
      <Developer onDone={onClose} />
    </Dialog>
  );
}
