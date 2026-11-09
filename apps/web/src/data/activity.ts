/**
 * What happened, newest first: proven and refused calls, payouts and changes to WARD's price.
 * sim: built from /v1/proofs and /v1/mutual. testnet: T4.7's /v1/activity and /v1/activity/stats,
 * once their response shapes are documented. Rows carry a transaction hash when one exists.
 */
import { getMutual, getProofs } from "../api/ai";
import { DATA_SOURCE, NotWiredYet } from "./source";

export interface ActivityItem {
  at: string;
  kind: "call" | "payout" | "price";
  side: "above" | "below";
  text: string;
  /** Atomic USDC, when the row moved money. */
  amount: string | null;
  /** A NEAR transaction hash, when the row came from one. */
  tx: string | null;
}

export async function getActivity(limit = 20): Promise<ActivityItem[]> {
  if (DATA_SOURCE === "testnet") throw new NotWiredYet("/v1/activity");
  const [{ proofs }, mutual] = await Promise.all([getProofs(limit), getMutual()]);
  const calls: ActivityItem[] = proofs.map((p) => ({
    at: p.created_at,
    kind: "call",
    side: p.side,
    text: `${p.group}: ${p.side === "above" ? "proven and paid" : "refused"}`,
    amount: p.side === "above" ? p.amount : p.refund,
    tx: null,
  }));
  const payouts: ActivityItem[] = mutual.claims
    .filter((c) => c.status === "paid")
    .map((c) => ({ at: c.filed_at, kind: "payout", side: "below", text: `Payout for ${c.subject}`, amount: c.amount, tx: c.tx }));
  return [...calls, ...payouts].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Totals for the activity page (T4.7's /v1/activity/stats). */
export async function getActivityStats(): Promise<never> {
  throw new NotWiredYet("/v1/activity/stats");
}
