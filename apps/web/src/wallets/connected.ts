/**
 * The wallet a visitor connected: an account and which wallet signs for it. Shared by the header,
 * Join the Mutual, the member card and voting, so a visitor picks it once. A NEAR Connect wallet is
 * remembered across refreshes and tabs (NEAR Connect itself remembers the wallet, and near.ts checks
 * it again on load); the test wallet and the local test signer are kept for the tab only. Disconnect
 * clears both. Every money action is still signed by the wallet itself.
 */
import { useSyncExternalStore } from "react";
/** How a visitor signs: NEAR Connect, the e2e test wallet, or the local test signer. Defined here so near.ts can import it. */
export type NearWalletId = "near-connect" | "test-wallet" | "local-signer";
export const NEAR_WALLET_IDS: readonly NearWalletId[] = ["near-connect", "test-wallet", "local-signer"];

export interface Connected {
  account: string;
  wallet: NearWalletId;
  /** NEAR Connect's wallet id, such as meteor-wallet. */
  via?: string;
}

const KEY = "wardline.connected";
const subscribers = new Set<() => void>();

/** Where a connection is kept: NEAR Connect across tabs, the others for this tab only. */
const storeFor = (wallet: NearWalletId): Storage => (wallet === "near-connect" ? window.localStorage : window.sessionStorage);

function readFrom(storage: Storage): Connected | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Connected;
    // A wallet from before NEAR Connect (meteor-wallet, my-near-wallet) is dropped: connect again.
    return typeof v.account === "string" && NEAR_WALLET_IDS.includes(v.wallet) ? v : null;
  } catch {
    return null;
  }
}

function read(): Connected | null {
  let session: Connected | null = null;
  try {
    session = readFrom(window.sessionStorage);
  } catch {
    session = null;
  }
  if (session) return session;
  try {
    const kept = readFrom(window.localStorage);
    return kept?.wallet === "near-connect" ? kept : null;
  } catch {
    return null;
  }
}

let current: Connected | null = typeof window === "undefined" ? null : read();

export function setConnected(next: Connected | null): void {
  current = next;
  for (const storage of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      const s = storage();
      if (next && s === storeFor(next.wallet)) s.setItem(KEY, JSON.stringify(next));
      else s.removeItem(KEY);
    } catch {
      // Storage can be blocked. The in-memory value still works for this page.
    }
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

/** The current connection, outside React. */
export const currentConnected = (): Connected | null => current;
