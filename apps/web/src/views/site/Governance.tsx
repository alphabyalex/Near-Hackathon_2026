/** WARD-holder voting on the Mutual: fees, coverage, which models are covered and large payouts. */
import { useEffect, useMemo, useState } from "react";
import { executeProposal, getVoteWeight, type MutualAction, type MutualProposalView, type Tier } from "../../api/ai";
import { errorText } from "../../api/public";
import { GOV, REP } from "../../brand";
import { feeText } from "../../components/TierBadge";
import { formatUsdc } from "../../format";
import { nearWallets, type NearWalletId } from "../../wallets/near";
import { countdown, signMutual, useNow } from "./Mutual";

const ward = (atomic: string): string => formatUsdc(atomic);
const pctOf = (part: string, whole: string): number => (BigInt(whole) === 0n ? 0 : Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100);

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
  }
}

/** For and against as shares of all WARD at the snapshot, with ticks at quorum and at a majority. */
function VoteBar({ p }: { p: MutualProposalView }) {
  const yes = pctOf(p.votes_for, p.snapshot_supply);
  const no = pctOf(p.votes_against, p.snapshot_supply);
  const quorum = pctOf(p.quorum, p.snapshot_supply);
  return (
    <div className="votebar" role="img" aria-label={`${GOV.votesFor} ${yes.toFixed(1)}%, ${GOV.votesAgainst} ${no.toFixed(1)}% of WARD at the snapshot. ${GOV.quorum} ${quorum.toFixed(0)}%.`}>
      <div className="vb-for" style={{ width: `${yes}%` }} />
      <div className="vb-against" style={{ width: `${no}%` }} />
      <i className="vb-tick quorum" style={{ left: `${quorum}%` }} />
      <i className="vb-tick half" style={{ left: "50%" }} />
    </div>
  );
}

interface Voter {
  account: string;
  wallet: NearWalletId | null;
}

function Proposal({ p, voter, now, onChange }: { p: MutualProposalView; voter: Voter; now: number; onChange: () => void }) {
  const [weight, setWeight] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
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
      await signMutual(voter.wallet, { account, action: "vote", id: p.id, support });
      setDone(GOV.voted(support === "for" ? GOV.votesFor.toLowerCase() : GOV.votesAgainst.toLowerCase()));
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setError(null);
    setBusy(true);
    try {
      await executeProposal(p.id);
      setDone(GOV.executed);
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const left = countdown(p.closes_at, now);
  const canVote = p.status === "open" && account !== "" && voter.wallet !== null && weight !== null && weight !== "0";
  return (
    <article className="prop" data-status={p.status} data-proposal={p.id}>
      <div className="prop-top">
        <h3>
          <span className="prop-n num">{p.id}</span> {p.description}
        </h3>
        <span className={`pstat s-${p.status}`}>{GOV.status[p.status]}</span>
      </div>
      <p className="prop-what">{describeAction(p.action)}</p>
      <VoteBar p={p} />
      <dl className="prop-facts">
        <div>
          <dt>{GOV.votesFor}</dt>
          <dd className="num">{ward(p.votes_for)} WARD</dd>
        </div>
        <div>
          <dt>{GOV.votesAgainst}</dt>
          <dd className="num">{ward(p.votes_against)} WARD</dd>
        </div>
        <div>
          <dt>{GOV.quorum}</dt>
          <dd className="num">
            {ward(p.quorum)} of {ward(p.snapshot_supply)}
          </dd>
        </div>
        <div>
          <dt>{p.status === "open" ? GOV.timeLeft : GOV.snapshot}</dt>
          <dd className="num">{p.status === "open" ? (left ?? GOV.closed) : p.snapshot_at.slice(0, 10)}</dd>
        </div>
      </dl>
      {p.status === "open" && (
        <div className="prop-act">
          <button type="button" className="sbtn" disabled={!canVote || busy} onClick={() => void vote("for")}>
            {GOV.voteFor}
          </button>
          <button type="button" className="sbtn" disabled={!canVote || busy} onClick={() => void vote("against")}>
            {GOV.voteAgainst}
          </button>
          {account && weight !== null && <small className="muted num">{weight === "0" ? GOV.noWeight : GOV.weight(ward(weight))}</small>}
        </div>
      )}
      {p.status === "passed" && (
        <div className="prop-act">
          <button type="button" className="btn sm" disabled={busy} onClick={() => void execute()}>
            {busy ? GOV.executing : GOV.execute}
          </button>
        </div>
      )}
      {p.status === "executed" && p.tx && <p className="prop-tx mono">{p.tx}</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="ok-line" role="status">
          {done}
        </p>
      )}
    </article>
  );
}

type Kind = "fee" | "coverage" | "uncover";

function ProposeForm({ voter, onChange }: { voter: Voter; onChange: () => void }) {
  const [kind, setKind] = useState<Kind>("fee");
  const [tier, setTier] = useState<Tier>("silver");
  const [value, setValue] = useState("1.25");
  const [model, setModel] = useState("z-ai/glm-5.3-flash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const action = (): MutualAction | null => {
    const n = Number(value);
    if (kind === "uncover") return model.trim().length >= 3 ? { type: "uncover_model", model_id: model.trim() } : null;
    if (!Number.isFinite(n) || n <= 0) return null;
    return kind === "fee" ? { type: "set_fee_bps", tier, fee_bps: Math.round(n * 100) } : { type: "set_coverage_multiplier", multiplier_bps: Math.round(n * 10_000) };
  };

  const submit = async () => {
    const a = action();
    if (!a || !voter.wallet) return setError(kind === "uncover" ? "Name the model to stop covering." : "Enter a number.");
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = await signMutual(voter.wallet, { account: voter.account.trim(), action: "propose", description: describeAction(a), proposal: a });
      setDone(GOV.proposed(res.proposal?.id ?? 0));
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="propose">
      <summary>{GOV.proposeTitle}</summary>
      <p className="muted">{GOV.proposeLede}</p>
      <div className="propose-row">
        <label className="field compact">
          <span>{GOV.kind}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="fee">{GOV.kinds.fee}</option>
            <option value="coverage">{GOV.kinds.coverage}</option>
            <option value="uncover">{GOV.kinds.uncover}</option>
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
        {kind === "uncover" ? (
          <label className="field compact">
            <span>{GOV.model}</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
          </label>
        ) : (
          <label className="field compact">
            <span>{kind === "fee" ? GOV.feePct : GOV.multiplier}</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </label>
        )}
        <button type="button" className="btn sm" disabled={busy || !voter.account.trim() || !voter.wallet} onClick={() => void submit()}>
          {GOV.propose}
        </button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="ok-line" role="status">
          {done}
        </p>
      )}
    </details>
  );
}

export function Governance({ proposals, account, setAccount, onChange }: { proposals: MutualProposalView[]; account: string; setAccount: (a: string) => void; onChange: () => void }) {
  const wallets = useMemo(() => nearWallets(), []);
  const [wallet, setWallet] = useState<NearWalletId | null>(wallets[0]?.id ?? null);
  const now = useNow();
  const open = proposals.filter((p) => p.status === "open" || p.status === "passed");
  const decided = proposals.filter((p) => p.status === "rejected" || p.status === "executed");
  const voter = { account, wallet };

  return (
    <section className="sec tight gov" aria-labelledby="gov-title" data-testid="governance">
      <div className="wrap">
        <span className="label">{GOV.label}</span>
        <h2 className="h2" id="gov-title">
          {GOV.title}
        </h2>
        <p className="lede ink gov-lede">{GOV.lede}</p>
        <div className="voter">
          <label className="field compact">
            <span>{GOV.voteAs}</span>
            <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="you.testnet" spellCheck={false} autoComplete="username" aria-describedby="voter-note" />
          </label>
          <fieldset className="voter-wallets">
            <legend>{GOV.wallet}</legend>
            {wallets.map((w) => (
              <button key={w.id} type="button" className="chipbtn" aria-pressed={wallet === w.id} onClick={() => setWallet(w.id)} data-wallet={w.id}>
                {w.name}
              </button>
            ))}
          </fieldset>
          <small id="voter-note" className="muted">
            {GOV.voterNote}
          </small>
        </div>
        <h3 className="h3 gov-h">{GOV.open}</h3>
        {open.length === 0 ? (
          <p className="empty">{GOV.none}</p>
        ) : (
          <div className="props">
            {open.map((p) => (
              <Proposal key={p.id} p={p} voter={voter} now={now} onChange={onChange} />
            ))}
          </div>
        )}
        <ProposeForm voter={voter} onChange={onChange} />
        <h3 className="h3 gov-h">{GOV.decided}</h3>
        {decided.length === 0 ? (
          <p className="empty">{GOV.noneDecided}</p>
        ) : (
          <div className="props">
            {decided.map((p) => (
              <Proposal key={p.id} p={p} voter={voter} now={now} onChange={onChange} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
