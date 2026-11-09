import type { Tier } from "../api/ai";
import { REP } from "../brand";

const LEVEL: Record<Tier, number> = { bronze: 1, silver: 2, gold: 3 };

/** Bronze, Silver or Gold as one to three halftone dots and the tier's name. */
export function TierBadge({ tier }: { tier: Tier }) {
  const level = LEVEL[tier];
  return (
    <span className="tierb" data-tier={tier} role="img" aria-label={REP.tierBadge(REP.names[tier])}>
      <span className="tierb-dots" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= level ? "on" : ""} />
        ))}
      </span>
      <span aria-hidden="true">{REP.names[tier]}</span>
    </span>
  );
}

export const feeText = (bps: number): string => `${(bps / 100).toFixed(2)}%`;
