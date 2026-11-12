/**
 * The header's wallet control (docs/design/v2/BalancePage.dc.html, BalanceButtons.dc.html option 3, "Joined").
 * Not connected: a Sheen "Connect wallet" that opens the wallet picker. Connected: one pill. Its left half,
 * "Balance" and the share's live value, opens the Balance page (#/wallet); its right half, the member's
 * mini sphere, account name and a chevron, opens the account menu.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { WALLET } from "../brand";
import { HorizonMark } from "../components/HorizonMark";
import { getPosition } from "../data/mutual";
import { formatUsdc } from "../format";
import { navigate } from "../router";
import { personalSphere } from "../v2/sphere";
import { walletName } from "./catalog";
import { setConnected, useConnected, type Connected } from "./connected";
import { disconnectNear, nearWallets } from "./near";
import { WalletPanel } from "./WalletPanel";
import "./account.css";

/** The Balance page asks the header to read the share again after a deposit or a sale. */
export const SHARE_CHANGED = "wardline:share-changed";
export const shareChanged = (): void => {
  window.dispatchEvent(new Event(SHARE_CHANGED));
};

/** The connected account's share value in atomic USDC, read again every 30 seconds and after a change. */
export function useShareValue(account: string | null): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    setValue(null);
    if (!account) return;
    let live = true;
    const read = () =>
      getPosition(account).then(
        (p) => live && setValue(typeof p.value === "string" ? p.value : null),
        () => undefined,
      );
    void read();
    const timer = window.setInterval(read, 30_000);
    window.addEventListener(SHARE_CHANGED, read);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener(SHARE_CHANGED, read);
    };
  }, [account]);
  return value;
}

/** The member's own sphere, small: the same seed as the big one on the Balance page. */
export function MiniSphere({ account, size = 22 }: { account: string; size?: number }) {
  const seed = personalSphere(account);
  return <HorizonMark size={size} light={seed.light} step={34} className="acct-sphere" />;
}

export function disconnectWallet(connected: Connected | null): void {
  if (connected?.wallet === "near-connect") void disconnectNear();
  setConnected(null);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

const Chevron = () => (
  <svg className="acct-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const ICONS = {
  balance: <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18" />,
  copy: <path d="M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM5 15V5a2 2 0 0 1 2-2h10" />,
  check: <path d="M5 12l5 5L20 7" />,
  switch: <path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3" />,
  out: <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11" />,
};
const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

/**
 * The account menu: who is connected and with which wallet, then Open your balance, Copy account name,
 * Connect a different wallet and Disconnect. Arrow keys move between items, Escape closes it and focus
 * goes back to the account button.
 */
export function AccountMenu({ connected, onClose, onSwitch, onDisconnect }: { connected: Connected; onClose: (focusBack: boolean) => void; onSwitch: () => void; onDisconnect: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const headId = useId();
  const via = walletName(connected.via) ?? (connected.wallet === "near-connect" ? null : (nearWallets().find((w) => w.id === connected.wallet)?.name ?? null));
  const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    items()[0]?.focus();
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || (target instanceof Element && target.closest("[data-account-trigger]"))) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") onClose(true);
    else if (e.key === "Tab") return onClose(false);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={menu} className="acct-menu" data-testid="account-menu">
      <div className="acct-menu-head" id={headId}>
        {via && <span className="acct-menu-via">{WALLET.via(via)}</span>}
        <span className="acct-menu-name acct">{connected.account}</span>
      </div>
      <div role="menu" aria-label={WALLET.menuLabel} aria-describedby={headId} onKeyDown={onKey}>
      <button
        type="button"
        role="menuitem"
        className="acct-item"
        onClick={() => {
          onClose(false);
          navigate("#/wallet");
        }}
      >
        <Icon name="balance" />
        {WALLET.openBalance}
      </button>
      <button type="button" role="menuitem" className="acct-item" data-testid="copy-account" onClick={() => void copyText(connected.account).then(() => setCopied(true))}>
        <Icon name={copied ? "check" : "copy"} />
        {copied ? WALLET.copied : WALLET.copyAccount}
      </button>
      <button type="button" role="menuitem" className="acct-item" onClick={onSwitch}>
        <Icon name="switch" />
        {WALLET.connectDifferent}
      </button>
      <div className="acct-menu-rule" role="separator" />
      <button type="button" role="menuitem" className="acct-item acct-quiet" data-testid="disconnect" onClick={onDisconnect}>
        <Icon name="out" />
        {WALLET.disconnect}
      </button>
      </div>
      <span className="sr-only" role="status">
        {copied ? WALLET.copiedStatus(connected.account) : ""}
      </span>
    </div>
  );
}

/** The header control: Connect wallet, or the Joined pill and its menu. */
export function AccountControl({ onBalance }: { onBalance: boolean }) {
  const connected = useConnected();
  const value = useShareValue(connected?.account ?? null);
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const accountButton = useRef<HTMLButtonElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  // After Disconnect, focus lands on the Connect wallet button that replaces the pill.
  const focusConnect = useRef(false);

  useEffect(() => {
    if (!connected && focusConnect.current) {
      focusConnect.current = false;
      connectButton.current?.focus();
    }
  }, [connected]);

  const closeMenu = useCallback((focusBack: boolean) => {
    setMenu(false);
    if (focusBack) accountButton.current?.focus();
  }, []);

  if (!connected) {
    return (
      <>
        <button ref={connectButton} type="button" className="btn sm acct-connect" onClick={() => setPicker(true)} data-testid="connect-wallet" aria-haspopup="dialog" aria-expanded={picker}>
          {WALLET.connect}
        </button>
        {picker && <WalletPanel onClose={() => setPicker(false)} anchor={connectButton.current} />}
      </>
    );
  }

  return (
    <div className="acct-wrap">
      <div className="seg" data-testid="account-control">
        <button type="button" className="seg-balance" onClick={() => navigate("#/wallet")} {...(onBalance ? { "aria-current": "page" as const } : {})} data-testid="balance-button">
          <span className="seg-k">{WALLET.balance}</span>
          <span className="num seg-v">{value === null ? "…" : `${formatUsdc(value)} USDC`}</span>
        </button>
        <i aria-hidden="true" />
        <button
          ref={accountButton}
          type="button"
          className="seg-account"
          data-account-trigger
          data-testid="connect-wallet"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={WALLET.accountMenu(connected.account)}
          onClick={() => setMenu((m) => !m)}
        >
          <MiniSphere account={connected.account} />
          {connected.wallet === "local-signer" && <span className="local-badge">{WALLET.localBadge}</span>}
          <span className="seg-name acct">{connected.account}</span>
          <Chevron />
        </button>
      </div>
      {menu && (
        <AccountMenu
          connected={connected}
          onClose={closeMenu}
          onSwitch={() => {
            setMenu(false);
            disconnectWallet(connected);
            setPicker(true);
          }}
          onDisconnect={() => {
            setMenu(false);
            focusConnect.current = true;
            disconnectWallet(connected);
          }}
        />
      )}
      {picker && <WalletPanel onClose={() => setPicker(false)} anchor={accountButton.current} />}
    </div>
  );
}
