const NS_PER_MS = 1_000_000n;

/** Atomic string to a grouped decimal with two places, truncated. BigInt so large amounts stay exact. */
export function formatAtomic(atomic: string, decimals: number): string {
  const value = BigInt(atomic);
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (value % scale).toString().padStart(decimals, "0").slice(0, 2).padEnd(2, "0");
  return `${whole}.${fraction}`;
}

export function formatNs(ns: string | null): string {
  if (ns === null) return "No date";
  const iso = new Date(Number(BigInt(ns) / NS_PER_MS)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export const REVIEW_STATUS_LABEL = {
  OPEN: "Open",
  APPROVED_OWNER_PAID: "Owner paid",
  REJECTED: "Rejected by owner, no payment",
  RESOLVED: "Resolved",
} as const;
