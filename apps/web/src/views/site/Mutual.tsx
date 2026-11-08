import { useEffect, useMemo, useState } from "react";
import { getPool, getPosition, poolChallenge, poolSubmit, toAtomic, type ClaimView, type PoolPosition, type PoolView } from "../../api/ai";
import { errorText } from "../../api/public";
import { POOL } from "../../brand";
import { NEAR_NETWORK } from "../../config";
import { formatUsdc } from "../../format";
import { fromBase64, nearWallets, signNep413, type NearWalletId } from "../../wallets/near";

const share = (part: string, whole: string): number => (BigInt(whole) === 0n ? 0 : Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100);
/** A price scaled by 1e6 as USDC with four places. */
const price = (scaled: string): string => (Number(BigInt(scaled || "0")) / 1e6).toFixed(4);
/** Atomic WARD (6 decimals) for display. */
const ward = (atomic: string): string => formatUsdc(atomic);

function sinceLaunch(pool: PoolView): string {
  const change = (Number(BigInt(pool.ward_price)) / Number(BigInt(pool.launch_price)) - 1) * 100;
  const rounded = Math.abs(change) < 0.005 ? 0 : change;
  return `${rounded > 0 ? "+" : rounded < 0 ? "-" : ""}${Math.abs(rounded).toFixed(2)}%`;
}

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function countdown(availableAt: string, now: number): string | null {
  const left = Date.parse(availableAt) - now;
  if (left <= 0) return null;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function WardPanel({ pool }: { pool: PoolView }) {
  const change = sinceLaunch(pool);
  return (
    <section className="ward" aria-labelledby="ward-title" data-testid="ward-panel">
      <div className="ward-head">
        <h2 className="h3" id="ward-title">
          {POOL.ward.title} <span className="muted">{POOL.ward.name}</span>
        </h2>
        {pool.trade_url && (
          <a className="btn sm" href={pool.trade_url} target="_blank" rel="noreferrer" data-testid="trade-ward">
            {POOL.ward.trade}
          </a>
        )}
      </div>
      <div className="strip ward-stats">
        <div>
          <div className="l">{POOL.ward.price}</div>
          <div className="v num" data-testid="ward-price">
            {price(pool.ward_price)}
          </div>
          <div className="s">USDC</div>
        </div>
        <div>
          <div className="l">{POOL.ward.sinceLaunch}</div>
          <div className={`v num ${change.startsWith("-") ? "down" : ""}`}>{change}</div>
        </div>
        <div>
          <div className="l">{POOL.ward.supply}</div>
          <div className="v num">{ward(pool.ward_supply)}</div>
          <div className="s">WARD</div>
        </div>
        <div>
          <div className="l">{POOL.ward.fees}</div>
          <div className="v num">{formatUsdc(pool.fees_earned)}</div>
          <div className="s">USDC</div>
        </div>
      </div>
      <div className="ward-copy">
        {POOL.ward.pitch.map((line) => (
          <p key={line} className="ward-pitch">
            {line}
          </p>
        ))}
        <p className="muted">{POOL.ward.kind}</p>
        {pool.trade_url && <p className="muted">{POOL.ward.tradeNote}</p>}
      </div>
    </section>
  );
}

function Stats({ pool }: { pool: PoolView }) {
  const cells: [string, string, string][] = [
    [POOL.stats.tvl, formatUsdc(pool.tvl), "USDC"],
    [POOL.stats.junior, formatUsdc(pool.junior), `${Math.round(share(pool.junior, pool.tvl))}% of TVL`],
    [POOL.stats.senior, formatUsdc(pool.senior), `${Math.round(share(pool.senior, pool.tvl))}% of TVL`],
    [POOL.stats.claims, formatUsdc(pool.claims_paid), "USDC"],
    [POOL.stats.capacity, formatUsdc(pool.coverage_capacity), "USDC"],
  ];
  return (
    <div className="strip pool-stats" data-testid="pool-stats">
      {cells.map(([l, v, s]) => (
        <div key={l}>
          <div className="l">{l}</div>
          <div className="v num">{v}</div>
          <div className="s">{s}</div>
        </div>
      ))}
    </div>
  );
}

/** First-loss on the left, because it pays first. */
function TrancheBar({ pool }: { pool: PoolView }) {
  const junior = share(pool.junior, pool.tvl);
  return (
    <figure className="tranche">
      <figcaption className="label">{POOL.trancheLabel}</figcaption>
      <div className="tranche-bar" role="img" aria-label={`${POOL.stats.junior} ${Math.round(junior)}%, then WARD holders ${Math.round(100 - junior)}%`}>
        <div className="t-junior" style={{ width: `${junior}%` }} />
        <div className="t-senior" style={{ width: `${100 - junior}%` }} />
      </div>
      <div className="tranche-keys">
        <span>
          <i className="k-junior" aria-hidden="true" /> 1. {POOL.stats.junior}, {pool.junior_holder}
        </span>
        <span>
          <i className="k-senior" aria-hidden="true" /> 2. WARD holders
        </span>
      </div>
    </figure>
  );
}

function Position({ position, now, onRedeem, busy }: { position: PoolPosition; now: number; onRedeem: (id: string) => void; busy: boolean }) {
  const none = position.ward === "0" && position.ward_locked === "0";
  return (
    <div className="position" data-testid="pool-position">
      <b>{POOL.position}</b>
      {none ? (
        <span className="muted">{POOL.noPosition}</span>
      ) : (
        <>
          <span className="num">
            {POOL.balance} {ward(position.ward)} WARD, {POOL.worth.toLowerCase()} {formatUsdc(position.value)} USDC
          </span>
          {position.ward_locked !== "0" && (
            <span className="num muted">
              {POOL.locked}: {ward(position.ward_locked)} WARD
            </span>
          )}
          {position.pending_withdrawals.map((w) => {
            const left = countdown(w.available_at, now);
            return (
              <span key={w.id} className="pending num" data-testid="redemption">
                {ward(w.ward)} WARD, {formatUsdc(w.value)} USDC today.{" "}
                {left ? (
                  <span>
                    {POOL.unlocksIn} {left}
                  </span>
                ) : (
                  <button type="button" className="sbtn" disabled={busy} onClick={() => onRedeem(w.id)}>
                    {POOL.redeemNow}
                  </button>
                )}
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}

function DepositRedeem({ pool, onDone }: { pool: PoolView; onDone: () => void }) {
  const wallets = useMemo(() => nearWallets(), []);
  const now = useNow();
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState<NearWalletId | null>(null);
  const [position, setPosition] = useState<PoolPosition | null>(null);
  const [busy, setBusy] = useState<NearWalletId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = async (who: string) => {
    if (!who.trim()) return setPosition(null);
    try {
      setPosition(await getPosition(who.trim()));
    } catch {
      setPosition(null);
    }
  };

  const signAndSend = async (walletId: NearWalletId, body: Parameters<typeof poolChallenge>[0]) => {
    const ch = await poolChallenge(body);
    const signed = await signNep413(walletId, { message: ch.message, recipient: ch.recipient, nonce: fromBase64(ch.nonce) }, body.account);
    return poolSubmit({ nonce: ch.nonce, publicKey: signed.publicKey, signature: signed.signature });
  };

  const go = async (walletId: NearWalletId) => {
    setError(null);
    setDone(null);
    const value = toAtomic(amount);
    if (!value) return setError(action === "deposit" ? "Enter an amount in USDC, up to six decimal places." : "Enter an amount of WARD, up to six decimal places.");
    setBusy(walletId);
    setWallet(walletId);
    try {
      const res = await signAndSend(walletId, { account: account.trim(), action, amount: value });
      setPosition(res.position);
      setDone(action === "deposit" ? `Received ${ward(res.ward ?? "0")} WARD. ${res.tx}` : `WARD locked. Redeemable from ${res.available_at?.slice(0, 10)}. ${res.tx}`);
      setAmount("");
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const redeem = async (id: string) => {
    const walletId = wallet ?? wallets[0]?.id;
    if (!walletId) return;
    setError(null);
    setBusy(walletId);
    try {
      const res = await signAndSend(walletId, { account: account.trim(), action: "redeem", id });
      setPosition(res.position);
      setDone(`Redeemed for ${formatUsdc(res.usdc ?? "0")} USDC. ${res.tx}`);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel pb pool-form">
      <div className="tabs-mini" role="tablist" aria-label="Deposit or redeem">
        {(["deposit", "withdraw"] as const).map((a) => (
          <button key={a} type="button" role="tab" aria-selected={action === a} className={action === a ? "on" : ""} onClick={() => setAction(a)}>
            {a === "deposit" ? POOL.deposit : POOL.withdraw}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{POOL.account}</span>
        <input value={account} onChange={(e) => setAccount(e.target.value)} onBlur={() => void load(account)} placeholder={`you.${NEAR_NETWORK}`} spellCheck={false} autoComplete="username" />
      </label>
      <label className="field">
        <span>{action === "deposit" ? POOL.amount : POOL.wardAmount}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={action === "deposit" ? "20.00" : position ? ward(position.ward) : "10.00"} />
      </label>
      <p className="hint">{action === "deposit" ? POOL.depositNote(price(pool.ward_price)) : POOL.wait(pool.withdraw_delay_days)}</p>
      <fieldset className="wallet-pick" disabled={busy !== null}>
        <legend>{POOL.sign}</legend>
        {wallets.map((w) => (
          <button key={w.id} type="button" className="pick" disabled={!account.trim() || !amount.trim()} onClick={() => void go(w.id)} data-wallet={w.id}>
            <b>{w.name}</b>
            <span>{busy === w.id ? POOL.signing : action === "deposit" ? POOL.deposit : POOL.withdraw}</span>
          </button>
        ))}
      </fieldset>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="ok-line" role="status" data-testid="pool-done">
          {done}
        </p>
      )}
      {position && <Position position={position} now={now} onRedeem={(id) => void redeem(id)} busy={busy !== null} />}
    </div>
  );
}

function Claims({ claims }: { claims: ClaimView[] }) {
  if (claims.length === 0) return <p className="empty">{POOL.claimsEmpty}</p>;
  return (
    <div className="scrollx">
      <table className="rows">
        <thead>
          <tr>
            <th>{POOL.col.filed}</th>
            <th>{POOL.col.subject}</th>
            <th className="r">{POOL.col.amount}</th>
            <th className="r">{POOL.col.junior}</th>
            <th className="r">{POOL.col.senior}</th>
            <th className="r">{POOL.col.price}</th>
            <th>{POOL.col.status}</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.claim_id}>
              <td className="mono nowrap">{c.filed_at.slice(0, 10)}</td>
              <td>
                <span className="mono">{c.subject}</span>
                <span className="ref">{c.reason}</span>
              </td>
              <td className="num r">{formatUsdc(c.amount)}</td>
              <td className="num r">{formatUsdc(c.paid_from_junior)}</td>
              <td className="num r">{formatUsdc(c.paid_from_senior)}</td>
              <td className="num r nowrap">{c.ward_price_before ? `${price(c.ward_price_before)} to ${price(c.ward_price_after)}` : ""}</td>
              <td>{c.status === "pending_vote" ? "Waiting for vote" : c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Mutual() {
  const [state, setState] = useState<{ pool: PoolView; claims: ClaimView[]; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    getPool().then(
      (r) => setState({ pool: r.pool, claims: r.claims, mode: r.mode }),
      (e: unknown) => setError(errorText(e)),
    );
  }, [tick]);

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <span className="label">{POOL.label}</span>
          <h1 className="h2">{POOL.title}</h1>
          <p className="lede ink">{POOL.lede}</p>
        </div>
      </section>
      <section className="sec tight">
        <div className="wrap">
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          {!state && !error && <p className="loading">Loading the pool</p>}
          {state && (
            <>
              <WardPanel pool={state.pool} />
              <div className="pool-grid">
                <div>
                  <div className="lose-first">
                    <h2 className="h3">{POOL.loseFirstTitle}</h2>
                    {POOL.loseFirst.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                  <TrancheBar pool={state.pool} />
                  <Stats pool={state.pool} />
                </div>
                <DepositRedeem pool={state.pool} onDone={() => setTick((t) => t + 1)} />
              </div>
              {state.mode === "sim" && <p className="engine-note">{POOL.modeSim}</p>}
            </>
          )}
        </div>
      </section>
      {state && (
        <section className="sec tight" aria-labelledby="claims-title">
          <div className="wrap">
            <h2 className="h3" id="claims-title">
              {POOL.claims}
            </h2>
            <Claims claims={state.claims} />
          </div>
        </section>
      )}
    </main>
  );
}
