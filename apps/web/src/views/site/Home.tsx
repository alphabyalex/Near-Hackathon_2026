/** The Mutual, which is the home page: the hero, the two sides of the line, holding a share, voting and the safest groups. */
import { useEffect, useState } from "react";
import { getMutual, type GroupSummary, type MutualSummary } from "../../api/ai";
import { errorText } from "../../api/public";
import { HOME, REP } from "../../brand";
import { HeroHorizon } from "../../components/HeroHorizon";
import { feeText, TierBadge } from "../../components/TierBadge";
import { formatUsdc } from "../../format";
import { Governance } from "./Governance";
import { JoinDialog, MemberCard } from "./Member";
import { price, sinceLaunch } from "./Mutual";

const count = (n: number) => n.toLocaleString("en-US");

function Hero({ onJoin }: { onJoin: () => void }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-art">
        <HeroHorizon />
      </div>
      <div className="wrap hero-copy">
        <h1 className="hero-h1 fade-1" id="hero-title">
          {HOME.heroLead} {HOME.heroRest}.
        </h1>
        <p className="hero-sub fade-2">{HOME.sub}</p>
        <div className="actions fade-3">
          <button type="button" className="btn" onClick={onJoin}>
            {HOME.primary}
          </button>
          <a className="btn ghost" href="#/demo">
            {HOME.secondary}
          </a>
        </div>
      </div>
    </section>
  );
}

function Stats({ m }: { m: MutualSummary }) {
  const s = m.stats;
  const change = sinceLaunch(s);
  return (
    <section className="stats" aria-label={HOME.stats.price}>
      <div className="wrap">
        <dl className="stat-row" data-testid="home-stats">
          <div>
            <dt>{HOME.stats.pooled}</dt>
            <dd className="num">{formatUsdc(m.pool.senior)}</dd>
            <dd className="stat-note">{HOME.stats.pooledNote}</dd>
          </div>
          <div>
            <dt>{HOME.stats.price}</dt>
            <dd className="num" data-testid="ward-price">
              {price(s.ward_price)}
            </dd>
            <dd className="stat-note num">{HOME.stats.sinceLaunch(change)}</dd>
          </div>
          <div>
            <dt>{HOME.stats.above}</dt>
            <dd className="num">{count(s.proven_payments)}</dd>
            <dd className="stat-note">{HOME.stats.aboveNote}</dd>
          </div>
          <div>
            <dt>{HOME.stats.below}</dt>
            <dd className="num below-text">{count(s.below.total)}</dd>
            <dd className="stat-note">{HOME.stats.belowNote}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function Sides({ m }: { m: MutualSummary }) {
  const b = m.stats.below;
  const kinds = [
    ["swapped", b.swapped],
    ["lookalike", b.lookalike],
    ["capped", b.capped],
  ] as const;
  return (
    <section className="sec" aria-labelledby="sides-title">
      <div className="wrap">
        <h2 className="h2" id="sides-title">
          {HOME.sidesTitle}
        </h2>
        <div className="sides" data-testid="sides">
          <div className="side-panel above">
            <div className="side-head">
              <h3>{HOME.above}</h3>
              <span className="side-count num">{count(m.stats.proven_payments)}</span>
            </div>
            <p className="side-lede">{HOME.aboveLede}</p>
            <ul className="side-list">
              {HOME.aboveChecks.map(([name, line]) => (
                <li key={name}>
                  <b>{name}</b>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="side-panel below" data-testid="below-panel">
            <div className="side-head">
              <h3>{HOME.below}</h3>
              <span className="side-count num">{count(b.total)}</span>
            </div>
            <p className="side-lede">{HOME.belowLede}</p>
            <ul className="side-list">
              {kinds.map(([k, n]) => (
                <li key={k} data-kind={k}>
                  <b>
                    {HOME.belowKinds[k][0]} <span className="num">{count(n)}</span>
                  </b>
                  <span>{HOME.belowKinds[k][1]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Leaderboard({ groups, limit }: { groups: GroupSummary[]; limit?: number }) {
  const rows = limit ? groups.slice(0, limit) : groups;
  return (
    <div className="scrollx" role="region" aria-label={HOME.boardTitle} tabIndex={0}>
      <table className="tbl board" data-testid="leaderboard">
        <thead>
          <tr>
            <th>{REP.col.group}</th>
            <th>{REP.col.tier}</th>
            <th className="r">{REP.col.proven}</th>
            <th className="r">{REP.col.claims}</th>
            <th className="r">{REP.col.fee}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.budget_id} data-budget={g.budget_id}>
              <td>
                <b className="board-name">{g.name}</b>
                <span className="ref acct">{g.owner}</span>
              </td>
              <td>
                <TierBadge tier={g.tier} />
              </td>
              <td className="num r">{count(g.proven_calls)}</td>
              <td className="num r">{REP.claimCount(g.claims)}</td>
              <td className="num r">{feeText(g.fee_bps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Home() {
  const [m, setM] = useState<MutualSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [joining, setJoining] = useState(false);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => {
    getMutual().then(setM, (e: unknown) => setError(errorText(e)));
  }, [tick]);
  const join = () => m && setJoining(true);

  return (
    <main>
      <Hero onJoin={join} />
      {error && (
        <div className="wrap">
          <p className="notice" role="alert">
            {error}
          </p>
        </div>
      )}
      {!m && !error && (
        <div className="wrap">
          <p className="loading">Loading the Mutual</p>
        </div>
      )}
      {m && <Stats m={m} />}
      {m && <Sides m={m} />}

      {m && (
        <section className="sec light" id="member" aria-labelledby="share-title">
          <div className="wrap share-grid">
            <div className="share-copy">
              <h2 className="h2" id="share-title">
                {HOME.shareTitle}
              </h2>
              {HOME.shareBody.map((p) => (
                <p key={p}>{p}</p>
              ))}
              <button type="button" className="btn" onClick={join}>
                {HOME.shareCta}
              </button>
              <p className="mode-note">{m.mode === "sim" ? HOME.modeSim : HOME.modeMixed}</p>
            </div>
            <MemberCard pool={m.pool} version={tick} onJoin={join} onChanged={refresh} />
          </div>
        </section>
      )}

      {m && <Governance proposals={m.governance.proposals} onChange={refresh} />}

      {m && (
        <section className="sec" aria-labelledby="board-title">
          <div className="wrap">
            <h2 className="h2" id="board-title">
              {HOME.boardTitle}
            </h2>
            <p className="lede">{HOME.boardLede}</p>
            <Leaderboard groups={m.groups} limit={5} />
            <p className="more">
              <a className="link" href="#/groups">
                {HOME.boardAll}
              </a>
            </p>
          </div>
        </section>
      )}

      <section className="sec cta" aria-labelledby="cta-title">
        <div className="wrap cta-row">
          <div>
            <h2 className="h2" id="cta-title">
              {HOME.ctaTitle}
            </h2>
            <p className="lede">{HOME.ctaBody}</p>
          </div>
          <button type="button" className="btn" onClick={join} disabled={!m}>
            {HOME.primary}
          </button>
        </div>
      </section>

      {joining && m && <JoinDialog pool={m.pool} onClose={() => setJoining(false)} onJoined={refresh} />}
    </main>
  );
}
