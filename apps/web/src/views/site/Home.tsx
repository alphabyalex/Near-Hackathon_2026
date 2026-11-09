/** The Mutual, which is the home page: what it is, live numbers, the three layers, the safest groups, joining, voting and payouts. */
import { useEffect, useState } from "react";
import { getMutual, type GroupSummary, type MutualSummary } from "../../api/ai";
import { errorText } from "../../api/public";
import { HOME, POOL, REP } from "../../brand";
import { Button } from "../../components/Button";
import { HeroSphere } from "../../components/HeroSphere";
import { TextLink } from "../../components/TextLink";
import { feeText, TierBadge } from "../../components/TierBadge";
import { formatUsdc } from "../../format";
import { Governance } from "./Governance";
import { Claims, DepositRedeem, price, sinceLaunch, Stats, TrancheBar, WardPanel } from "./Mutual";

/** Scrolls to the deposit form and puts the cursor in the account field. */
function toJoin(): void {
  const section = document.getElementById("join");
  section?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  window.setTimeout(() => document.getElementById("join-account")?.focus({ preventScroll: true }), 300);
}

function LiveStats({ m }: { m: MutualSummary }) {
  const s = m.stats;
  const change = sinceLaunch(s);
  const cells: [string, string, string, string?][] = [
    [HOME.stats.pooled, formatUsdc(s.total_pooled), "USDC"],
    [HOME.stats.price, price(s.ward_price), `${change} since launch`, change.startsWith("-") ? "down" : ""],
    [HOME.stats.yield, formatUsdc(s.yield_earned), `USDC. ${HOME.stats.yieldNote}`],
    [HOME.stats.groups, String(s.groups_covered), HOME.stats.groupsNote],
    [HOME.stats.proven, s.proven_payments.toLocaleString("en-US"), HOME.stats.provenNote],
    [HOME.stats.payouts, String(s.payouts), HOME.stats.payoutsNote],
  ];
  return (
    <section className="sec tight" aria-labelledby="stats-title">
      <div className="wrap">
        <h2 className="label" id="stats-title">
          {HOME.statsLabel}
        </h2>
        <div className="strip home-stats" data-testid="home-stats">
          {cells.map(([l, v, note, cls]) => (
            <div key={l}>
              <div className="l">{l}</div>
              <div className={`v num ${cls ?? ""}`}>{v}</div>
              <div className="s">{note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="sec tight" aria-labelledby="how-title">
      <div className="wrap">
        <span className="label">{HOME.howLabel}</span>
        <h2 className="h2 how-title" id="how-title">
          {HOME.howTitle}
        </h2>
        <div className="specs layers">
          {HOME.layers.map(([name, line], i) => (
            <div className="spec" key={name}>
              <b>
                <span className="scene-n num">{i + 1}</span> {name}
              </b>
              <span>
                {line}{" "}
                {i === 0 ? (
                  <button type="button" className="link inline" onClick={toJoin}>
                    {HOME.layerCta[i]}
                  </button>
                ) : (
                  <a className="link inline" href={HOME.layerLinks[i]}>
                    {HOME.layerCta[i]}
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Leaderboard({ groups, limit }: { groups: GroupSummary[]; limit?: number }) {
  const rows = limit ? groups.slice(0, limit) : groups;
  return (
    <div className="scrollx">
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
                <span className="ref mono">{g.owner}</span>
              </td>
              <td>
                <TierBadge tier={g.tier} />
              </td>
              <td className="num r">{g.proven_calls.toLocaleString("en-US")}</td>
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
  const [account, setAccount] = useState("");
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => {
    getMutual().then(setM, (e: unknown) => setError(errorText(e)));
  }, [tick]);

  return (
    <main>
      <section className="hero" aria-label="Introduction">
        <HeroSphere />
        <div className="limitline" aria-hidden="true">
          <span>limit</span>
        </div>
        <div className="wrap">
          <h1 className="hero-h1">
            {HOME.heroLead} <span>{HOME.heroRest}</span>
            <em>.</em>
          </h1>
          <p>{HOME.sub}</p>
          <div className="actions">
            <Button onClick={toJoin}>{HOME.primary}</Button>
            <TextLink href="#/groups">{HOME.secondary}</TextLink>
          </div>
        </div>
      </section>

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
      {m && <LiveStats m={m} />}
      <HowItWorks />

      {m && (
        <section className="sec tight" aria-labelledby="board-title">
          <div className="wrap">
            <span className="label">{HOME.boardLabel}</span>
            <h2 className="h2 board-title" id="board-title">
              {HOME.boardTitle}
            </h2>
            <Leaderboard groups={m.groups} limit={5} />
            <p className="board-more">
              <TextLink href="#/groups">{HOME.boardAll}</TextLink>
            </p>
          </div>
        </section>
      )}

      {m && (
        <section className="sec tight join" id="join" aria-labelledby="join-title" tabIndex={-1}>
          <div className="wrap">
            <span className="label">{HOME.joinLabel}</span>
            <h2 className="h2" id="join-title">
              {HOME.joinTitle}
            </h2>
            <p className="lede ink join-lede">{HOME.joinLede}</p>
            <WardPanel pool={m.pool} />
            <div className="pool-grid">
              <div>
                <div className="lose-first">
                  <h3 className="h3">{POOL.loseFirstTitle}</h3>
                  {POOL.loseFirst.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
                <TrancheBar pool={m.pool} />
                <Stats pool={m.pool} />
              </div>
              <DepositRedeem pool={m.pool} onDone={refresh} account={account} setAccount={setAccount} />
            </div>
            <p className="engine-note">{m.mode === "sim" ? HOME.modeSim : HOME.modeMixed}</p>
          </div>
        </section>
      )}

      {m && <Governance proposals={m.governance.proposals} account={account} setAccount={setAccount} onChange={refresh} />}

      {m && (
        <section className="sec tight" aria-labelledby="claims-title">
          <div className="wrap">
            <h2 className="h3" id="claims-title">
              {POOL.claims}
            </h2>
            <Claims claims={m.claims} />
          </div>
        </section>
      )}
    </main>
  );
}
