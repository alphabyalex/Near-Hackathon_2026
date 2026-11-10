/**
 * The wallet a visitor connected: an account and which wallet signs for it. Shared by the header,
 * Join the Mutual, the member card and voting, so a visitor picks it once. Kept for the tab only;
 * every money action is still signed by the wallet itself.
 */
import { useSyncExternalStore } from "react";
import { NEAR_WALLET_IDS, type NearWalletId } from "./near";

export interface Connected {
  account: string;
  wallet: NearWalletId;
}

const KEY = "wardline.connected";
const subscribers = new Set<() => void>();

function read(): Connected | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Connected;
    // A wallet from before NEAR Connect (meteor-wallet, my-near-wallet) is dropped: connect again.
    return typeof v.account === "string" && NEAR_WALLET_IDS.includes(v.wallet) ? v : null;
  } catch {
    return null;
  }
}

let current: Connected | null = typeof window === "undefined" ? null : read();

export function setConnected(next: Connected | null): void {
  current = next;
  try {
    if (next) window.sessionStorage.setItem(KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked. The in-memory value still works for this page.
  }
  subscribers.forEach((notify) => notify());
}

export function useConnected(): Connected | null {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => current,
    () => null,
  );
}
