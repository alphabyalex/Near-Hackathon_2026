/**
 * The Balance page, #/wallet (docs/design/v2/BalancePage.dc.html). Your share and the old wallet panel,
 * merged: the personal sphere on the left; on the right the total (wallet plus share), then plain rows for
 * USDC (Deposit) and WARD (Request to sell), a quiet NEAR-for-fees line, the votes you can cast, and recent
 * transactions. #/me redirects here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BALANCE, ME, SHARE } from "../../brand";
import { HorizonMark } from "../../components/HorizonMark";
import { PriceChart } from "../../components/PriceChart";
import { Problem } from "../../components/Problem";
import { ftBalance, spendableNear } from "../../data/chain";
import { signMutual } from "../../data/mutual";
import { getPerson, type Person } from "../../data/people";
import { DATA_SOURCE } from "../../data/source";
import { confirmedTotals, useTransactions, type WalletTx } from "../../data/transactions";
import { MIN_NEAR_FOR_FEES, poolContracts } from "../../data/wallet-pool";
import { formatUsdc } from "../../format";
import { PersonalMark, SellForm } from "../../v2/ShareHero";
import { shareChanged } from "../../wallets/AccountControl";
import { useConnected, type Connected } from "../../wallets/connected";
import { WalletPanel } from "../../wallets/WalletPanel";
import { Proposal } from "./Governance";
import { JoinDialog } from "./Member";
import { countdown, price, useNow } from "./Mutual";
import { label, Transactions, when } from "./Transactions";
import "./balance.css";

type Load = { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; person: Person };

const RECENT = 5;
/** Rounding when WARD is minted can leave a fraction of a cent; under one cent counts as nothing. */
const CENT = 10_000n;
const nearText = (yocto: bigint): string => (Number(yocto / 1_000_000_000_000_000_000n) / 1_000_000).toFixed(3);
/** The quiet NEAR line, which turns into a warning under 0.05 NEAR (G). */
export function nearFees(near: bigint): { text: string; low: boolean } {
  const low = near < MIN_NEAR_FOR_FEES;
  return { text: low ? BALANCE.lowFees(nearText(near)) : BALANCE.fees(nearText(near)), low };
}
const signedUsdc = (atomic: bigint): string => (atomic > -CENT && atomic < CENT ? "0.00" : `${atomic < 0n ? "-" : "+"}${formatUsdc((atomic < 0n ? -atomic : atomic).toString())}`);

/** The wallet's own USDC and NEAR, read from the chain. Sim mode has no wallet balances. */
function useWalletBalances(account: string | null, tick: number): { usdc: bigint; near: bigint } | null {
  const [balances, setBalances] = useState<{ usdc: bigint; near: bigint } | null>(null);
  useEffect(() => {
    if (!account || DATA_SOURCE !== "testnet") return setBalances(null);
    let live = true;
    (async () => {
      const { token } = await poolContracts();
      const [usdc, near] = await Promise.all([ftBalance(token, account), spendableNear(account)]);
      if (live) setBalances({ usdc, near });
    })().catch(() => live && setBalances(null));
    return () => {
      live = false;
    };
  }, [account, tick]);
  return balances;
}

/** WARD locked for the 7-day wait, with Redeem once it is over. */
function Redemptions({ person, connected, onChanged }: { person: Person; connected: Connected; onChanged: () => void }) {
  const now = useNow();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pending = person.position.pending_withdrawals;
  if (pending.length === 0) return null;
  const redeem = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await signMutual(connected.wallet, { account: connected.account, action: "redeem", id });
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bal-sub" aria-label={ME.redemption} role="group">
      <p className="bal-sub-title">{ME.redemption}</p>
      <ul className="bal-redeem">
        {pending.map((w) => {
          const left = countdown(w.available_at, now);
          return (
            <li key={w.id} data-testid="redemption">
              <span className="num">
                {formatUsdc(w.ward)} WARD, {formatUsdc(w.value)} USDC today
              </span>
              {left ? (
                <span className="muted num">{ME.unlocksIn(left)}</span>
              ) : (
                <button type="button" className="btn sm" disabled={busy} onClick={() => void redeem(w.id)}>
                  {ME.unlocked}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error !== null && <Problem error={error} compact />}
    </div>
  );
}

/** "Bought 9.99 WARD for 10.00 USDC"; votes and the rest keep their transaction label. */
function line(r: WalletTx): string {
  const ward = r.ward ? formatUsdc(r.ward) : null;
  const usdc = r.usdc ? formatUsdc(r.usdc) : null;
  if (r.type === "buy" && ward && usdc) return BALANCE.bought(ward, usdc);
  if (r.type === "sell" && ward && usdc) return BALANCE.sold(ward, usdc);
  if (r.type === "sell_request" && ward) return BALANCE.sellRequested(ward);
  return label(r);
}

/** Recent transactions as plain lines, with the full table one click away. */
function Recent({ rows, view, loading }: { rows: WalletTx[]; view: Parameters<typeof Transactions>[0]["view"]; loading: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <section className="bal-recent" aria-labelledby="bal-recent-title" data-testid="me-transactions">
      <div className="bal-head">
        <h2 id="bal-recent-title">{BALANCE.recent}</h2>
        {rows.length > RECENT && (
          <button type="button" className="link" aria-expanded={all} aria-controls="bal-all" onClick={() => setAll((a) => !a)}>
            {all ? BALANCE.hideAll : BALANCE.all}
          </button>
        )}
      </div>
      {all ? (
        <div id="bal-all">
          <Transactions view={view} rows={rows} loading={loading} />
        </div>
      ) : loading && rows.length === 0 ? (
        <p className="muted" role="status">
          {ME.tx.loading}
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">{BALANCE.none}</p>
      ) : (
        <ul className="bal-lines" id="bal-all">
          {rows.slice(0, RECENT).map((r) => (
            <li key={r.hash} data-type={r.type} data-status={r.status}>
              <span className="bal-dot" aria-hidden="true" />
              <span className="bal-what num">{line(r)}</span>
              <time className="muted num" dateTime={r.at}>
                {when(r.at)}
              </time>
              <a href={r.explorer_url} target="_blank" rel="noreferrer" aria-label={BALANCE.viewLabel(r.hash)}>
                {BALANCE.view}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OpenVotes({ person, connected, onChanged }: { person: Person; connected: Connected; onChanged: () => void }) {
  const now = useNow();
  if (person.open.length === 0) return null;
  const voter = { account: connected.account, wallet: connected.wallet };
  return (
    <section className="bal-votes mine-votes" aria-labelledby="bal-votes-title">
      <h2 className="bal-h2" id="bal-votes-title">
        {ME.openVotes}
      </h2>
      <div className="props">
        {person.open.map((p) => (
          <div key={p.id} className="me-vote" data-testid="me-open-vote">
            <p className="me-weight num">{person.weights[p.id] && person.weights[p.id] !== "0" ? ME.weight(formatUsdc(person.weights[p.id]!)) : ME.noWeight}</p>
            <Proposal p={p} voter={voter} now={now} onChange={onChanged} all={person.mutual.governance.proposals} tiers={person.mutual.tiers} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Votes this account cast. Only shown when there are some (on testnet they are in the transactions). */
function PastVotes({ person }: { person: Person }) {
  if (person.votes.length === 0) return null;
  const byId = new Map(person.mutual.governance.proposals.map((p) => [p.id, p]));
  return (
    <section className="bal-past" aria-labelledby="bal-past-title">
      <h2 className="bal-h2" id="bal-past-title">
        {BALANCE.pastVotes}
      </h2>
      <ul className="bal-lines" data-testid="me-past-votes">
        {person.votes.map((v) => (
          <li key={v.id}>
            <span className="bal-what">
              <span className="prop-n">{v.id}</span> {byId.get(v.id)?.description ?? ""}
            </span>
            <span className="num">
              <b className={v.support === "for" ? "vote-for" : "vote-against"}>{v.support === "for" ? ME.votedFor : ME.votedAgainst}</b>, {formatUsdc(v.weight)} WARD
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Balance() {
  const connected = useConnected();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [selling, setSelling] = useState(false);
  const totalRef = useRef<HTMLSpanElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    shareChanged();
  }, []);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    setLoad((l) => (l.state === "ready" ? l : { state: "loading" }));
    getPerson(connected.account).then(
      (person) => live && setLoad({ state: "ready", person }),
      (error: unknown) => live && setLoad({ state: "error", error }),
    );
    return () => {
      live = false;
    };
  }, [connected?.account, tick]);

  const wallet = useWalletBalances(connected?.account ?? null, tick);
  const txs = useTransactions(DATA_SOURCE === "testnet" ? (connected?.account ?? null) : null, tick);
  const loaded = load.state === "ready" && load.person.account === connected?.account ? load.person : null;
  const sums = confirmedTotals(txs.rows);
  const person = loaded && DATA_SOURCE === "testnet" && txs.view ? { ...loaded, position: { ...loaded.position, deposited: sums.deposited, redeemed: sums.redeemed } } : loaded;

  const held = person ? BigInt(person.position.ward) + BigInt(person.position.ward_locked) : 0n;
  const share = person ? BigInt(person.position.value) : 0n;
  const total = share + (wallet?.usdc ?? 0n);
  const p = person?.position;
  const gain = p && p.deposited !== undefined && p.redeemed !== undefined && held > 0n ? BigInt(p.value) + BigInt(p.redeemed) - BigInt(p.deposited) : null;
  const fees = wallet ? nearFees(wallet.near) : null;
  const lowNear = fees?.low ?? false;

  return (
    <main className="balance-page">
      <h1 className="sr-only">{BALANCE.title}</h1>
      {!connected && (
        <section className="sec pagetop">
          <div className="wrap bal-empty" data-testid="me-connect">
            <HorizonMark size={160} step={16} />
            <p className="bal-empty-title">{BALANCE.connectTitle}</p>
            <button ref={connectButton} type="button" className="btn" onClick={() => setConnecting(true)}>
              {BALANCE.connect}
            </button>
          </div>
        </section>
      )}
      {connected && (
        <section className="sec bal-sec">
          <div className="wrap">
            {load.state === "error" && <Problem error={load.error} onRetry={refresh} />}
            <div className="bal-grid" data-testid="me-position" aria-busy={!person}>
              <div className="bal-left">
                <PersonalMark account={connected.account} value={total.toString()} valueRef={totalRef} />
                <p className="bal-acct acct">{connected.account}</p>
              </div>
              <div className="bal-right">
                <p className="bal-k">{BALANCE.label}</p>
                <p className="bal-total">
                  <span ref={totalRef} className="num" data-testid="share-value">
                    {person ? formatUsdc(total.toString()) : "0.00"}
                  </span>
                  <span className="bal-unit">{BALANCE.totalUnit}</span>
                </p>
                <p className="bal-split num">{wallet ? BALANCE.split(formatUsdc(wallet.usdc.toString()), formatUsdc(share.toString())) : BALANCE.shareOnly}</p>
                {gain !== null && (
                  <p className="bal-earned">
                    {BALANCE.earned}{" "}
                    <span className={gain <= -CENT ? "num below-text" : "num"} data-testid="me-earned">
                      {signedUsdc(gain)} USDC
                    </span>
                  </p>
                )}

                <div className="bal-rows" role="list" aria-label={BALANCE.rows}>
                  <div className="bal-row" role="listitem" data-testid="bal-usdc">
                    <span className="bal-ico bal-ico-usdc" aria-hidden="true">
                      $
                    </span>
                    <span className="bal-name">
                      <b>{BALANCE.usdc}</b>
                      <small>{BALANCE.usdcNote}</small>
                    </span>
                    <span className="bal-amt num">{wallet ? formatUsdc(wallet.usdc.toString()) : ""}</span>
                    <span className="bal-act">
                      <button type="button" className="btn sm" onClick={() => setJoining(true)} disabled={!person}>
                        {BALANCE.deposit}
                      </button>
                    </span>
                  </div>
                  <div className="bal-row" role="listitem" data-testid="bal-ward">
                    <HorizonMark size={26} step={34} className="bal-ico" />
                    <span className="bal-name">
                      <b>{BALANCE.ward}</b>
                      <small>{BALANCE.wardNote(person ? price(person.mutual.pool.ward_price) : "1.0000")}</small>
                    </span>
                    <span className="bal-amt num">
                      {formatUsdc(held.toString())}
                      <small>{BALANCE.worth(formatUsdc(share.toString()))}</small>
                    </span>
                    <span className="bal-act">
                      <button type="button" className="btn ghost sm" aria-expanded={selling} disabled={held === 0n} onClick={() => setSelling((s) => !s)}>
                        {BALANCE.sell}
                      </button>
                    </span>
                  </div>
                  {selling && <SellForm connected={connected} onDone={refresh} onClose={() => setSelling(false)} />}
                  {person && <Redemptions person={person} connected={connected} onChanged={refresh} />}
                  {wallet && (
                    <p className={lowNear ? "bal-fees bal-fees-low" : "bal-fees"} data-testid="bal-near" {...(lowNear ? { role: "status" } : {})}>
                      <span className="bal-ico bal-ico-near" aria-hidden="true">
                        N
                      </span>
                      <span className="num">{fees?.text}</span>
                    </p>
                  )}
                </div>

                {person && <OpenVotes person={person} connected={connected} onChanged={refresh} />}
                {DATA_SOURCE === "testnet" && <Recent rows={txs.rows} view={txs.view} loading={!txs.view && !txs.error} />}
                {person && <PastVotes person={person} />}
              </div>
            </div>
            {person && held > 0n && (
              <div className="bal-later">
                <section aria-labelledby="bal-chart-title">
                  <h2 className="bal-h2" id="bal-chart-title">
                    {ME.chart}
                  </h2>
                  <PriceChart history={person.mutual.pool.price_history} launch={person.mutual.pool.launch_price} />
                  <p className="fine">{SHARE.chartNote}</p>
                </section>
              </div>
            )}
          </div>
        </section>
      )}
      {connecting && <WalletPanel onClose={() => setConnecting(false)} anchor={connectButton.current} />}
      {joining && person && <JoinDialog pool={person.mutual.pool} onClose={() => setJoining(false)} onJoined={refresh} />}
    </main>
  );
}
