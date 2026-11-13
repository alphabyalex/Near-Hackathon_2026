/** WARD-holder voting on the Mutual: tier fees and coverage, in plain English (old value to new). */
import { useEffect, useId, useState } from "react";
import type { MutualAction, MutualProposalView, Tier, TierRules } from "../../api/ai";
import { Problem } from "../../components/Problem";
import { TxLink } from "../../components/TxLink";
import { addPending } from "../../data/transactions";
import { executeAs, getVoteWeight } from "../../data/mutual";
import { GOV, REP } from "../../brand";
import { feeText } from "../../components/TierBadge";
import { formatUsdc } from "../../format";
import { useConnected } from "../../wallets/connected";
import type { NearWalletId } from "../../wallets/near";
import { WalletPanel } from "../../wallets/WalletPanel";
import { signMutual, useNow } from "./Mutual";

/** Whole WARD to two decimals; a fraction of one to four, so small testnet holdings fit their column. */
const ward = (atomic: string): string => {
  const n = Number(atomic) / 1e6;
  return n === 0 || n >= 1 ? formatUsdc(atomic) : n.toFixed(4);
};
const pctOf = (part: string, whole: string): number => (BigInt(whole) === 0n ? 0 : Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100);
/** A share of WARD as people say it: whole percents, one decimal under 10%. */
const pct = (n: number): string => (n === 0 ? "0" : n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString());
const times = (bps: number): string => `${Number((bps / 10_000).toFixed(2))}x`;

/** The cover pool contract's starting values (contracts/cover-pool new()), for a change with no earlier one. */
const START = { fee: { bronze: 200, silver: 150, gold: 100 } as Record<Tier, number>, coverage: 10_000, delay: 7 };

/** The value a fee, coverage or delay proposal changes, before it: the last executed change of the same kind, else the start. */
function before(p: MutualProposalView, all: MutualProposalView[]): number | null {
  const a = p.action;
  if (a.type !== "set_fee_bps" && a.type !== "set_coverage_multiplier" && a.type !== "set_withdraw_delay_days") return null;
  const earlier = all
    .filter((q) => q.status === "executed" && q.id < p.id && q.action.type === a.type && (a.type !== "set_fee_bps" || (q.action.type === "set_fee_bps" && q.action.tier === a.tier)))
    .sort((x, y) => y.id - x.id)[0];
  if (earlier) {
    if (earlier.action.type === "set_fee_bps") return earlier.action.fee_bps;
    if (earlier.action.type === "set_coverage_multiplier") return earlier.action.multiplier_bps;
    if (earlier.action.type === "set_withdraw_delay_days") return earlier.action.days;
  }
  if (a.type === "set_fee_bps") return START.fee[a.tier];
  if (a.type === "set_coverage_multiplier") return START.coverage;
  return START.delay;
}

/** Today's value, from the live tier rules when we have them. */
function current(a: MutualAction, tiers: TierRules | undefined, fallback: number | null): number | null {
  if (a.type === "set_fee_bps") return tiers?.rules.find((r) => r.tier === a.tier)?.fee_bps ?? fallback;
  if (a.type === "set_coverage_multiplier") return tiers?.coverage_multiplier_bps ?? fallback;
  return null;
}

/** "Silver groups would pay 1.25% instead of 1.5%", or once decided "Silver fee is now 1.25%, was 1.5%". */
export function changeLine(p: MutualProposalView, all: MutualProposalView[], tiers?: TierRules): string {
  const a = p.action;
  const was = before(p, all);
  if (a.type === "set_fee_bps") {
    const tier = REP.names[a.tier];
    const now = current(a, tiers, was);
    if (p.status === "executed") return GOV.nowFee(tier, feeText(a.fee_bps), feeText(was ?? a.fee_bps));
    if (p.status === "rejected") return GOV.keptFee(tier, feeText(now ?? was ?? a.fee_bps));
    return GOV.wouldFee(tier, feeText(a.fee_bps), feeText(now ?? a.fee_bps));
  }
  if (a.type === "set_coverage_multiplier") {
    const now = current(a, tiers, was);
    if (p.status === "executed") return GOV.nowCoverage(times(a.multiplier_bps), times(was ?? a.multiplier_bps));
    if (p.status === "rejected") return GOV.keptCoverage(times(now ?? was ?? a.multiplier_bps));
    return GOV.wouldCoverage(times(a.multiplier_bps), times(now ?? a.multiplier_bps));
  }
  if (a.type === "set_withdraw_delay_days") {
    const prev = was ?? 7;
    if (p.status === "executed") return `Sell wait is now ${a.days} day${a.days === 1 ? "" : "s"}, was ${prev} day${prev === 1 ? "" : "s"}`;
    if (p.status === "rejected") return `Sell wait was kept at ${prev} day${prev === 1 ? "" : "s"}`;
    return `Sell wait would be ${a.days} day${a.days === 1 ? "" : "s"} instead of ${prev} day${prev === 1 ? "" : "s"}`;
  }
  return describeAction(a);
}

/** "1 day 3 hours left", or null once voting has closed. */
export function timeLeft(closesAt: string, now: number): string | null {
  const ms = Date.parse(closesAt) - now;
  if (!(ms > 0)) return null;
  return GOV.left(Math.floor(ms / 86_400_000), Math.floor((ms % 86_400_000) / 3_600_000), Math.floor((ms % 3_600_000) / 60_000));
}

export function describeAction(a: MutualAction): string {
  switch (a.type) {
    case "set_fee_bps":
      return `Set the ${REP.names[a.tier]} fee to ${feeText(a.fee_bps)}`;
    case "set_coverage_multiplier":
      return `Set coverage to ${(a.multiplier_bps / 10_000).toFixed(2)}x each tier's base`;
    case "cover_model":
      return `Cover ${a.model_id}`;
    case "uncover_model":
      return `Stop covering ${a.model_id}`;
    case "approve_payout":
      return `Pay claim ${a.claim_id}`;
    case "set_withdraw_delay_days":
      return `Set the sell wait to ${a.days} day${a.days === 1 ? "" : "s"}`;
  }
}

/** "Needs 20% of WARD to vote. 15% so far", over a thin line that fills toward quorum. */
function Progress({ p }: { p: MutualProposalView }) {
  const cast = pctOf((BigInt(p.votes_for) + BigInt(p.votes_against)).toString(), p.snapshot_supply);
  const need = pctOf(p.quorum, p.snapshot_supply);
  const fill = need > 0 ? Math.min(cast / need, 1) : 1;
  return (
    <div className="prop-progress">
      <p className="num">{GOV.progress(pct(need), pct(cast))}</p>
      <div className="prop-line" role="progressbar" aria-label={GOV.progressLabel(pct(cast), pct(need))} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)}>
        <i style={{ width: `${fill * 100}%` }} />
      </div>
      <p className="prop-split num">{GOV.split(pct(pctOf(p.votes_for, p.snapshot_supply)), pct(pctOf(p.votes_against, p.snapshot_supply)))}</p>
    </div>
  );
}

export interface Voter {
  account: string;
  wallet: NearWalletId | null;
}

export function Proposal({ p, voter, now, onChange, all = [p], tiers }: { p: MutualProposalView; voter: Voter; now: number; onChange: () => void; all?: MutualProposalView[]; tiers?: TierRules }) {
  const [weight, setWeight] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [doneTx, setDoneTx] = useState<string | null>(null);
  const account = voter.account.trim();

  useEffect(() => {
    setWeight(null);
    if (!account || p.status !== "open") return;
    let live = true;
    const t = window.setTimeout(() => {
      getVoteWeight(p.id, account).then(
        (r) => live && setWeight(r.weight),
        () => live && setWeight(null),
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [account, p.id, p.status]);

  const vote = async (support: "for" | "against") => {
    if (!voter.wallet) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = await signMutual(voter.wallet, { account, action: "vote", id: p.id, support });
      setDoneTx(res.tx ?? null);
      if (res.tx) addPending(account, { hash: res.tx, type: "vote", proposal: p.id, support });
      setDone(GOV.voted(support === "for" ? GOV.votesFor.toLowerCase() : GOV.votesAgainst.toLowerCase()));
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = (await executeAs(voter.wallet ? { account: voter.account.trim(), wallet: voter.wallet } : null, p.id)) as { tx?: string };
      setDoneTx(res.tx ?? null);
      setDone(GOV.executed);
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const left = timeLeft(p.closes_at, now);
  const decided = p.status === "executed" || p.status === "rejected";
  const canVote = p.status === "open" && account !== "" && voter.wallet !== null && weight !== null && weight !== "0";
  return (
    <article className="prop" data-status={p.status} data-proposal={p.id}>
      <div className="prop-top">
        <h3>{p.description}</h3>
        <span className={`pstat s-${p.status}`}>{GOV.status[p.status]}</span>
      </div>
      <p className="prop-what num" data-testid="prop-change">
        {changeLine(p, all, tiers)}
      </p>
      {!decided && <Progress p={p} />}
      <p className="prop-when num">{p.status === "open" ? (left ?? GOV.closed) : decided ? GOV.decidedOn(new Date(p.executed_at ?? p.closes_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : GOV.closed}</p>
      {p.status === "open" && (
        <div className="prop-act">
          <button type="button" className="sbtn" disabled={!canVote || busy} onClick={() => void vote("for")}>
            {GOV.voteFor}
          </button>
          <button type="button" className="sbtn" disabled={!canVote || busy} onClick={() => void vote("against")}>
            {GOV.voteAgainst}
          </button>
          {/* Why the buttons are off, right beside them. */}
          <small className="muted num" data-testid="vote-why">
            {!account || !voter.wallet ? GOV.connectToVote : weight === null ? GOV.checkingWeight : weight === "0" ? GOV.noWeight : GOV.weight(ward(weight))}
          </small>
        </div>
      )}
      {p.status === "passed" && (
        <div className="prop-act">
          <button type="button" className="btn sm" disabled={busy} onClick={() => void execute()}>
            {busy ? GOV.executing : GOV.execute}
          </button>
        </div>
      )}
      {p.status === "executed" && p.tx && (
        <p className="prop-tx">
          <TxLink hash={p.tx} />
        </p>
      )}
      {error !== null && <Problem error={error} compact />}
      {done && (
        <p className="ok-line" role="status">
          {done} {doneTx && <TxLink hash={doneTx} />}
        </p>
      )}
    </article>
  );
}

type Kind = "fee" | "coverage" | "delay";

/** "Propose a change": a Horizon disclosure (a chevron that turns, aria-expanded, smooth height). */
function ProposeForm({ voter, onChange }: { voter: Voter; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const [kind, setKind] = useState<Kind>("fee");
  const [tier, setTier] = useState<Tier>("silver");
  const [value, setValue] = useState("1.25");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const action = (): MutualAction | null => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    if (kind === "fee") return { type: "set_fee_bps", tier, fee_bps: Math.round(n * 100) };
    if (kind === "coverage") return { type: "set_coverage_multiplier", multiplier_bps: Math.round(n * 10_000) };
    return { type: "set_withdraw_delay_days", days: Math.round(n) };
  };

  const submit = async () => {
    const a = action();
    if (!a || !voter.wallet) return setError(new Error("Enter a number."));
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = await signMutual(voter.wallet, { account: voter.account.trim(), action: "propose", description: describeAction(a), proposal: a });
      setDone(GOV.proposed(res.proposal?.id ?? 0));
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="propose" data-open={open || undefined}>
      <button type="button" className="disclose" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        {GOV.proposeTitle}
        <svg className="disclose-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="disclose-body" id={panel} {...(open ? {} : { inert: true })}>
        <div className="disclose-inner">
          <p className="muted">{GOV.proposeLede}</p>
          <div className="propose-row">
            <label className="field compact">
              <span>{GOV.kind}</span>
              <select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as Kind;
                  setKind(k);
                  if (k === "delay") setValue("14");
                  else if (k === "coverage") setValue("1.0");
                  else setValue("1.25");
                }}
              >
                <option value="fee">{GOV.kinds.fee}</option>
                <option value="coverage">{GOV.kinds.coverage}</option>
                <option value="delay">Sell wait (days)</option>
              </select>
            </label>
            {kind === "fee" && (
              <label className="field compact">
                <span>{GOV.tier}</span>
                <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                  {(["bronze", "silver", "gold"] as const).map((t) => (
                    <option key={t} value={t}>
                      {REP.names[t]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field compact">
              <span>{kind === "delay" ? "Sell wait (days)" : kind === "fee" ? GOV.feePct : GOV.multiplier}</span>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode={kind === "delay" ? "numeric" : "decimal"} />
            </label>
            <button type="button" className="btn sm" disabled={busy || !voter.account.trim() || !voter.wallet} onClick={() => void submit()}>
              {GOV.propose}
            </button>
          </div>
          {error !== null && <Problem error={error} compact />}
          {done && (
            <p className="ok-line" role="status">
              {done}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** WARD-holder governance. embedded: inside another page (My share), without its own section. */
export function Governance({ proposals, onChange, embedded = false, tiers }: { proposals: MutualProposalView[]; onChange: () => void; embedded?: boolean; tiers?: TierRules }) {
  const connected = useConnected();
  const [connecting, setConnecting] = useState(false);
  const now = useNow();
  const open = proposals.filter((p) => p.status === "open" || p.status === "passed");
  const decided = proposals.filter((p) => p.status === "rejected" || p.status === "executed");
  const voter = { account: connected?.account ?? "", wallet: connected?.wallet ?? null };

  const body = (
    <>
      <div className="voter">
        {connected ? (
          <span className="voter-as">
            {GOV.voteAs} <span className="acct">{connected.account}</span>
          </span>
        ) : (
          <span className="voter-as muted">{GOV.connectToVote}</span>
        )}
        <button type="button" className="btn ghost sm" onClick={() => setConnecting(true)}>
          {connected ? GOV.changeWallet : GOV.connect}
        </button>
        <small className="muted">{GOV.voterNote}</small>
      </div>
      {connecting && <WalletPanel onClose={() => setConnecting(false)} />}
      <h3 className="gov-h">{GOV.open}</h3>
      {open.length === 0 ? (
        <p className="empty">{GOV.none}</p>
      ) : (
        <div className="props">
          {open.map((p) => (
            <Proposal key={p.id} p={p} voter={voter} now={now} onChange={onChange} all={proposals} {...(tiers ? { tiers } : {})} />
          ))}
        </div>
      )}
      <ProposeForm voter={voter} onChange={onChange} />
      <h3 className="gov-h">{GOV.decided}</h3>
      {decided.length === 0 ? (
        <p className="empty">{GOV.noneDecided}</p>
      ) : (
        <div className="props">
          {decided.map((p) => (
            <Proposal key={p.id} p={p} voter={voter} now={now} onChange={onChange} all={proposals} {...(tiers ? { tiers } : {})} />
          ))}
        </div>
      )}
    </>
  );
  if (embedded) return <div className="gov embedded" data-testid="governance">{body}</div>;
  return (
    <section className="sec gov" aria-labelledby="gov-title" data-testid="governance">
      <div className="wrap">
        <h2 className="h2" id="gov-title">
          {GOV.title}
        </h2>
        <div className="lede gov-lede">
          {GOV.lede.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        {body}
      </div>
    </section>
  );
}
