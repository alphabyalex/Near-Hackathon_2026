/**
 * Your transactions on #/me: the account's Wardline transactions, read from the chain by the API
 * (GET /v1/people/:account/transactions), plus the ones this page just sent, shown as Pending until
 * the API returns them confirmed. Pending rows live in memory for this tab only; the list itself is
 * the chain's, so it is the same on the hosted site and on any device.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { apiGet } from "../api/client";
import { DATA_SOURCE } from "./source";

export type TxType = "buy" | "sell_request" | "sell" | "vote" | "propose" | "execute" | "send" | "receive";

export interface WalletTx {
  hash: string;
  at: string;
  type: TxType;
  status: "confirmed" | "failed" | "pending";
  usdc: string | null;
  ward: string | null;
  price: string | null;
  proposal: number | null;
  support: "for" | "against" | null;
  unlock_at: string | null;
  explorer_url: string;
}

export interface TransactionsView {
  account: string;
  transactions: WalletTx[];
  complete: boolean;
  explorer_account_url: string | null;
  totals: { deposited: string; redeemed: string };
}

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const EXPLORER = "https://testnet.nearblocks.io/txns/";

type Fetch = (account: string, pending: string[]) => Promise<TransactionsView>;
/** pending: hashes this page is waiting for, so the API looks again instead of answering from its cache. */
const fromApi: Fetch = (account, pending) => apiGet<TransactionsView>(`/v1/people/${encodeURIComponent(account)}/transactions${pending.length ? `?pending=${pending.join(",")}` : ""}`);
let fetchView: Fetch = fromApi;

/** Tests only: answer without the API (null restores it). */
export function setTransactionsFetch(next: Fetch | null): void {
  fetchView = next ?? fromApi;
}

// Pending rows, by account. A row leaves once the API returns its hash.
const pending = new Map<string, WalletTx[]>();
const subscribers = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  subscribers.forEach((f) => f());
};

/**
 * Called right after Join, a redeem or a vote: the new row shows at the top as Pending with its hash.
 * Only real transaction hashes on testnet data; anything else has nothing to confirm.
 */
export function addPending(account: string, row: Partial<WalletTx> & { hash: string; type: TxType }): void {
  if (DATA_SOURCE !== "testnet" || !HASH.test(row.hash)) return;
  const list = (pending.get(account) ?? []).filter((r) => r.hash !== row.hash);
  list.unshift({ at: new Date().toISOString(), usdc: null, ward: null, price: null, proposal: null, support: null, unlock_at: null, explorer_url: `${EXPLORER}${row.hash}`, ...row, status: "pending" });
  pending.set(account, list);
  notify();
}

export function pendingFor(account: string): WalletTx[] {
  return pending.get(account) ?? [];
}

/** Drops pending rows the API now returns, and puts the rest on top. */
export function withPending(account: string, view: TransactionsView | null): WalletTx[] {
  const known = new Set(view?.transactions.map((r) => r.hash) ?? []);
  const left = pendingFor(account).filter((r) => !known.has(r.hash));
  if (left.length !== pendingFor(account).length) {
    pending.set(account, left);
    queueMicrotask(notify);
  }
  return [...left, ...(view?.transactions ?? [])];
}

const usePendingVersion = () =>
  useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => version,
    () => 0,
  );

/** How often to ask again while a row is pending. */
export const PENDING_POLL_MS = 5_000;

/**
 * The account's transactions: loads on mount and when `tick` changes, then every 5 seconds while
 * a row is pending, until the API returns it confirmed (or failed).
 */
export function useTransactions(account: string | null, tick = 0): { view: TransactionsView | null; rows: WalletTx[]; error: unknown } {
  const v = usePendingVersion();
  const [view, setView] = useState<TransactionsView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const waiting = account ? pendingFor(account).map((r) => r.hash) : [];
  const key = waiting.join(",");

  useEffect(() => {
    if (!account || DATA_SOURCE !== "testnet") return;
    let live = true;
    let timer: number | undefined;
    const load = () => {
      const hashes = pendingFor(account).map((r) => r.hash);
      fetchView(account, hashes).then(
        (res) => {
          if (!live) return;
          setView(res);
          setError(null);
          const known = new Set(res.transactions.map((r) => r.hash));
          if (pendingFor(account).some((r) => !known.has(r.hash))) timer = window.setTimeout(load, PENDING_POLL_MS);
        },
        (e: unknown) => {
          if (!live) return;
          setError(e);
          if (pendingFor(account).length) timer = window.setTimeout(load, PENDING_POLL_MS);
        },
      );
    };
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [account, tick, key]);

  void v;
  return { view, rows: account ? withPending(account, view) : [], error };
}

/** Totals that match the table: deposits and redemptions from confirmed rows. */
export function confirmedTotals(rows: WalletTx[]): { deposited: string; redeemed: string } {
  let deposited = 0n;
  let redeemed = 0n;
  for (const r of rows) {
    if (r.status !== "confirmed" || !r.usdc) continue;
    if (r.type === "buy") deposited += BigInt(r.usdc);
    if (r.type === "sell") redeemed += BigInt(r.usdc);
  }
  return { deposited: deposited.toString(), redeemed: redeemed.toString() };
}
