/** Groups: shared AI budgets from a DAO treasury, reputation tiers, every covered group and how to start one. */
import { useEffect, useState } from "react";
import { getGroups, type GroupSummary, type TierRules } from "../../api/ai";
import { errorText } from "../../api/public";
import { GROUPS, REP } from "../../brand";
import { Button } from "../../components/Button";
import { TextLink } from "../../components/TextLink";
import { feeText, TierBadge } from "../../components/TierBadge";
import { formatUsdc } from "../../format";

/** What earns the next tier, as a row of dots: one per clean call needed. */
export function NextTier({ g }: { g: Pick<GroupSummary, "tier" | "clean_calls" | "next_tier_at"> }) {
  if (g.next_tier_at === null) return <span className="next-tier">{REP.top}</span>;
  const next = g.tier === "bronze" ? REP.names.silver : REP.names.gold;
  const left = Math.max(0, g.next_tier_at - g.clean_calls);
  const shown = Math.min(g.next_tier_at, 25);
  const done = Math.round((g.clean_calls / g.next_tier_at) * shown);
  return (
    <span className="next-tier">
      <span className="nt-dots" role="img" aria-label={`${g.clean_calls} of ${g.next_tier_at} clean proven calls`}>
        {Array.from({ length: shown }, (_, i) => (
          <i key={i} className={i < done ? "on" : ""} />
        ))}
      </span>
      <span>{REP.next(left, next)}</span>
    </span>
  );
}

function GroupCard({ g }: { g: GroupSummary }) {
  return (
    <article className="gcard" data-budget={g.budget_id} data-tier={g.tier}>
      <div className="gcard-head">
        <div>
          <h3>{g.name}</h3>
          <span className="mono muted">
            {GROUPS.dao} {g.owner}
          </span>
        </div>
        <TierBadge tier={g.tier} />
      </div>
      <NextTier g={g} />
      <dl className="gfacts">
        <div>
          <dt>{REP.fee}</dt>
          <dd className="num">{feeText(g.fee_bps)}</dd>
        </div>
        <div>
          <dt>{REP.coverage}</dt>
          <dd className="num">{formatUsdc(g.coverage_cap)} USDC</dd>
        </div>
        <div>
          <dt>{REP.proven}</dt>
          <dd className="num">{g.proven_calls.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>{REP.refused}</dt>
          <dd className="num">{g.refused_calls}</dd>
        </div>
        <div>
          <dt>{REP.claims}</dt>
          <dd className="num">{g.claims}</dd>
        </div>
        <div>
          <dt>{REP.spent}</dt>
          <dd className="num">{formatUsdc(g.spent)} USDC</dd>
        </div>
      </dl>
      <p className="gcard-foot muted">{GROUPS.members(g.members)}</p>
    </article>
  );
}

function TierTable({ tiers }: { tiers: TierRules }) {
  const mult = tiers.coverage_multiplier_bps;
  return (
    <div className="scrollx">
      <table className="tbl tiers-tbl" data-testid="tier-table">
        <thead>
          <tr>
            <th>{GROUPS.tierCol.tier}</th>
            <th className="r">{GROUPS.tierCol.fee}</th>
            <th className="r">{GROUPS.tierCol.coverage}</th>
            <th>{GROUPS.tierCol.earn}</th>
          </tr>
        </thead>
        <tbody>
          {tiers.rules.map((r, i) => {
            const prev = tiers.rules[i - 1];
            return (
              <tr key={r.tier}>
                <td>
                  <TierBadge tier={r.tier} />
                </td>
                <td className="num r">{feeText(r.fee_bps)}</td>
                <td className="num r">{formatUsdc(((BigInt(r.coverage) * BigInt(mult)) / 10_000n).toString())}</td>
                <td>{prev?.promote_after ? GROUPS.earnAfter(prev.promote_after, REP.names[prev.tier]) : GROUPS.earnFirst}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Groups() {
  const [data, setData] = useState<{ groups: GroupSummary[]; tiers: TierRules } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getGroups().then(setData, (e: unknown) => setError(errorText(e)));
  }, []);

  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <span className="label">{GROUPS.label}</span>
          <h1 className="h2">{GROUPS.title}</h1>
          <p className="lede ink">{GROUPS.lede}</p>
        </div>
      </section>
      {error && (
        <div className="wrap">
          <p className="notice" role="alert">
            {error}
          </p>
        </div>
      )}
      {!data && !error && (
        <div className="wrap">
          <p className="loading">Loading groups</p>
        </div>
      )}
      {data && (
        <section className="sec tight" aria-labelledby="tiers-title">
          <div className="wrap">
            <span className="label">{GROUPS.tiersLabel}</span>
            <h2 className="h2 tiers-title" id="tiers-title">
              {GROUPS.tiersTitle}
            </h2>
            <TierTable tiers={data.tiers} />
            <p className="engine-note">{REP.rule}</p>
          </div>
        </section>
      )}
      {data && (
        <section className="sec tight" aria-labelledby="list-title">
          <div className="wrap">
            <h2 className="label" id="list-title">
              {GROUPS.listLabel}
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
          <span className="label">{GROUPS.startLabel}</span>
          <h2 className="h2" id="start-title">
            {GROUPS.startTitle}
          </h2>
          <ol className="start-steps">
            {GROUPS.steps.map(([name, line], i) => (
              <li key={name}>
                <b>
                  <span className="scene-n num">{i + 1}</span> {name}
                </b>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <div className="actions page-actions">
            <Button href="#/app/group">{GROUPS.startCta}</Button>
            <TextLink href="#/connect">{GROUPS.connectCta}</TextLink>
          </div>
        </div>
      </section>
    </main>
  );
}
