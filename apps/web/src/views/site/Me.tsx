/** #/me: the connected wallet's share. Position, the price since launch, votes, redemption and history. */
import { useCallback, useEffect, useState } from "react";
import { ME, SHARE } from "../../brand";
import { HorizonMark } from "../../components/HorizonMark";
import { PriceChart } from "../../components/PriceChart";
import { Problem } from "../../components/Problem";
import { TxLink } from "../../components/TxLink";
import { getPerson, type Person } from "../../data/people";
import { signMutual } from "../../data/mutual";
import { formatUsdc } from "../../format";
import { useConnected } from "../../wallets/connected";
import { Proposal } from "./Governance";
import { ConnectDialog, JoinDialog } from "./Member";
import { countdown, price, useNow } from "./Mutual";

type Load = { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; person: Person };

/** Value + redeemed - deposited. Undefined when the backend does not track deposits. */
function earned(p: Person["position"]): bigint | null {
  if (p.deposited === undefined || p.redeemed === undefined) return null;
  return BigInt(p.value) + BigInt(p.redeemed) - BigInt(p.deposited);
}

/** Rounding when WARD is minted can leave a fraction of a cent; under one cent counts as nothing. */
const CENT = 10_000n;
const signedUsdc = (atomic: bigint): string => (atomic > -CENT && atomic < CENT ? "0.00" : `${atomic < 0n ? "-" : "+"}${formatUsdc((atomic < 0n ? -atomic : atomic).toString())}`);

/** The page's layout while it loads, so nothing shifts when the numbers arrive. */
function Skeleton() {
  return (
    <div className="me-grid" aria-hidden="true" data-testid="me-loading">
      <div className="value-card skel-card" />
      <div className="panel skel-card tall" />
    </div>
  );
}

function Redemptions({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const connected = useConnected();
  const now = useNow();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pending = person.position.pending_withdrawals;
  if (pending.length === 0) return null;
  const redeem = async (id: string) => {
    if (!connected) return;
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
    <section className="panel pb me-redeem" aria-labelledby="me-redeem-title">
      <h2 id="me-redeem-title">{ME.redemption}</h2>
      <ul className="me-list">
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
    </section>
  );
}

function Sources({ person }: { person: Person }) {
  const joined = person.position.joined_at ? Date.parse(person.position.joined_at) : 0;
  // Deposits and redemptions never move the price, so only real changes are listed.
  const history = person.mutual.pool.price_history.filter((h) => Date.parse(h.at) > joined && h.event !== "deposit" && h.event !== "redeem");
  const claims = [...person.mutual.claims].reverse().filter((c) => c.status === "paid" && Date.parse(c.filed_at) > joined);
  let ci = 0;
  return (
    <section className="panel" aria-labelledby="me-sources-title">
      <div className="ph">
        <h2 id="me-sources-title">{ME.sources}</h2>
      </div>
      <p className="panel-lede">{ME.sourcesLede}</p>
      <ol className="sources">
        {person.position.deposited && person.position.deposited !== "0" && (
          <li data-event="joined">
            <span>
              {ME.youDeposited(formatUsdc(person.position.deposited))}
              {person.position.joined_at && <small>{ME.joined(person.position.joined_at.slice(0, 10))}</small>}
            </span>
            <span className="num">{formatUsdc(person.position.deposited)}</span>
          </li>
        )}
        {history.map((h, i) => {
          const claim = h.event === "claim" ? claims[ci++] : undefined;
          return (
            <li key={`${h.at}-${i}`} data-event={h.event} className={claim && claim.paid_from_senior !== "0" ? "below" : ""}>
              <span>
                {SHARE.events[h.event]}
                {claim && (
                  <small>
                    {SHARE.coveredByUs(formatUsdc(claim.paid_from_junior))}
                    {claim.paid_from_senior !== "0" && `. ${SHARE.coveredByWard(formatUsdc(claim.paid_from_senior))}`} <TxLink hash={claim.tx} plain={false} />
                  </small>
                )}
              </span>
              <span className="num">{price(h.price)}</span>
            </li>
          );
        })}
        {history.length === 0 && <li data-event="none" className="muted">{ME.noPriceChange}</li>}
      </ol>
    </section>
  );
}

function Votes({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const connected = useConnected();
  const now = useNow();
  const voter = { account: connected?.account ?? "", wallet: connected?.wallet ?? null };
  const byId = new Map(person.mutual.governance.proposals.map((p) => [p.id, p]));
  return (
    <>
      <section className="me-votes" aria-labelledby="me-open-title">
        <h2 className="gov-h" id="me-open-title">
          {ME.openVotes}
        </h2>
        {person.open.length === 0 ? (
          <p className="empty">{ME.openNone}</p>
        ) : (
          <div className="props">
            {person.open.map((p) => (
              <div key={p.id} className="me-vote" data-testid="me-open-vote">
                <p className="me-weight num">{person.weights[p.id] && person.weights[p.id] !== "0" ? ME.weight(formatUsdc(person.weights[p.id]!)) : ME.noWeight}</p>
                <Proposal p={p} voter={voter} now={now} onChange={onChanged} />
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="me-votes" aria-labelledby="me-past-title">
        <h2 className="gov-h" id="me-past-title">
          {ME.pastVotes}
        </h2>
        {person.votes.length === 0 ? (
          <p className="empty">{ME.pastNone}</p>
        ) : (
          <ul className="me-list" data-testid="me-past-votes">
            {person.votes.map((v) => {
              const p = byId.get(v.id);
              return (
                <li key={v.id}>
                  <span>
                    <span className="prop-n">{v.id}</span> {p?.description ?? ""}
                  </span>
                  <span className="num">
                    <b className={v.support === "for" ? "vote-for" : "vote-against"}>{v.support === "for" ? ME.votedFor : ME.votedAgainst}</b>, {formatUsdc(v.weight)} WARD
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

export function Me() {
  const connected = useConnected();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [joining, setJoining] = useState(false);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

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

  const person = load.state === "ready" && load.person.account === connected?.account ? load.person : null;
  const held = person ? BigInt(person.position.ward) + BigInt(person.position.ward_locked) : 0n;
  const gain = person ? earned(person.position) : null;

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <h1 className="h1">{ME.title}</h1>
          <p className="lede">{ME.lede}</p>
        </div>
      </section>
      <section className="sec tight me">
        <div className="wrap">
          {!connected && (
            <div className="me-empty" data-testid="me-connect">
              <p>{ME.connectTitle}</p>
              <button type="button" className="btn" onClick={() => setConnecting(true)}>
                {ME.connect}
              </button>
            </div>
          )}
          {connected && load.state === "loading" && <Skeleton />}
          {connected && load.state === "error" && <Problem error={load.error} onRetry={refresh} />}
          {connected && person && held === 0n && person.position.pending_withdrawals.length === 0 && (
            <div className="me-empty" data-testid="me-empty">
              <p>{ME.empty}</p>
              <button type="button" className="btn" onClick={() => setJoining(true)}>
                {ME.join}
              </button>
            </div>
          )}
          {connected && person && (held > 0n || person.position.pending_withdrawals.length > 0) && (
            <div className="me-body" data-testid="me-position">
              <div className="me-grid">
                <div className="value-card">
                  <HorizonMark size={220} className="value-horizon" />
                  <span className="vc-label">{ME.value}</span>
                  <b className="vc-value num">{formatUsdc(person.position.value)} USDC</b>
                  <dl className="vc-facts">
                    <div>
                      <dt>{ME.held}</dt>
                      <dd className="num">{formatUsdc(held.toString())} WARD</dd>
                    </div>
                    {gain !== null && (
                      <div>
                        <dt>{ME.earned}</dt>
                        <dd className={gain <= -CENT ? "num below-text" : "num"} data-testid="me-earned">
                          {signedUsdc(gain)} USDC
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>{ME.account}</dt>
                      <dd className="acct">{connected.account}</dd>
                    </div>
                  </dl>
                  {person.position.joined_at && <p className="vc-note">{ME.joined(person.position.joined_at.slice(0, 10))}</p>}
                  <button type="button" className="btn ghost sm" onClick={() => setConnecting(true)}>
                    {ME.change}
                  </button>
                </div>
                <div className="panel chart-panel">
                  <div className="ph">
                    <h2>{ME.chart}</h2>
                  </div>
                  <div className="pb">
                    <PriceChart history={person.mutual.pool.price_history} launch={person.mutual.pool.launch_price} />
                    <p className="fine">{SHARE.chartNote}</p>
                  </div>
                </div>
              </div>
              <Redemptions person={person} onChanged={refresh} />
              <Votes person={person} onChanged={refresh} />
              <Sources person={person} />
            </div>
          )}
        </div>
      </section>
      {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}
      {joining && person && <JoinDialog pool={person.mutual.pool} onClose={() => setJoining(false)} onJoined={refresh} />}
    </main>
  );
}
