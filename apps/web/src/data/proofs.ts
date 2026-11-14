/** The latest metered calls, each above or below the line. */
import { getProofs as fetchProofs, type ProofRow } from "../api/ai";
import type { ActivityItem } from "./activity";
import { apiGet } from "../api/client";
import { DATA_SOURCE } from "./source";

export type { ProofRow } from "../api/ai";

/**
 * sim: /v1/proofs. testnet: the audited call rows from /v1/activity, each a transaction on NEAR testnet.
 * An empty feed stays empty and a failure is shown as one; neither is filled from the simulation.
 */
export async function getProofs(limit = 12, budget?: string): Promise<{ mode: "sim" | "near"; proofs: ProofRow[] }> {
  if (DATA_SOURCE !== "testnet") return fetchProofs(limit, budget);
  const res = await apiGet<{ activity: Array<ActivityItem & { actor: string; community: string; model: string | null; outcome: string; reason: string | null }> }>(`/v1/activity?kind=call&limit=${limit}${budget ? `&community=${encodeURIComponent(budget)}` : ""}`);
  const proofs: ProofRow[] = res.activity.map((a) => ({
    call_id: a.tx ?? "",
    budget_id: a.community,
    group: a.text.split(":")[0]!.trim(),
    side: a.side,
    status: a.outcome === "paid" ? "verified" : "refused",
    reason: a.reason,
    model_claimed: a.model ?? "",
    model_proven: a.outcome === "paid" ? a.model : null,
    // A refused or capped call moved nothing: the hold was released before anything was paid.
    amount: a.outcome === "paid" ? (a.amount ?? "0") : "0",
    refund: "0",
    created_at: a.at,
    tx: a.tx,
  }));
  // Calls made through this API just now (the one-line plug-in, for example) carry their own settle or
  // release hash; they join the audited rows until the next batch writes and audits them.
  const live = await fetchProofs(limit);
  const seen = new Set(proofs.map((p) => p.tx));
  for (const p of live.proofs) if (p.tx && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(p.tx) && !seen.has(p.tx)) proofs.push(p);
  proofs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { mode: "near", proofs: proofs.slice(0, limit) };
}
