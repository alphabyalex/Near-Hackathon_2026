import { useEffect, useMemo, useState } from "react";
import { getPool, getPosition, poolChallenge, poolSubmit, toAtomic, type ClaimView, type PoolPosition, type PoolView } from "../../api/ai";
import { errorText } from "../../api/public";
import { POOL } from "../../brand";
import { NEAR_NETWORK } from "../../config";
import { formatWusd } from "../../format";
import { fromBase64, nearWallets, signNep413, type NearWalletId } from "../../wallets/near";

const share = (part: string, whole: string): number => (BigInt(whole) === 0n ? 0 : Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100);
const price = (scaled: string): string => (Number(BigInt(scaled)) / 1e6).toFixed(4);

function Stats({ pool }: { pool: PoolView }) {
  const cells: [string, string, string][] = [
    [POOL.stats.tvl, formatWusd(pool.tvl), "WUSD"],
    [POOL.stats.junior, formatWusd(pool.junior), `${Math.round(share(pool.junior, pool.tvl))}% of TVL`],
    [POOL.stats.senior, formatWusd(pool.senior), `${Math.round(share(pool.senior, pool.tvl))}% of TVL`],
    [POOL.stats.sharePrice, price(pool.share_price), "WUSD per share"],
    [POOL.stats.fees, formatWusd(pool.fees_earned), "WUSD to senior LPs"],
    [POOL.stats.claims, formatWusd(pool.claims_paid), "WUSD"],
    [POOL.stats.capacity, formatWusd(pool.coverage_capacity), "WUSD"],
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
      <div className="tranche-bar" role="img" aria-label={`${POOL.stats.junior} ${junior}%, then ${POOL.stats.senior} ${(100 - junior).toFixed(2)}%`}>
        <div className="t-junior" style={{ width: `${junior}%` }} />
        <div className="t-senior" style={{ width: `${100 - junior}%` }} />
      </div>
      <div className="tranche-keys">
        <span>
          <i className="k-junior" aria-hidden="true" /> 1. {POOL.stats.junior}, {pool.junior_holder}
        </span>
        <span>
          <i className="k-senior" aria-hidden="true" /> 2. {POOL.stats.senior}
        </span>
      </div>
    </figure>
  );
}

function Deposit({ pool, onDone }: { pool: PoolView; onDone: () => void }) {
  const wallets = useMemo(() => nearWallets(), []);
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
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

  const go = async (walletId: NearWalletId) => {
    setError(null);
    setDone(null);
    const value = action === "deposit" ? toAtomic(amount) : /^[1-9][0-9]*$/.test(amount.trim()) ? amount.trim() : null;
    if (!value) return setError(action === "deposit" ? "Enter an amount in WUSD, up to six decimal places." : "Enter a whole number of shares.");
    setBusy(walletId);
    try {
      const who = account.trim();
      const ch = await poolChallenge({ account: who, action, amount: value });
      const signed = await signNep413(walletId, { message: ch.message, recipient: ch.recipient, nonce: fromBase64(ch.nonce) }, who);
      const res = await poolSubmit({ nonce: ch.nonce, publicKey: signed.publicKey, signature: signed.signature });
      setPosition(res.position);
      setDone(action === "deposit" ? `Deposited. ${res.tx}` : `Withdrawal requested. Unlocks ${res.available_at?.slice(0, 10)}. ${res.tx}`);
      setAmount("");
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel pb pool-form">
      <div className="tabs-mini" role="tablist" aria-label="Deposit or withdraw">
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
        <span>{action === "deposit" ? POOL.amount : POOL.shares}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={action === "deposit" ? "100.00" : (position?.shares ?? "")} />
      </label>
      <p className="hint">{POOL.wait(pool.withdraw_delay_days)}</p>
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
      {position && (
        <div className="position" data-testid="pool-position">
          <b>{POOL.position}</b>
          {position.shares === "0" && position.pending_withdrawals.length === 0 ? (
            <span className="muted">{POOL.noPosition}</span>
          ) : (
            <>
              <span className="num">
                {formatWusd(position.value)} WUSD, {position.shares} {POOL.shares.toLowerCase()}
              </span>
              {position.pending_withdrawals.map((w) => (
                <span key={w.id} className="muted num">
                  {POOL.pending} {w.available_at.slice(0, 10)}: {formatWusd(w.value)} WUSD
                </span>
              ))}
            </>
          )}
        </div>
      )}
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
              <td className="num r">{formatWusd(c.amount)}</td>
              <td className="num r">{formatWusd(c.paid_from_junior)}</td>
              <td className="num r">{formatWusd(c.paid_from_senior)}</td>
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
              <Stats pool={state.pool} />
              <div className="pool-grid">
                <div>
                  <TrancheBar pool={state.pool} />
                  <div className="lose-first">
                    <h2 className="h3">{POOL.loseFirstTitle}</h2>
                    {POOL.loseFirst.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
                <Deposit pool={state.pool} onDone={() => setTick((t) => t + 1)} />
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
