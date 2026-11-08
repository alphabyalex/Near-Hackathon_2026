import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../api/client";
import { approveItem, lastWallet, rejectItem, rememberWallet, type DeskItem, type DeskView } from "../../api/owner";
import { errorText } from "../../api/public";
import { DESK } from "../../brand";
import { LoadError, Loading } from "../../components/Loading";
import { formatAtomic, formatNs } from "../../format";
import { reasonWords } from "../../payee/reasons";
import { TierBadge, VerdictMark } from "../../payee/ResultCard";
import { nearWallets, type NearWalletId } from "../../wallets/near";

/** Seconds-precise countdown text, like 51h 59m 08s. */
export function countdown(endsAt: string, now: number): string | null {
  const left = Math.floor((Date.parse(endsAt) - now) / 1000);
  if (left <= 0) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** Shows where two accounts differ: the shared start and end stay plain, the middle is marked. */
export function AccountDiff({ account, against }: { account: string; against: string | null }) {
  if (!against || against === account) return <span className="mono acct">{account}</span>;
  let start = 0;
  while (start < account.length && start < against.length && account[start] === against[start]) start++;
  let end = 0;
  while (end < account.length - start && end < against.length - start && account[account.length - 1 - end] === against[against.length - 1 - end]) end++;
  return (
    <span className="mono acct">
      {account.slice(0, start)}
      <mark>{account.slice(start, account.length - end)}</mark>
      {account.slice(account.length - end)}
    </span>
  );
}

const amount = (a: DeskItem["amountAtStake"]): string => (a ? (a.decimals === null ? `${a.atomic} ${a.symbol}` : `${formatAtomic(a.atomic, a.decimals)} ${a.symbol}`) : "None linked");
const short = (text: string | null, keep = 10): string => (!text ? "" : text.length > keep * 2 + 3 ? `${text.slice(0, keep)}...${text.slice(-keep)}` : text);

function Item({ item, now, signingAvailable, onDone }: { item: DeskItem; now: number; signingAvailable: boolean; onDone: (note: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const wallets = useMemo(() => {
    const list = nearWallets();
    const last = lastWallet();
    return [...list.filter((w) => w.id === last), ...list.filter((w) => w.id !== last)];
  }, []);
  const left = item.cooldownEndsAt ? countdown(item.cooldownEndsAt, now) : null;
  const decimals = item.amountAtStake?.decimals ?? 6;

  const approve = async (walletId: NearWalletId) => {
    setBusy(walletId);
    setError(null);
    try {
      const result = await approveItem(item.id, walletId);
      rememberWallet(walletId);
      onDone(result.note);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!window.confirm(`Reject ${item.newAccount}? It will not be paid.`)) return;
    setBusy("reject");
    setError(null);
    try {
      await rejectItem(item.id);
      onDone("Rejected.");
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const title = `${item.kind === "endpoint_change" ? DESK.endpointChange : DESK.payeeHold}: ${item.vendor.name ?? item.vendor.domain ?? "Unknown vendor"}`;
  return (
    <article className="desk-item" aria-label={title} data-item={item.id}>
      <header className="di-head">
        <div>
          <span className="di-kind">{item.kind === "endpoint_change" ? DESK.endpointChange : DESK.payeeHold}</span>
          <h2>
            {item.vendor.name ?? "Unknown vendor"} {item.vendor.domain && <span className="mono">{item.vendor.domain}</span>}
          </h2>
        </div>
        <div className="di-badges">
          <span className={`di-verdict v-${item.verdict.toLowerCase()}`}>
            <VerdictMark verdict={item.verdict} size={14} />
            {item.verdict}
          </span>
          <TierBadge tier={item.evidenceTier} />
        </div>
      </header>

      <div className="di-accounts">
        <div>
          <span className="di-l">{DESK.oldAccount}</span>
          {item.oldAccount ? <span className="mono acct">{item.oldAccount}</span> : <span className="muted">{DESK.noPrevious}</span>}
        </div>
        <div>
          <span className="di-l">{DESK.newAccount}</span>
          <AccountDiff account={item.newAccount} against={item.oldAccount} />
        </div>
      </div>

      <dl className="di-facts">
        <div>
          <dt>{DESK.cooldown}</dt>
          <dd className="mono num" data-countdown={left ? "running" : "over"}>
            {item.cooldownEndsAt ? (left ?? DESK.cooldownOver) : "None"}
          </dd>
        </div>
        <div>
          <dt>{DESK.atStake}</dt>
          <dd className="mono num">{amount(item.amountAtStake)}</dd>
        </div>
        <div>
          <dt>{DESK.payables}</dt>
          <dd>
            {item.payables.length === 0
              ? "None open"
              : item.payables.map((p) => (
                  <span key={p.ref} className="mono di-payable">
                    {p.invoice ?? p.ref} · {formatAtomic(p.amountAtomic, decimals)} · due {formatNs(p.dueAtNs).slice(0, 10)}
                  </span>
                ))}
          </dd>
        </div>
        <div>
          <dt>{item.requestedBy ? DESK.requestedBy : "Vault"}</dt>
          <dd className="mono">{item.requestedBy ?? item.vault}</dd>
        </div>
      </dl>

      <ul className="r-reasons compact">
        {item.reasons.map((r) => (
          <li key={`${r.code}-${r.detail}`}>
            <span>{reasonWords(r.code)}</span>
            <code>{r.code}</code>
          </li>
        ))}
      </ul>

      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="di-actions">
        {choosing ? (
          <div className="di-sign" role="group" aria-label="Choose a wallet to sign">
            {wallets.map((w) => (
              <button key={w.id} type="button" className="sbtn" disabled={busy !== null} onClick={() => void approve(w.id)}>
                {busy === w.id ? "Waiting for wallet" : `Sign with ${w.name}`}
              </button>
            ))}
            <button type="button" className="sbtn ghost" disabled={busy !== null} onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="sbtn" disabled={busy !== null || !signingAvailable} onClick={() => setChoosing(true)}>
              {DESK.approve}
            </button>
            <button type="button" className="sbtn ghost" disabled={busy !== null} onClick={() => void reject()}>
              {DESK.reject}
            </button>
          </>
        )}
        <small className="muted">{signingAvailable ? DESK.signHint : "Approvals need owner sign-in turned on, so each one is signed by a wallet."}</small>
      </div>
    </article>
  );
}

export function ReviewDesk({ version, onChanged }: { version: number; onChanged: () => void }) {
  const desk = useApi<DeskView>("/owner/review-desk", version);
  const [note, setNote] = useState<string | null>(null);
  const hasCooldown = (desk.data?.items ?? []).some((i) => i.cooldownEndsAt && Date.parse(i.cooldownEndsAt) > Date.now());
  const now = useNow(hasCooldown);

  if (desk.error) return <LoadError message={desk.error} />;
  if (!desk.data) return <Loading />;
  const { items, decided, signing } = desk.data;

  return (
    <div className="desk">
      <div className="desk-intro">
        <h2>{DESK.title}</h2>
        <p>{DESK.lede}</p>
      </div>
      {note && (
        <p className="okline" role="status">
          {note}
        </p>
      )}
      {items.length === 0 ? (
        <p className="empty panel">{DESK.empty}</p>
      ) : (
        <div className="desk-list">
          {items.map((item) => (
            <Item
              key={item.id}
              item={item}
              now={now}
              signingAvailable={signing.available}
              onDone={(text) => {
                setNote(text);
                onChanged();
              }}
            />
          ))}
        </div>
      )}

      <section className="panel desk-log" aria-labelledby="decided-title">
        <div className="ph">
          <h2 id="decided-title">{DESK.decidedTitle}</h2>
          <span>Who decided what, and when</span>
        </div>
        {decided.length === 0 ? (
          <p className="empty">{DESK.decidedEmpty}</p>
        ) : (
          <div className="scrollx">
            <table className="rows">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Account</th>
                  <th scope="col">Decision</th>
                  <th scope="col">By</th>
                  <th scope="col">When (UTC)</th>
                  <th scope="col">Signature</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((d) => (
                  <tr key={d.id} data-decided={d.id}>
                    <td>
                      {d.vendor.name ?? d.vendor.domain}
                      <span className="ref">
                        {d.kind === "endpoint_change" ? `${DESK.endpointChange}, revision ${d.revision}` : DESK.payeeHold}
                      </span>
                    </td>
                    <td className="mono clip" title={d.newAccount}>
                      {d.newAccount}
                    </td>
                    <td className={d.decision.decision === "approved" ? "ok" : "bad"}>{d.decision.decision}</td>
                    <td className="mono">{d.decision.by}</td>
                    <td className="mono nowrap">{d.decision.at.slice(0, 16).replace("T", " ")}</td>
                    <td className="mono" title={d.decision.signature ?? ""}>
                      {d.decision.signature ? short(d.decision.signature) : "Not needed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
