/** Groups: shared AI budgets from a DAO treasury, reputation tiers, every covered group and how to start one. */
import { useEffect, useState } from "react";
import type { GroupSummary, TierRules } from "../../api/ai";
import { Problem } from "../../components/Problem";
import { getGroups } from "../../data/groups";
import { GROUPS, REP } from "../../brand";
import { GroupHorizon } from "../../components/HorizonMark";
import { feeText, TierBadge } from "../../components/TierBadge";
import { formatUsdc } from "../../format";

/** What earns the next tier: a 4px progress bar of clean proven calls, and the words. */
export function NextTier({ g }: { g: Pick<GroupSummary, "tier" | "clean_calls" | "next_tier_at"> }) {
  if (g.next_tier_at === null) return <span className="next-tier">{REP.top}</span>;
  const next = g.tier === "bronze" ? REP.names.silver : REP.names.gold;
  const left = Math.max(0, g.next_tier_at - g.clean_calls);
  const pct = Math.min(100, (g.clean_calls / g.next_tier_at) * 100);
  return (
    <span className="next-tier">
      <span className="nt-bar" role="img" aria-label={`${g.clean_calls} of ${g.next_tier_at} clean proven calls`}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span>{REP.next(left, next)}</span>
    </span>
  );
}

function GroupCard({ g }: { g: GroupSummary }) {
  return (
    <article className="gcard" data-budget={g.budget_id} data-tier={g.tier}>
      <div className="gcard-head">
        <GroupHorizon id={g.budget_id} size={56} />
        <div>
          <h3>{g.name}</h3>
          <span className="acct muted">
            {GROUPS.dao} {g.owner}
          </span>
        </div>
        <TierBadge tier={g.tier} />
      </div>
      <dl className="gfacts">
        <div>
          <dt>{REP.proven}</dt>
          <dd className="num">{g.proven_calls.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>{REP.claims}</dt>
          <dd className="num">{g.claims}</dd>
        </div>
        <div>
          <dt>{REP.fee}</dt>
          <dd className="num">{feeText(g.fee_bps)}</dd>
        </div>
        <div>
          <dt>{REP.coverage}</dt>
          <dd className="num">{formatUsdc(g.coverage_cap)} USDC</dd>
        </div>
        <div>
          <dt>{REP.refused}</dt>
          <dd className="num">{g.refused_calls}</dd>
        </div>
        <div>
          <dt>{REP.spent}</dt>
          <dd className="num">{formatUsdc(g.spent)} USDC</dd>
        </div>
      </dl>
      <NextTier g={g} />
      <p className="gcard-foot muted">{GROUPS.members(g.members)}</p>
    </article>
  );
}

function TierCards({ tiers }: { tiers: TierRules }) {
  const mult = tiers.coverage_multiplier_bps;
  return (
    <div className="tier-cards" data-testid="tier-table">
      {tiers.rules.map((r, i) => {
        const prev = tiers.rules[i - 1];
        return (
          <article className="tier-card" key={r.tier} data-tier={r.tier}>
            <TierBadge tier={r.tier} />
            <b className="tc-fee num">{feeText(r.fee_bps)}</b>
            <span className="tc-label">{GROUPS.tierFee}</span>
            <p className="tc-rule">{prev?.promote_after ? GROUPS.earnAfter(prev.promote_after, REP.names[prev.tier]) : GROUPS.earnFirst}</p>
            <dl className="tc-cover">
              <dt>{GROUPS.tierCoverage}</dt>
              <dd className="num">{formatUsdc(((BigInt(r.coverage) * BigInt(mult)) / 10_000n).toString())} USDC</dd>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

export function Groups() {
  const [data, setData] = useState<{ groups: GroupSummary[]; tiers: TierRules } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setError(null);
    getGroups().then(setData, (e: unknown) => setError(e));
  }, [tick]);

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <h1 className="h1">{GROUPS.title}</h1>
          <p className="lede">{GROUPS.lede}</p>
        </div>
      </section>
      {error !== null && (
        <div className="wrap state-wrap">
          <Problem error={error} onRetry={() => setTick((t) => t + 1)} />
        </div>
      )}
      {!data && error === null && (
        <div className="wrap" aria-busy="true">
          <p className="sr-only" role="status">
            Loading groups
          </p>
          <div className="skel-card groups-skel" aria-hidden="true" />
        </div>
      )}
      {data && (
        <section className="sec tight" aria-labelledby="tiers-title">
          <div className="wrap">
            <h2 className="h2" id="tiers-title">
              {GROUPS.tiersTitle}
            </h2>
            <TierCards tiers={data.tiers} />
            <p className="fine">{REP.rule}</p>
          </div>
        </section>
      )}
      {data && (
        <section className="sec tight" aria-labelledby="list-title">
          <div className="wrap">
            <h2 className="h2" id="list-title">
              {GROUPS.listTitle}
            </h2>
            <div className="gcards">
              {data.groups.map((g) => (
                <GroupCard key={g.budget_id} g={g} />
              ))}
            </div>
          </div>
        </section>
      )}
      <section className="sec tight" aria-labelledby="start-title" id="start">
        <div className="wrap">
          <h2 className="h2" id="start-title">
            {GROUPS.startTitle}
          </h2>
          <ol className="steps-row">
            {GROUPS.steps.map(([name, line], i) => (
              <li key={name}>
                <span className="step-n num">{i + 1}</span>
                <b>{name}</b>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <div className="actions">
            <a className="btn" href="#/app/group">
              {GROUPS.startCta}
            </a>
            <a className="btn ghost" href="#/developers">
              {GROUPS.connectCta}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
