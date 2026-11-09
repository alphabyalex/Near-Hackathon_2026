import type { Tier } from "../api/ai";
import { REP } from "../brand";

/** A tier as plain text: Gold, Silver or Bronze. Never a pill. */
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className="tier-name" data-tier={tier}>
      {REP.names[tier]}
    </span>
  );
}

export const feeText = (bps: number): string => `${(bps / 100).toFixed(2)}%`;
