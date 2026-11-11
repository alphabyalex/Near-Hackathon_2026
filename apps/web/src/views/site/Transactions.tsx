/**
 * Your transactions on #/me: the account's Wardline transactions, newest first, 10 at a time. Buys
 * carry a solid violet mark, sells an open one, votes a small square; no red (red is only for below
 * the line). On phones each row is a two-line card.
 */
import { useState } from "react";
import { ME, MINE } from "../../brand";
import { formatUsdc } from "../../format";
import type { TransactionsView, WalletTx } from "../../data/transactions";
import "./transactions.css";

const PAGE = 10;
const t = ME.tx;

function label(r: WalletTx): string {
  switch (r.type) {
    case "buy":
      return t.buy;
    case "sell_request":
      return t.sellRequest;
    case "sell":
      return t.sell;
    case "vote":
      return r.support === "against" ? t.votedAgainst(r.proposal) : t.votedFor(r.proposal);
    case "propose":
      return t.proposed(r.proposal);
    case "execute":
      return t.executed(r.proposal);
    case "send":
      return t.sent;
    case "receive":
      return t.received;
  }
}

/** buy and receive bring WARD in; sell and send take it out; the rest are governance. */
const flow = (r: WalletTx): "in" | "out" | "gov" => (r.type === "buy" || r.type === "receive" ? "in" : r.type === "sell" || r.type === "sell_request" || r.type === "send" ? "out" : "gov");

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const full = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const price = (p: string | null) => (p ? (Number(p) / 1_000_000).toFixed(4) : null);
const short = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-6)}`;

function Row({ r }: { r: WalletTx }) {
  const usdc = r.usdc ? formatUsdc(r.usdc) : null;
  const ward = r.ward ? formatUsdc(r.ward) : null;
  const p = price(r.price);
  return (
    <tr className={`tx-row f-${flow(r)}`} data-status={r.status} data-type={r.type}>
      <td className="tx-date num">
        <time dateTime={r.at} title={full(r.at)}>
          {when(r.at)}
        </time>
      </td>
      <td className="tx-type">
        <span className="tx-mark" aria-hidden="true" />
        <span>
          {label(r)}
          {r.type === "sell_request" && r.unlock_at && <small className="tx-sub">{t.unlocks(day(r.unlock_at))}</small>}
        </span>
      </td>
      <td className="tx-num num" data-label={t.columns.usdc}>
        {usdc ?? <span className="tx-none" aria-label="none" />}
      </td>
      <td className="tx-num num" data-label={t.columns.ward}>
        {ward ? `${flow(r) === "in" ? "+" : flow(r) === "out" ? "−" : ""}${ward}` : <span className="tx-none" aria-label="none" />}
      </td>
      <td className="tx-num num tx-price" data-label={t.columns.price}>
        {p ?? <span className="tx-none" aria-label="none" />}
      </td>
      <td className="tx-status">
        <span className={`tx-st st-${r.status}`}>
          {r.status === "pending" && <span className="tx-spin" aria-hidden="true" />}
          {t.status[r.status]}
        </span>
      </td>
      <td className="tx-hash">
        <a href={r.explorer_url} target="_blank" rel="noreferrer" className="tx-link num" aria-label={`View transaction ${r.hash.slice(0, 8)} on NearBlocks`}>
          {short(r.hash)}
        </a>
      </td>
    </tr>
  );
}

export function Transactions({ view, rows, loading }: { view: TransactionsView | null; rows: WalletTx[]; loading: boolean }) {
  const [shown, setShown] = useState(PAGE);
  const page = rows.slice(0, shown);
  const left = rows.length - page.length;
  return (
    <section className="panel pb tx-panel" aria-labelledby="me-history-title" data-testid="me-transactions">
      <div className="tx-head">
        <h2 id="me-history-title">{ME.historyTitle}</h2>
        {view?.explorer_account_url && (
          <a href={view.explorer_account_url} target="_blank" rel="noreferrer">
            {MINE.explorer}
          </a>
        )}
      </div>
      {loading && rows.length === 0 ? (
        <p className="muted" role="status">
          {t.loading}
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">{ME.historyNone}</p>
      ) : (
        <div className="tx-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th scope="col">{t.columns.date}</th>
                <th scope="col">{t.columns.type}</th>
                <th scope="col" className="tx-num">{t.columns.usdc}</th>
                <th scope="col" className="tx-num">{t.columns.ward}</th>
                <th scope="col" className="tx-num">{t.columns.price}</th>
                <th scope="col">{t.columns.status}</th>
                <th scope="col">{t.columns.hash}</th>
              </tr>
            </thead>
            <tbody>
              {page.map((r) => (
                <Row key={r.hash} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {left > 0 && (
        <button type="button" className="btn ghost sm tx-more" onClick={() => setShown((n) => n + PAGE)}>
          {t.showMore(Math.min(PAGE, left))}
        </button>
      )}
      {view && !view.complete && view.explorer_account_url && (
        <p className="tx-missing">
          {t.missing}{" "}
          <a href={view.explorer_account_url} target="_blank" rel="noreferrer">
            {t.missingLink}
          </a>
          .
        </p>
      )}
    </section>
  );
}
