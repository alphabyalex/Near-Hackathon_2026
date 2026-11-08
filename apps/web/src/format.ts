const NS_PER_MS = 1_000_000n;
const NS_PER_HOUR = 3_600_000_000_000n;

/** Atomic string to a grouped decimal with two places, truncated. BigInt so large amounts stay exact. */
export function formatAtomic(atomic: string, decimals: number): string {
  const value = BigInt(atomic || "0");
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (value % scale).toString().padStart(decimals, "0").slice(0, 2).padEnd(2, "0");
  return `${whole}.${fraction}`;
}

/** Same as formatAtomic, dropping .00 for limit readouts like 9,060 / 15,000. */
export const formatShort = (atomic: string, decimals: number): string => formatAtomic(atomic, decimals).replace(/\.00$/, "");

export function formatNs(ns: string | null): string {
  if (ns === null) return "No date";
  const iso = new Date(Number(BigInt(ns) / NS_PER_MS)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export const nowNs = (): bigint => BigInt(Date.now()) * NS_PER_MS;

/** HH:MM for today, the date for anything older. UTC, like formatNs. */
export function timeOfDay(ns: string, now: bigint): string {
  const iso = new Date(Number(BigInt(ns) / NS_PER_MS)).toISOString();
  const today = new Date(Number(now / NS_PER_MS)).toISOString().slice(0, 10);
  return iso.slice(0, 10) === today ? iso.slice(11, 16) : iso.slice(0, 10);
}

/** Time left until a due date: "31 hours" inside 48 hours, whole days after that. */
export function dueIn(dueNs: string | null, now: bigint): string {
  if (dueNs === null) return "No date";
  const left = BigInt(dueNs) - now;
  if (left < 0n) return "overdue";
  const hours = left / NS_PER_HOUR;
  if (hours < 1n) return "under 1 hour";
  if (hours < 48n) return hours === 1n ? "1 hour" : `${hours} hours`;
  return `${hours / 24n} days`;
}

/** Share of whole as a percentage from 0 to 100, one decimal. */
export function percentOf(part: string | bigint, whole: string | bigint): number {
  const denominator = BigInt(whole);
  if (denominator <= 0n) return 0;
  const tenths = (BigInt(part) * 1000n) / denominator;
  const clamped = tenths < 0n ? 0n : tenths > 1000n ? 1000n : tenths;
  return Number(clamped) / 10;
}

/** sha256:c8f1998c3b50...5b8e. The full digest goes in a title attribute where it is shown. */
export function shortDigest(digest: string): string {
  if (!digest) return "";
  const [algorithm, hex] = digest.split(":");
  if (!hex || hex.length <= 16) return digest;
  return `${algorithm}:${hex.slice(0, 8)}...${hex.slice(-4)}`;
}

/** vault-a.wardline.testnet is Business A. Other accounts show as they are. */
export function businessName(vaultId: string): string {
  const match = /^vault-([a-z0-9]+)\./.exec(vaultId);
  return match?.[1] ? `Business ${match[1].toUpperCase()}` : vaultId;
}

export const REVIEW_STATUS_LABEL = {
  OPEN: "Open",
  APPROVED_OWNER_PAID: "Owner paid",
  REJECTED: "Rejected by owner, no payment",
  RESOLVED: "Resolved",
} as const;

/** Atomic WUSD (6 decimals) for display: two places from 1 WUSD up, every significant place below. */
export function formatWusd(atomic: string | bigint): string {
  const value = BigInt(atomic || "0");
  if (value >= 1_000_000n || value === 0n) return formatAtomic(value.toString(), 6);
  const fraction = value.toString().padStart(6, "0").replace(/0+$/, "");
  return `0.${fraction.length < 2 ? fraction.padEnd(2, "0") : fraction}`;
}
