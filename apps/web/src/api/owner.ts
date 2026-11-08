import type { EvidenceTier, PayeeReason, PayeeVerdict } from "@redline/schemas";
import { fromBase64, signNep413, type NearWalletId } from "../wallets/near";
import { apiGet, apiPost } from "./client";

export interface Session {
  account: string;
  role: "owner" | "approver";
  expiresAt?: string;
}

interface Challenge {
  account: string;
  message: string;
  recipient: string;
  nonce: string;
  expiresAt: string;
}

export const getSession = (): Promise<Session> => apiGet<Session>("/owner/auth/session");

/** NEP-413 sign-in: the API issues a single-use challenge, the wallet signs it, the API sets a session cookie. */
export async function signIn(account: string, walletId: NearWalletId): Promise<Session> {
  const challenge = await apiPost<Challenge>("/owner/auth/challenge", { account: account.trim() });
  const signed = await signNep413(walletId, { message: challenge.message, recipient: challenge.recipient, nonce: fromBase64(challenge.nonce) }, challenge.account);
  return apiPost<Session>("/owner/auth/login", { account: challenge.account, publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce });
}

export const signOut = (): Promise<unknown> => apiPost("/owner/auth/logout");

export interface DeskItem {
  id: string;
  kind: "endpoint_change" | "payee_hold";
  vault: string;
  vendor: { id: string | null; name: string | null; domain: string | null };
  revision: number;
  oldAccount: string | null;
  newAccount: string;
  verdict: PayeeVerdict;
  evidenceTier: EvidenceTier;
  reasons: PayeeReason[];
  cooldownEndsAt: string | null;
  amountAtStake: { atomic: string; symbol: string; decimals: number | null } | null;
  payables: { ref: string; invoice: string | null; amountAtomic: string; dueAtNs: string }[];
  requestedBy: string | null;
  createdAt: string;
}

export interface DecidedItem extends DeskItem {
  decision: { decision: "approved" | "rejected"; by: string; at: string; publicKey: string | null; signature: string | null; message: string | null };
}

export interface DeskView {
  items: DeskItem[];
  decided: DecidedItem[];
  signing: { recipient: string; available: boolean };
  viewer: Session;
}

/** Signs the canonical approval payload with the approver's own wallet, then submits it. */
export async function approveItem(id: string, walletId: NearWalletId): Promise<DeskView & { note: string }> {
  const path = `/owner/review-desk/${encodeURIComponent(id)}`;
  const challenge = await apiPost<Challenge>(`${path}/challenge`, {});
  const signed = await signNep413(walletId, { message: challenge.message, recipient: challenge.recipient, nonce: fromBase64(challenge.nonce) }, challenge.account);
  return apiPost(`${path}/approve`, { publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce });
}

export const rejectItem = (id: string): Promise<DeskView> => apiPost(`/owner/review-desk/${encodeURIComponent(id)}/reject`, {});

export interface ApiKeyRow {
  id: string;
  payer: string;
  label: string | null;
  callsPerDay: number;
  scopes: string[];
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
}

export const createKey = (input: { payer: string; label?: string; scopes: string[] }): Promise<ApiKeyRow & { key: string }> => apiPost("/owner/api-keys", input);
export const revokeKey = (id: string): Promise<unknown> => apiPost(`/owner/api-keys/${encodeURIComponent(id)}/revoke`);

const LAST_WALLET = "redline.lastNearWallet";

/** Per-viewer convenience: the wallet used last, offered first. */
export function lastWallet(): NearWalletId | null {
  try {
    return (localStorage.getItem(LAST_WALLET) as NearWalletId | null) ?? null;
  } catch {
    return null;
  }
}

export function rememberWallet(id: NearWalletId): void {
  try {
    localStorage.setItem(LAST_WALLET, id);
  } catch {
    // Storage can be blocked. Nothing depends on it.
  }
}
