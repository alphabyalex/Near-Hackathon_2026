/** Groups: every covered group as a sphere (Horizon v2), the tiers, and how to start one. */
import { useEffect, useState } from "react";
import type { GroupSummary, TierRules } from "../../api/ai";
import { Problem } from "../../components/Problem";
import { getGroups } from "../../data/groups";
import { GROUPS, REP, SPHERES } from "../../brand";
import { feeText, TierBadge } from "../../components/TierBadge";
import { formatUsdc } from "../../format";
import { GroupSpheres } from "../../v2/GroupSpheres";

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
      <section className="sec pagetop orbs-intro">
        <div className="wrap">
          <h1 className="h1">{SPHERES.title}</h1>
          <p className="lede">{SPHERES.lede}</p>
        </div>
      </section>
      {error !== null && (
        <div className="wrap state-wrap">
          <Problem error={error} onRetry={() => setTick((t) => t + 1)} />
        </div>
      )}
      {!data && error === null && (
        <div className="wrap orbs-loading" aria-busy="true">
          <p className="sr-only" role="status">
            Loading groups
          </p>
          <div className="skel-card groups-skel" aria-hidden="true" />
        </div>
      )}
      {data && <GroupSpheres groups={data.groups} />}
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
            <a className="btn" href="#/developers">
              {GROUPS.connectCta}
            </a>
            <a className="btn ghost" href="#/app/group">
              {GROUPS.startCta}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
