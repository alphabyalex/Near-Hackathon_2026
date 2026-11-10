/**
 * What happened, newest first: proven and refused calls, payouts and changes to WARD's price.
 * sim: built from /v1/proofs and /v1/mutual. testnet: T4.7's /v1/activity and /v1/activity/stats.
 * Rows carry a transaction hash when one exists.
 */
import { getMutual, getProofs } from "../api/ai";
import { apiGet } from "../api/client";
import { DATA_SOURCE } from "./source";

export interface ActivityItem {
  at: string;
  kind: "call" | "payout" | "price" | "deposit" | "redeem" | "vote" | "proposal";
  side: "above" | "below";
  text: string;
  /** Atomic USDC, when the row moved money. */
  amount: string | null;
  /** A NEAR transaction hash, when the row came from one. */
  tx: string | null;
}

export interface ActivityStats {
  total_items: number;
  total_pooled?: string;
  pooled_usdc?: string;
  ward_price: string;
  yield_earned?: string;
  fees_earned_usdc?: string;
  claims_paid_usdc?: string;
  paid_above_line: number;
  kept_below_line: number;
  kept_below_line_by_reason?: Record<string, number>;
  price_series?: Array<{ at: string; price: string; event: string }>;
  below?: {
    swapped: number;
    lookalike: number;
    capped: number;
    total: number;
  };
}

export async function getActivity(limit = 20): Promise<ActivityItem[]> {
  if (DATA_SOURCE === "testnet") {
    const res = await apiGet<{ activity: ActivityItem[]; total: number }>(`/v1/activity?limit=${limit}`);
    return res.activity;
  }
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
export async function getActivityStats(): Promise<ActivityStats> {
  return apiGet<ActivityStats>("/v1/activity/stats");
}
