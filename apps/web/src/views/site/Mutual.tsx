/** Shared helpers for the Mutual: prices, countdowns, and signing a Mutual request with the holder's wallet. */
import { useEffect, useState } from "react";
import { poolChallenge, poolSubmit, type PoolRequest } from "../../api/ai";
import { fromBase64, signNep413, type NearWalletId } from "../../wallets/near";

export const share = (part: string, whole: string): number => (BigInt(whole) === 0n ? 0 : Number((BigInt(part) * 10_000n) / BigInt(whole)) / 100);
/** A price scaled by 1e6 as USDC with four places. */
export const price = (scaled: string): string => (Number(BigInt(scaled || "0")) / 1e6).toFixed(4);

export function sinceLaunch(p: { ward_price: string; launch_price: string }): string {
  const change = (Number(BigInt(p.ward_price)) / Number(BigInt(p.launch_price)) - 1) * 100;
  const rounded = Math.abs(change) < 0.005 ? 0 : change;
  return `${rounded > 0 ? "+" : rounded < 0 ? "-" : ""}${Math.abs(rounded).toFixed(2)}%`;
}

export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function countdown(availableAt: string, now: number): string | null {
  const left = Date.parse(availableAt) - now;
  if (left <= 0) return null;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

/** Signs a Mutual request (deposit, redeem, vote, propose) with the account's own NEAR wallet. */
export async function signMutual(walletId: NearWalletId, body: PoolRequest) {
  const ch = await poolChallenge(body);
  const signed = await signNep413(walletId, { message: ch.message, recipient: ch.recipient, nonce: fromBase64(ch.nonce) }, body.account);
  return poolSubmit({ nonce: ch.nonce, publicKey: signed.publicKey, signature: signed.signature });
}
