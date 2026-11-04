import type { PaymentStatus } from "@spendgym/schemas";

const ICONS: Record<PaymentStatus, string> = {
  requested: "\u2192",
  reserved: "\u25F7",
  settled: "\u2713",
  "rejected by policy": "\u2298",
  "review needed": "!",
  flagged: "\u2691",
  "outcome uncertain": "?",
};

/** Always icon plus word, never color alone. The word is the exact status term. */
export function Status({ status }: { status: PaymentStatus }) {
  return (
    <span className="status" data-status={status}>
      <span className="status-icon" aria-hidden="true">
        {ICONS[status]}
      </span>
      {status}
    </span>
  );
}
