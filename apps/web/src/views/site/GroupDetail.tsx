/** One group's own page (#/groups/<budget id>): its record, its budget, and its recent calls. */
import { useEffect, useState } from "react";
import type { GroupSummary } from "../../api/ai";
import { GROUPS, PROOF } from "../../brand";
import { feeText, TierBadge } from "../../components/TierBadge";
import { NEAR_NETWORK } from "../../config";
import { getProofs, type ProofRow } from "../../data/proofs";
import { isSolo, SOLO_NAME } from "../../data/solo";
import { formatUsdc } from "../../format";
import { NextTier } from "./Groups";
import { proofAmount, verdictOf, when, whatHappened } from "./Proof";

const D = GROUPS.detail;
const count = (n: number): string => n.toLocaleString("en-US");
const explorer = (account: string): string => `https://${NEAR_NETWORK === "mainnet" ? "" : "testnet."}nearblocks.io/address/${encodeURIComponent(account)}`;

/** The group's last few calls, newest first, each on its side of the line. */
function RecentCalls({ budgetId }: { budgetId: string }) {
  const [rows, setRows] = useState<ProofRow[] | null>(null);
  useEffect(() => {
    let live = true;
    getProofs(8, budgetId).then(
      (r) => live && setRows(r.proofs.filter((p) => p.budget_id === budgetId).slice(0, 8)),
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [budgetId]);
  if (rows === null) return <p className="sr-only" role="status">Loading calls</p>;
  if (rows.length === 0) return <p className="empty">{D.callsEmpty}</p>;
  return (
    <ul className="gd-calls" data-testid="group-calls">
      {rows.map((p) => {
        const verdict = verdictOf(p);
        return (
          <li key={p.call_id} data-side={p.side}>
            <span className="gd-what">{whatHappened(p)}</span>
            <span className="gd-when num">{when(p.created_at)}</span>
            <span className="gd-amt num">{proofAmount(p.side === "above" ? p.amount : "0")} USDC</span>
            <span className={`gd-verdict ${p.side === "above" ? "is-paid" : "is-below"}`}>{PROOF.verdict[verdict]}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function GroupDetail({ group: g }: { group: GroupSummary }) {
  const solo = isSolo(g);
  const name = solo ? g.name.replace(SOLO_NAME, "") || g.owner : g.name;
  const S = D.stats;
  return (
    <main className="gd" data-testid="group-page" data-budget={g.budget_id}>
      <section className="sec pagetop gd-top">
        <div className="wrap">
          <p className="gd-crumb">
            <a href="#/groups">{D.back}</a>
          </p>
          <h1 className="h1" id={g.budget_id} tabIndex={-1}>
            {name}
          </h1>
          <p className="gd-sub">
            <TierBadge tier={g.tier} /> <span aria-hidden="true">·</span> {solo ? D.solo : D.members(g.members)}
            {" · "}
            <a className="link" href={explorer(g.owner)} target="_blank" rel="noreferrer">
              {D.treasury}
            </a>
          </p>
          <NextTier g={g} />
        </div>
      </section>

      <section className="sec gd-body" aria-labelledby="gd-record">
        <div className="wrap gd-cols">
          <div>
            <h2 className="gd-h" id="gd-record">
              {D.recordTitle}
            </h2>
            <dl className="gd-stats">
              <div>
                <dt>{S.proven}</dt>
                <dd className="num">{count(g.proven_calls)}</dd>
              </div>
              <div>
                <dt>{S.refused}</dt>
                <dd className={g.refused_calls > 0 ? "num gd-red" : "num"}>{count(g.refused_calls)}</dd>
              </div>
              <div>
                <dt>{S.capped}</dt>
                <dd className="num">{count(g.capped_calls)}</dd>
              </div>
              <div>
                <dt>{S.blocked}</dt>
                <dd className="num">{count(g.blocked_payees)}</dd>
              </div>
              <div>
                <dt>{S.claims}</dt>
                <dd className="num">{count(g.claims)}</dd>
              </div>
              <div>
                <dt>{S.fee}</dt>
                <dd className="num">{feeText(g.fee_bps)}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h2 className="gd-h">{D.budgetTitle}</h2>
            <dl className="gd-rows">
              <div>
                <dt>{S.deposit}</dt>
                <dd className="num">{formatUsdc(g.deposit)} USDC</dd>
              </div>
              <div>
                <dt>{S.spent}</dt>
                <dd className="num">{formatUsdc(g.spent)} USDC</dd>
              </div>
              <div>
                <dt>{S.fees}</dt>
                <dd className="num">{formatUsdc(g.fees_paid)} USDC</dd>
              </div>
              <div>
                <dt>{S.cover}</dt>
                <dd className="num">{formatUsdc(g.coverage_cap)} USDC</dd>
              </div>
              {g.period && (
                <div>
                  <dt>{S.period}</dt>
                  <dd>{D.periodValue[g.period] ?? g.period}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </section>

      <section className="sec gd-recent" aria-labelledby="gd-calls">
        <div className="wrap">
          <h2 className="gd-h" id="gd-calls">
            {D.callsTitle}
          </h2>
          <RecentCalls budgetId={g.budget_id} />
          <p className="more">
            <a className="link" href="#/proof">
              {D.seeAll}
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}

/** A group that isn't in the list: a plain page, never a blank one. */
export function GroupMissing() {
  return (
    <main className="gd">
      <section className="sec pagetop">
        <div className="wrap">
          <p className="gd-crumb">
            <a href="#/groups">{D.back}</a>
          </p>
          <h1 className="h1">{D.missingTitle}</h1>
          <p className="lede">{D.missingBody}</p>
        </div>
      </section>
    </main>
  );
}
