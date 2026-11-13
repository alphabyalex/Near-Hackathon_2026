/** The Mutual, which is the home page: the hero, the line explained, the proof against scams, holding a share, voting and the safest groups. */
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { GroupSummary, MutualSummary } from "../../api/ai";
import { Problem } from "../../components/Problem";
import { getMutual } from "../../data/mutual";
import { HOME, REP } from "../../brand";
import { Explainer, Outcomes } from "../../v2/Explainer";
import { Hero } from "../../v2/Hero";
import { prefersReducedMotion, useInView } from "../../v2/motion";
import { useReveal } from "../../v2/reveal";
import { sphereDots } from "../../v2/sphere";
import { navigate } from "../../router";
import { feeText, TierBadge } from "../../components/TierBadge";
import { Governance } from "./Governance";
import { CodeTabs } from "../../components/CodeTabs";
import { pluginTabs } from "../../data/snippets";
import { MemberCard } from "./Member";
import { Comparison } from "./Comparison";

const count = (n: number) => n.toLocaleString("en-US");

/** For builders (N): the one-line plug-in, with its JavaScript, Python and curl versions. The code writes itself in line by line, then the one line lights up. */
function Builders() {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <section className="sec builders" aria-labelledby="builders-title">
      <div className="wrap builders-grid">
        <div>
          <h2 className="h2" id="builders-title">
            {HOME.builders.title}
          </h2>
          <p className="lede">{HOME.builders.line}</p>
          <p>
            <a className="link" href="#/docs/quickstart">
              {HOME.builders.all}
            </a>
          </p>
        </div>
        <div ref={ref} className="builders-code" data-inview={seen || undefined}>
          <CodeTabs tabs={pluginTabs()} label={HOME.builders.label} />
        </div>
      </div>
    </section>
  );
}

/** The hero's sphere again, for the closing call: the same dot sizes, drawn as an SVG. */
function CtaSphere() {
  const dots = useMemo(() => sphereDots({ cx: 110, cy: 110, R: 92, step: 4.7, light: [-0.5, -0.58], floor: 0.2, gap: 4.1 }), []);
  return (
    <svg className="cta-sphere" viewBox="0 0 220 220" aria-hidden="true">
      {dots.map((d) => (
        <circle key={`${d.x}-${d.y}`} cx={d.x} cy={d.y} r={d.r} fill={d.fill} />
      ))}
    </svg>
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
          <div className="skel-card home-skel" />
        </div>
      </section>
    </div>
  );
}

/** Groups with fewer proven calls than this are left off Safest groups: too little record to rank. */
export const SAFEST_MIN_CALLS = 10;

export function Leaderboard({ groups, limit, compact = false }: { groups: GroupSummary[]; limit?: number; compact?: boolean }) {
  const rows = limit ? groups.slice(0, limit) : groups;
  const most = Math.max(1, ...rows.map((g) => g.proven_calls));
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div className="scrollx" role="region" aria-label={HOME.boardTitle} tabIndex={0} ref={ref} data-inview={seen || undefined}>
      <table className={compact ? "tbl board compact" : "tbl board"} data-testid="leaderboard">
        <thead>
          <tr>
            <th>{REP.col.group}</th>
            <th>{REP.col.tier}</th>
            <th className="r">{REP.col.proven}</th>
            {!compact && <th className="r">{REP.col.claims}</th>}
            <th className="r">{REP.col.fee}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => (
            <tr key={g.budget_id} data-budget={g.budget_id} style={{ ["--i" as string]: i }}>
              <td>
                <span className="rank" aria-hidden="true">
                  {i + 1}
                </span>
                <b className="board-name">{g.name}</b>
              </td>
              <td>
                <TierBadge tier={g.tier} />
              </td>
              <td className="num r proven">
                <span className="pwrap">
                  <span className="pbar" aria-hidden="true">
                    <i style={{ width: `${Math.max(3, Math.round((g.proven_calls / most) * 100))}%` }} />
                  </span>
                  <span className="pnum">{count(g.proven_calls)}</span>
                </span>
              </td>
              {!compact && <td className="num r">{REP.claimCount(g.claims)}</td>}
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
  const refresh = () => setTick((t) => t + 1);
  const page = useRef<HTMLElement>(null);
  useReveal(page, m);
  // Every Become a member goes into the app first: Your balance, which then walks a new member through the rest.
  const enter = () => navigate("#/wallet");
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
  // The hero's secondary button: down to Watch a payment cross the line, which plays once in view.
  const watch = () => {
    const el = document.getElementById("watch");
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 140, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  };

  return (
    <main ref={page} className="home">
      <Hero onJoin={enter} onWatch={watch} />
      <Explainer />
      <Outcomes />
      {error !== null && !m && (
        <div className="wrap state-wrap">
          <Problem error={error} onRetry={refresh} />
        </div>
      )}
      {!m && error === null && <HomeSkeleton />}
      {m && <Comparison />}

      {m && (
        <section className="sec holding" id="member" aria-labelledby="share-title">
          <div className="wrap share-grid">
            <div className="share-copy">
              <h2 className="h2" id="share-title">
                {HOME.shareTitle}
              </h2>
              <ul className="share-lines">
                {HOME.shareBody.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <MemberCard pool={m.pool} version={tick} onJoin={enter} onChanged={refresh} />
          </div>
        </section>
      )}

      {m && (
        <section className="sec community" aria-labelledby="community-title">
          <div className="wrap">
            <h2 className="h2" id="community-title">
              {HOME.communityTitle}
            </h2>
            <p className="lede">{HOME.communityLede}</p>
          </div>
          <div className="wrap community-grid">
            <div className="votes">
              <h3 className="col-h">{HOME.votesTitle}</h3>
              <Governance proposals={m.governance.proposals} onChange={refresh} tiers={m.tiers} embedded summary />
            </div>
            <div className="groups">
              <h3 className="col-h">{HOME.boardTitle}</h3>
              {/* A record needs at least 10 proven calls before it can rank as safe. */}
              <Leaderboard groups={m.groups.filter((g) => g.proven_calls >= SAFEST_MIN_CALLS)} limit={5} compact />
              <p className="more">
                <a className="link" href="#/groups">
                  {HOME.boardAll}
                </a>
              </p>
            </div>
          </div>
        </section>
      )}

      <Builders />

      <section className="sec cta" aria-labelledby="cta-title">
        <div className="wrap cta-grid">
          <div className="cta-copy">
            <h2 className="h2" id="cta-title">
              {HOME.ctaTitle}
            </h2>
            <p className="lede">{HOME.ctaBody}</p>
            <button type="button" className="btn" onClick={enter}>
              {HOME.primary}
            </button>
          </div>
          <div className="cta-visual" aria-hidden="true">
            <CtaSphere />
          </div>
        </div>
      </section>

    </main>
  );
}
