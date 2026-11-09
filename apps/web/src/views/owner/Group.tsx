import type { PayeeVerdict } from "@wardline/schemas";
import { useApi } from "../../api/client";
import type { CallView, GroupView } from "../../api/ai";
import { callWords, modelName } from "../../ai/words";
import { GROUP, REP } from "../../brand";
import { feeText, TierBadge } from "../../components/TierBadge";
import { NextTier } from "../site/Groups";
import { DotBar } from "../../components/DotBar";
import { LoadError, Loading } from "../../components/Loading";
import { Panel } from "../../components/Panel";
import { formatUsdc } from "../../format";
import { VerdictMark } from "../../payee/ResultCard";
import { reasonWords } from "../../payee/reasons";

const pct = (part: string, whole: string): number => (BigInt(whole) === 0n ? 0 : Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100);
const when = (iso: string): string => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;

function CallResult({ call }: { call: CallView }) {
  const word = call.status === "verified" ? GROUP.verified : call.status === "failed" ? GROUP.failed : GROUP.refused;
  return (
    <span className={`call-result ${call.status}`}>
      <b>{word}</b>
      {call.reason && <span className="muted">{callWords(call.reason)}</span>}
    </span>
  );
}

export function Group({ version }: { version: number }) {
  const { data, error } = useApi<GroupView>("/owner/group", version);
  if (error) return <LoadError message={error} />;
  if (!data) return <Loading />;
  const { budget } = data;
  const left = BigInt(budget.deposit) - BigInt(budget.spent) - BigInt(budget.reserved);
  const pending = data.proposals.filter((p) => p.status === "InProgress" && !data.payouts.some((o) => o.proposal === p.id));
  const decided = data.proposals.filter((p) => p.status !== "InProgress");

  return (
    <div className="group">
      <div className="desk-intro">
        <h2>{budget.name}</h2>
        <p>
          {GROUP.lede} {GROUP.dao} <span className="mono">{data.dao}</span>.
        </p>
      </div>

      {data.reputation && (
        <div className="group-tier" data-testid="group-tier">
          <TierBadge tier={data.reputation.tier} />
          <NextTier g={data.reputation} />
          <span className="num">
            {REP.fee} {feeText(data.reputation.fee_bps)}, {REP.coverage.toLowerCase()} {formatUsdc(data.reputation.coverage_cap)} USDC
          </span>
          <span className="num muted">
            {data.reputation.proven_calls} {REP.proven.toLowerCase()}, {data.reputation.refused_calls} {REP.refused.toLowerCase()}, {data.reputation.claims} {REP.claims.toLowerCase()}
          </span>
        </div>
      )}

      <div className="strip" data-testid="budget-strip">
        <div>
          <div className="l">{GROUP.deposit}</div>
          <div className="v num">{formatUsdc(budget.deposit)}</div>
          <div className="s">USDC</div>
        </div>
        <div>
          <div className="l">{GROUP.spent}</div>
          <div className="v num">{formatUsdc(budget.spent)}</div>
          <div className="s">
            {GROUP.held} {formatUsdc(budget.reserved)}
          </div>
        </div>
        <div>
          <div className="l">{GROUP.left}</div>
          <div className="v num">{formatUsdc(left)}</div>
          <div className="s">
            {GROUP.period} {budget.period}
          </div>
        </div>
      </div>

      <Panel title={GROUP.members}>
        <div className="scrollx">
          <table className="rows">
            <thead>
              <tr>
                <th>{GROUP.members}</th>
                <th>{GROUP.used}</th>
                <th>{GROUP.allowance}</th>
                <th className="bar-col">
                  <span className="sr-only">Share of allowance used</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {budget.members.map((m) => (
                <tr key={m.member}>
                  <td className="mono">{m.member}</td>
                  <td className="num">{formatUsdc(m.used)}</td>
                  <td className="num">{formatUsdc(m.allowance)}</td>
                  <td className="bar-col">
                    <DotBar settled={pct(m.used, m.allowance)} reserved={pct(m.reserved, m.allowance)} label={`${m.member} used ${pct(m.used, m.allowance)}% of the allowance`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={GROUP.payouts} note={GROUP.voteIn}>
        <p className="panel-lede">{GROUP.payoutsLede}</p>
        {data.payouts.length === 0 ? (
          <p className="empty">{GROUP.payoutsEmpty}</p>
        ) : (
          <ul className="payouts">
            {data.payouts.map((p) => (
              <li key={p.proposal} className={p.flagged ? "flagged" : ""} data-receiver={p.receiver} data-verdict={p.verdict}>
                <div className="payout-head">
                  <span className="ref">#{p.proposal}</span>
                  <b>{p.description}</b>
                </div>
                <div className="payout-body">
                  <span className="mono">{p.receiver}</span>
                  <span className="num">{formatUsdc(p.amount)} USDC</span>
                  <span className="payout-verdict">
                    <VerdictMark verdict={p.verdict as PayeeVerdict} size={14} />
                    {p.flagged ? GROUP.flagged : GROUP.clear}
                  </span>
                </div>
                <p className="muted">{p.reasons.map((r) => reasonWords(r.code)).join(" ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={GROUP.calls}>
        {data.calls.length === 0 ? (
          <p className="empty">{GROUP.callsEmpty}</p>
        ) : (
          <div className="scrollx">
            <table className="rows calls">
              <thead>
                <tr>
                  <th>{GROUP.col.time}</th>
                  <th>{GROUP.col.member}</th>
                  <th>{GROUP.col.claimed}</th>
                  <th>{GROUP.col.proven}</th>
                  <th>{GROUP.col.result}</th>
                  <th className="r">{GROUP.col.amount}</th>
                  <th className="r">{GROUP.col.refund}</th>
                </tr>
              </thead>
              <tbody>
                {data.calls.map((c) => (
                  <tr key={c.call_id} data-status={c.status}>
                    <td className="mono nowrap">{when(c.created_at)}</td>
                    <td className="mono">{c.member}</td>
                    <td>{modelName(c.model_claimed)}</td>
                    <td className={c.model_proven && c.model_proven !== c.model_claimed ? "mismatch" : ""}>{modelName(c.model_proven)}</td>
                    <td>
                      <CallResult call={c} />
                    </td>
                    <td className="num r">{formatUsdc(c.amount)}</td>
                    <td className="num r">{formatUsdc(c.refund)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={GROUP.proposals}>
        {pending.length + decided.length === 0 ? (
          <p className="empty">{GROUP.proposalsEmpty}</p>
        ) : (
          <ul className="proposals">
            {[...pending, ...decided].map((p) => (
              <li key={p.id} data-status={p.status}>
                <span className="ref">#{p.id}</span>
                <span className="prop-desc">{p.description}</span>
                <span className={`prop-status s-${p.status.toLowerCase()}`}>{p.status === "InProgress" ? "Voting" : p.status}</span>
                <span className="muted num nowrap">
                  {p.approvals} for, {p.rejections} against
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={GROUP.models} note={GROUP.modelsLede}>
        <div className="scrollx">
          <table className="rows">
            <tbody>
              {data.models.map((m) => (
                <tr key={`${m.model_id}:${m.signing_address}`}>
                  <td>{m.model_id}</td>
                  <td className="mono">{m.signing_address}</td>
                  <td className="muted">{m.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
