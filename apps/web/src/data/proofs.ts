/** The latest metered calls, each above or below the line. */
import { getProofs as fetchProofs, type ProofRow } from "../api/ai";
import { apiGet } from "../api/client";
import { DATA_SOURCE } from "./source";

export type { ProofRow } from "../api/ai";

export async function getProofs(limit = 12): Promise<{ mode: "sim" | "near"; proofs: ProofRow[] }> {
  if (DATA_SOURCE === "testnet") {
    try {
      const res = await apiGet<{ activity: any[]; total: number }>(`/v1/activity?limit=${limit}`);
      if (res && Array.isArray(res.activity) && res.activity.length > 0) {
        const proofs: ProofRow[] = res.activity
          .filter((a) => a.kind === "call" || a.outcome)
          .slice(0, limit)
          .map((a, i) => {
            const side = a.side === "above" ? "above" : "below";
            const isProven = a.outcome === "paid" || side === "above";
            return {
              call_id: a.tx || a.tx_hash || `call_act_${i}`,
              budget_id: a.budget_id || a.community || "",
              group: a.text?.split(":")[0]?.trim() || a.group || a.community || "Group",
              side,
              status: isProven ? "verified" : "refused",
              reason: a.reason || (side === "below" ? "MODEL_NOT_ATTESTED" : null),
              model_claimed: a.model || "deepseek-ai/DeepSeek-V4.1-Flash-1017",
              model_proven: side === "above" ? (a.model || "deepseek-ai/DeepSeek-V4.1-Flash-1017") : null,
              amount: a.amount || "0",
              refund: side === "below" ? (a.amount || "0") : "0",
              created_at: a.at || new Date().toISOString(),
              tx: a.tx || a.tx_hash || null,
            };
          });
        if (proofs.length > 0) {
          return { mode: "near", proofs };
        }
      }
    } catch {
      // Fallback to fetchProofs
    }
  }
  return fetchProofs(limit);
}
