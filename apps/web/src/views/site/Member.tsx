/** Connecting a wallet, joining the Mutual, and the member card with redemption. */
import { useEffect, useMemo, useRef, useState } from "react";
import { toAtomic, type PoolPosition, type PoolView } from "../../api/ai";
import { Problem } from "../../components/Problem";
import { TxLink } from "../../components/TxLink";
import { getPosition, localSignerAccounts } from "../../data/mutual";
import { addPending } from "../../data/transactions";
import { DATA_SOURCE } from "../../data/source";
import { planDeposit, sendDeposit, type DepositPlan } from "../../data/wallet-pool";
import { navigate } from "../../router";
import { HOME, JOIN, MEMBER, WALLET } from "../../brand";
import { Dialog } from "../../components/Dialog";
import { HorizonMark } from "../../components/HorizonMark";
import { NEAR_NETWORK } from "../../config";
import { formatUsdc } from "../../format";
import { setConnected, useConnected, type Connected } from "../../wallets/connected";
import { personalSphere } from "../../v2/sphere";
import { nearWallets, typesAccount, type NearWalletId } from "../../wallets/near";
import { WalletPanel } from "../../wallets/WalletPanel";
import { countdown, price, signMutual, useNow } from "./Mutual";

/** Wallets that sign as a typed account: the e2e test wallet and the local test signer. NEAR Connect never does. */
function WalletPick({ value, onChange }: { value: NearWalletId | null; onChange: (w: NearWalletId) => void }) {
  const wallets = useMemo(() => nearWallets(), []);
  if (wallets.length < 2) return null;
  return (
    <fieldset className="wallet-choice">
      <legend>{WALLET.wallet}</legend>
      {wallets.map((w) => (
        <button key={w.id} type="button" className="choice" aria-pressed={value === w.id} onClick={() => onChange(w.id)} data-wallet={w.id}>
          {w.name}
        </button>
      ))}
    </fieldset>
  );
}

/** Account and wallet fields, prefilled from the connected wallet. NEAR Connect is the default. */
function useWalletFields(connected: Connected | null) {
  const [account, setAccount] = useState(connected && typesAccount(connected.wallet) ? connected.account : "");
  const [wallet, setWallet] = useState<NearWalletId | null>(connected?.wallet ?? nearWallets()[0]?.id ?? null);
  return { account, setAccount, wallet, setWallet };
}
type WalletFieldsState = ReturnType<typeof useWalletFields>;

/** The typed account field, only for the test wallet and the local test signer. */
function TypedAccount({ f, label }: { f: WalletFieldsState; label: string }) {
  const local = f.wallet === "local-signer";
  const [accounts, setAccounts] = useState<string[]>([]);
  useEffect(() => {
    if (!local) return;
    let live = true;
    localSignerAccounts().then((a) => live && setAccounts(a), () => live && setAccounts([]));
    return () => {
      live = false;
    };
  }, [local]);
  if (!typesAccount(f.wallet)) return null;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <input value={f.account} onChange={(e) => f.setAccount(e.target.value)} placeholder={`you.${NEAR_NETWORK}`} spellCheck={false} autoComplete="username" list={local ? "local-signer-accounts" : undefined} />
        {local && (
          <datalist id="local-signer-accounts">
            {accounts.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        )}
      </label>
      {local && <p className="local-signer-note" role="note">{WALLET.localSigner}</p>}
    </>
  );
}

/** Join's connect step: opens the same wallet panel as the header. The account comes from the wallet. */
function NearConnectButton({ className = "btn wide" }: { onConnected?: (account: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} data-testid="near-connect" onClick={() => setOpen(true)}>
        {WALLET.connect}
      </button>
      {open && <WalletPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/** Connect wallet: one Horizon panel where a click on a wallet's logo connects it (wallets/WalletPanel.tsx). */
export function ConnectDialog({ onClose, anchor }: { onClose: () => void; anchor?: HTMLElement | null }) {
  return <WalletPanel onClose={onClose} {...(anchor !== undefined ? { anchor } : {})} />;
}

/** The header: "Connect wallet", or the connected account, which opens #/me. */
export function ConnectWallet() {
  const connected = useConnected();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (connected) {
    return (
      <a className="btn ghost sm acct-btn" href="#/me" data-testid="connect-wallet" aria-label={WALLET.yourShare(connected.account)}>
        {connected.wallet === "local-signer" && <span className="local-badge">{WALLET.localBadge}</span>}
        <span className="acct">{connected.account}</span>
      </a>
    );
  }
  return (
    <>
      <button ref={button} type="button" className="btn ghost sm" onClick={() => setOpen(true)} data-testid="connect-wallet" aria-haspopup="dialog" aria-expanded={open}>
        {WALLET.connect}
      </button>
      {open && <ConnectDialog onClose={() => setOpen(false)} anchor={button.current} />}
    </>
  );
}

type JoinStep = { step: "form" } | { step: "approving"; usdc: string } | { step: "done"; ward: string; tx: string };

const nearText = (yocto: bigint): string => (Number(yocto / 1_000_000_000_000_000_000n) / 1_000_000).toFixed(3);

/** Join the Mutual: amount, what you receive, our stake in front, then the wallet signs the deposit. */
export function JoinDialog({ pool, onClose, onJoined, minDeposit = "1000000" }: { pool: PoolView; onClose: () => void; onJoined: () => void; minDeposit?: string }) {
  const connected = useConnected();
  const f = useWalletFields(connected);
  const [changing, setChanging] = useState(false);
  const [amount, setAmount] = useState("25");
  const [state, setState] = useState<JoinStep>({ step: "form" });
  const [error, setError] = useState<unknown>(null);
  // On testnet with NEAR Connect: balances, registration and WARD before, read before the click.
  const [plan, setPlan] = useState<DepositPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  // Each signing attempt gets a number; Stop waiting moves it on, so a late wallet answer is ignored.
  const attempt = useRef(0);
  const atomic = toAtomic(amount);
  const belowMin = atomic !== null && BigInt(atomic) < BigInt(minDeposit);
  const ward = atomic ? ((BigInt(atomic) * 1_000_000n) / BigInt(pool.ward_price)).toString() : null;
  const usdcText = atomic ? formatUsdc(atomic) : "0.00";
  const viaWallet = f.wallet === "near-connect";
  const onChain = viaWallet && DATA_SOURCE === "testnet";
  const account = viaWallet ? (connected?.wallet === "near-connect" ? connected.account : "") : f.account.trim();
  const showFields = !connected || changing;

  useEffect(() => {
    setPlan(null);
    if (!onChain || !account || !atomic || belowMin) return;
    let live = true;
    setPlanning(true);
    const t = window.setTimeout(() => {
      planDeposit(account, atomic)
        .then(
          (p) => {
            if (!live) return;
            setPlan(p);
            setError(null);
          },
          (e: unknown) => {
            if (live) setError(e);
          },
        )
        .finally(() => {
          if (live) setPlanning(false);
        });
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [onChain, account, atomic, belowMin]);

  const deposit = () => {
    if (!atomic) return setError(new Error(JOIN.badAmount));
    if (!f.wallet || !account) return;
    if (onChain && (!plan || plan.problem)) return;
    const mine = ++attempt.current;
    const wallet = f.wallet;
    setError(null);
    setState({ step: "approving", usdc: atomic });
    // Straight to the wallet: on testnet every check already ran in planDeposit.
    const sent = onChain && plan ? sendDeposit(plan) : signMutual(wallet, { account, action: "deposit", amount: atomic });
    sent.then(
      (res) => {
        if (mine !== attempt.current) return;
        setConnected({ account, wallet });
        setState({ step: "done", ward: res.ward ?? "0", tx: res.tx ?? "" });
        // Your transactions shows it at once, as Pending, until the chain returns it.
        if (res.tx) addPending(account, { hash: res.tx, type: "buy", usdc: atomic, ward: res.ward ?? null });
        onJoined();
      },
      (e: unknown) => {
        if (mine !== attempt.current) return;
        setError(e);
        setState({ step: "form" });
      },
    );
  };

  const ready = !!atomic && !belowMin && !!account && !!f.wallet && (!onChain || (!!plan && !plan.problem && !planning));
  return (
    <Dialog title={JOIN.title} onClose={onClose} testId="join-dialog">
      {state.step === "form" && (
        <>
          <p className="dlg-lede">{JOIN.lede}</p>
          <label className="field">
            <span>{JOIN.amount}</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="num amount-input" />
          </label>
          <div className="quick" role="group" aria-label={JOIN.quickLabel}>
            {JOIN.quick.map((q) => (
              <button key={q} type="button" className="choice num" aria-pressed={amount === String(q)} onClick={() => setAmount(String(q))}>
                {q}
              </button>
            ))}
          </div>
          <dl className="join-facts">
            <div>
              <dt>{ward ? JOIN.receive(formatUsdc(ward)) : JOIN.receive("0.00")}</dt>
              <dd className="num">{JOIN.atPrice(price(pool.ward_price))}</dd>
            </div>
            <div>
              <dt>{JOIN.stake}</dt>
              <dd className="num">{formatUsdc(pool.junior)} USDC</dd>
            </div>
          </dl>
          <p className="hint">{JOIN.stakeNote}</p>
          {showFields || !account ? (
            <>
              <WalletPick value={f.wallet} onChange={f.setWallet} />
              {viaWallet && !account && <NearConnectButton className="btn ghost wide" onConnected={() => setChanging(false)} />}
              <TypedAccount f={f} label={JOIN.account} />
            </>
          ) : (
            <div className="dlg-from" data-testid="join-from">
              <span>
                {JOIN.from} <b className="acct">{account}</b>
              </span>
              <button type="button" className="link" onClick={() => setChanging(true)}>
                {JOIN.change}
              </button>
            </div>
          )}
          {onChain && account && planning && (
            <p className="hint" role="status">
              {JOIN.checking}
            </p>
          )}
          {onChain && plan && (
            <p className="hint num" data-testid="join-balances">
              {JOIN.balances(formatUsdc(plan.usdc.toString()), nearText(plan.near))}
              {!plan.registered && <> {JOIN.register}</>}
            </p>
          )}
          {belowMin && <Problem error={{ code: "BELOW_MINIMUM" }} compact />}
          {!belowMin && plan?.problem && <Problem error={{ code: plan.problem.code }} compact />}
          {error !== null && !belowMin && <Problem error={error} compact />}
          <button type="button" className="btn wide" disabled={!ready} onClick={deposit}>
            {JOIN.deposit(usdcText)}
          </button>
        </>
      )}
      {state.step === "approving" && (
        <div className="dlg-wait" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <b>{JOIN.approving}</b>
            <p className="muted">{JOIN.approvingNote}</p>
            <button
              type="button"
              className="btn ghost sm dlg-stop"
              onClick={() => {
                attempt.current++;
                setState({ step: "form" });
              }}
            >
              {JOIN.stopWaiting}
            </button>
          </div>
        </div>
      )}
      {state.step === "done" && (
        <div className="dlg-done" role="status" data-testid="join-done">
          <HorizonMark size={56} />
          <b className="num">{JOIN.received(formatUsdc(state.ward))}</b>
          <p className="muted">{JOIN.receivedNote}</p>
          <p className="tx">
            <TxLink hash={state.tx} />
          </p>
          <button
            type="button"
            className="btn wide"
            onClick={() => {
              onClose();
              navigate("#/wallet");
            }}
          >
            {JOIN.goToShare}
          </button>
        </div>
      )}
    </Dialog>
  );
}

/** The dark member card: balance, WARD held, account, and redemption. */
export function MemberCard({ pool, version, onJoin, onChanged }: { pool: PoolView; version: number; onJoin: () => void; onChanged: () => void }) {
  const connected = useConnected();
  const now = useNow();
  const [position, setPosition] = useState<PoolPosition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [doneTx, setDoneTx] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return setPosition(null);
    let live = true;
    getPosition(connected.account).then(
      (p) => live && setPosition(p),
      () => live && setPosition(null),
    );
    return () => {
      live = false;
    };
  }, [connected?.account, version]);

  const act = async (body: { action: "withdraw"; amount: string } | { action: "redeem"; id: string }) => {
    if (!connected) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await signMutual(connected.wallet, { account: connected.account, ...body });
      if (res.position) setPosition(res.position);
      setDoneTx(res.tx ?? null);
      if (res.tx) addPending(connected.account, body.action === "withdraw" ? { hash: res.tx, type: "sell_request", ward: body.amount, unlock_at: res.available_at ?? null } : { hash: res.tx, type: "sell", usdc: res.usdc ?? null });
      setDone(body.action === "withdraw" ? MEMBER.locked7(res.available_at?.slice(0, 10) ?? "") : MEMBER.redeemed(formatUsdc(res.usdc ?? "0")));
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const held = position ? BigInt(position.ward) + BigInt(position.ward_locked) : 0n;
  return (
    <div className="member-card" data-testid="member-card">
      {/* The member's own sphere when connected (the same seed as the Balance page), the Horizon mark otherwise. */}
      <HorizonMark size={120} className="member-horizon" {...(connected ? { light: personalSphere(connected.account).light, step: 18 } : { step: 18 })} />
      <span className="mc-label">{MEMBER.title}</span>
      {!connected || !position || held === 0n ? (
        <>
          <b className="mc-value">{MEMBER.notMember}</b>
          <dl className="mc-quote num" data-testid="member-quote">
            <div>
              <dt>{MEMBER.quoteDeposit}</dt>
              <dd>{formatUsdc(String(MEMBER.quoteAmount * 1_000_000))} USDC</dd>
            </div>
            <div>
              <dt>{MEMBER.quoteReceive}</dt>
              <dd>{formatUsdc(((BigInt(MEMBER.quoteAmount * 1_000_000) * 1_000_000n) / BigInt(pool.ward_price)).toString())} WARD</dd>
            </div>
            <div>
              <dt>{MEMBER.quotePrice}</dt>
              <dd>{price(pool.ward_price)} USDC</dd>
            </div>
            <div>
              <dt>{MEMBER.quoteStake}</dt>
              <dd>{formatUsdc(pool.junior)} USDC</dd>
            </div>
          </dl>
          <button type="button" className="btn" onClick={onJoin}>
            {HOME.primary}
          </button>
        </>
      ) : (
        <div data-testid="pool-position">
          <b className="mc-value num">{formatUsdc(position.value)} USDC</b>
          <dl className="mc-facts">
            <div>
              <dt>{MEMBER.held}</dt>
              <dd className="num">{formatUsdc(held.toString())} WARD</dd>
            </div>
            <div>
              <dt>{MEMBER.account}</dt>
              <dd className="acct">{position.account}</dd>
            </div>
            {position.ward_locked !== "0" && (
              <div>
                <dt>{MEMBER.locked}</dt>
                <dd className="num">{formatUsdc(position.ward_locked)} WARD</dd>
              </div>
            )}
          </dl>
          {position.pending_withdrawals.map((w) => {
            const left = countdown(w.available_at, now);
            return (
              <p key={w.id} className="mc-pending num" data-testid="redemption">
                {formatUsdc(w.ward)} WARD, {formatUsdc(w.value)} USDC today.{" "}
                {left ? (
                  <span>
                    {MEMBER.unlocksIn} {left}
                  </span>
                ) : (
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void act({ action: "redeem", id: w.id })}>
                    {MEMBER.redeemNow}
                  </button>
                )}
              </p>
            );
          })}
          <p className="mc-manage">
            <a className="link" href="#/wallet">
              {MEMBER.manage}
            </a>
          </p>
        </div>
      )}
      {error !== null && <Problem error={error} compact />}
      {done && (
        <p className="ok-line" role="status" data-testid="pool-done">
          {done} {doneTx && <TxLink hash={doneTx} />}
        </p>
      )}
    </div>
  );
}

