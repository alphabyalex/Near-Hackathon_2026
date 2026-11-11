/** The Mutual, which is the home page: the hero, the two sides of the line, holding a share, voting and the safest groups. */
import { startTransition, useEffect, useState } from "react";
import type { GroupSummary, MutualSummary } from "../../api/ai";
import { Problem } from "../../components/Problem";
import { getMutual } from "../../data/mutual";
import { HOME, REP } from "../../brand";
import { Explainer } from "../../v2/Explainer";
import { Hero } from "../../v2/Hero";
import { prefersReducedMotion } from "../../v2/motion";
import { feeText, TierBadge } from "../../components/TierBadge";
import { Governance } from "./Governance";
import { JoinDialog, MemberCard } from "./Member";

const count = (n: number) => n.toLocaleString("en-US");

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

/** The two sides, at their real size, while the numbers load. */
function HomeSkeleton() {
  return (
    <div aria-busy="true" data-testid="home-loading">
      <p className="sr-only" role="status">
        Loading the Mutual
      </p>
      <section className="sec" aria-hidden="true">
        <div className="wrap">
          <span className="skel skel-title" />
          <div className="skel-card sides-skel" />
        </div>
      </section>
    </div>
  );
}

/** Groups with fewer proven calls than this are left off Safest groups: too little record to rank. */
export const SAFEST_MIN_CALLS = 10;

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
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [joining, setJoining] = useState(false);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => {
    getMutual().then(
      // A transition lets React render the page in small slices, so the main thread never blocks long.
      (v) =>
        startTransition(() => {
          setM(v);
          setError(null);
        }),
      (e: unknown) => setError(e),
    );
  }, [tick]);
  // A click before the numbers arrive still opens Join, as soon as they do.
  const join = () => setJoining(true);
  // The hero's secondary button: down to Watch a payment cross the line, which plays once in view.
  const watch = () => {
    const el = document.getElementById("watch");
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  return (
    <main>
      <Hero onJoin={join} onWatch={watch} />
      <Explainer />
      {error !== null && !m && (
        <div className="wrap state-wrap">
          <Problem error={error} onRetry={refresh} />
        </div>
      )}
      {!m && error === null && <HomeSkeleton />}
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
            {/* A record needs at least 10 proven calls before it can rank as safe. */}
            <Leaderboard groups={m.groups.filter((g) => g.proven_calls >= SAFEST_MIN_CALLS)} limit={5} />
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

      {joining && m && <JoinDialog pool={m.pool} minDeposit={m.min_deposit} onClose={() => setJoining(false)} onJoined={refresh} />}
    </main>
  );
}
