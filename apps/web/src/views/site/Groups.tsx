/** Groups: every group and solo builder on the orbit (Horizon v2), then the tiers and how to start a group. */
import { useEffect, useState } from "react";
import type { GroupSummary, TierRules } from "../../api/ai";
import { Problem } from "../../components/Problem";
import { getGroups } from "../../data/groups";
import { GROUPS, ORBIT, REP } from "../../brand";
import { feeText } from "../../components/TierBadge";
import { formatUsdc } from "../../format";
import { GroupsOrbit } from "../../v2/GroupsOrbit";

/** What earns the next tier: a 4px progress bar of clean proven calls, and the words. Also used by the owner app. */
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

/** The three tiers side by side, split by hairlines: the fee big, the rule that earns it, the coverage. */
function Tiers({ tiers }: { tiers: TierRules }) {
  const mult = tiers.coverage_multiplier_bps;
  return (
    <div className="ob-tiers" data-testid="tier-table">
      {tiers.rules.map((r, i) => {
        const prev = tiers.rules[i - 1];
        return (
          <div className="ob-tier" key={r.tier} data-tier={r.tier}>
            <span className="tier-name">{REP.names[r.tier]}</span>
            <b className="ob-tier-fee">{feeText(r.fee_bps)}</b>
            <span className="ob-tier-label">{GROUPS.tierFee}</span>
            <p className="ob-tier-rule">{prev?.promote_after ? GROUPS.earnAfter(prev.promote_after, REP.names[prev.tier]) : GROUPS.earnFirst}</p>
            <dl className="ob-tier-cover">
              <dt>{GROUPS.tierCoverage}</dt>
              <dd>{formatUsdc(((BigInt(r.coverage) * BigInt(mult)) / 10_000n).toString())} USDC</dd>
            </dl>
          </div>
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

  const status =
    error !== null ? (
      <Problem error={error} onRetry={() => setTick((t) => t + 1)} />
    ) : !data ? (
      <p className="sr-only" role="status" aria-busy="true">
        {ORBIT.loading}
      </p>
    ) : null;

  return (
    <main>
      <GroupsOrbit groups={data?.groups ?? null} status={status} />
      {data && (
        <section className="sec ob-after" aria-labelledby="tiers-title">
          <div className="wrap">
            <h2 className="h2" id="tiers-title">
              {GROUPS.tiersTitle}
            </h2>
            <Tiers tiers={data.tiers} />
            <p className="ob-rule">{REP.rule}</p>
          </div>
        </section>
      )}
      <section className="sec ob-start" aria-labelledby="start-title" id="start">
        <div className="wrap">
          <h2 className="h2" id="start-title">
            {GROUPS.startTitle}
          </h2>
          <p className="lede">{GROUPS.lede}</p>
          <ol className="ob-steps">
            {GROUPS.steps.map(([name, line], i) => (
              <li key={name}>
                <span className="ob-step-n">{i + 1}</span>
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
