import type { OverviewView, Policy, VaultUsage } from "@spendgym/schemas";
import { formatAtomic, formatShort, percentOf } from "../format";

export interface LimitBar {
  title: string;
  settled: number;
  reserved: number;
  /** Where the red tick sits, or null for no tick. */
  cap: number | null;
  value: string;
  note: string;
}

/** Shown when the API has no data for the page. */
export const REFERENCE_LIMITS: readonly LimitBar[] = [
  { title: "Exact amount", settled: 100, reserved: 0, cap: null, value: "3,180.00", note: "per bill" },
  { title: "Vendor cap", settled: 64, reserved: 0, cap: 64, value: "5,000.00", note: "per payment" },
  { title: "Rolling 7 days", settled: 30, reserved: 30, cap: 100, value: "9,060 / 15,000", note: "4,500 reserved" },
  { title: "Lifetime ceiling", settled: 31, reserved: 0, cap: 100, value: "31,240 / 100,000", note: "owner raises only" },
];

export function weeklyBar(policy: Policy, usage: VaultUsage, decimals: number): LimitBar {
  const settled = BigInt(usage.weekly_settled_atomic);
  const reserved = BigInt(usage.weekly_reserved_atomic);
  return {
    title: "Rolling 7 days",
    settled: percentOf(settled, policy.weekly_cap_atomic),
    reserved: percentOf(reserved, policy.weekly_cap_atomic),
    cap: 100,
    value: `${formatShort((settled + reserved).toString(), decimals)} / ${formatShort(policy.weekly_cap_atomic, decimals)}`,
    note: `${formatShort(reserved.toString(), decimals)} reserved`,
  };
}

export function lifetimeBar(policy: Policy, usage: VaultUsage, decimals: number): LimitBar {
  const settled = BigInt(usage.lifetime_settled_atomic);
  const reserved = BigInt(usage.lifetime_reserved_atomic);
  return {
    title: "Lifetime ceiling",
    settled: percentOf(settled, policy.lifetime_cap_atomic),
    reserved: percentOf(reserved, policy.lifetime_cap_atomic),
    cap: 100,
    value: `${formatShort((settled + reserved).toString(), decimals)} / ${formatShort(policy.lifetime_cap_atomic, decimals)}`,
    note: "owner raises only",
  };
}

/** The four limit bars on the vault page. The overview has no general bill amount, so it uses one in flight when there is one. */
export function limitsFromOverview(data: OverviewView | null): readonly LimitBar[] {
  if (!data) return REFERENCE_LIMITS;
  const { decimals } = data.token;
  const reference = REFERENCE_LIMITS;
  const exactAtomic = data.unresolved_payments[0]?.amount_atomic;
  const topCap = data.vendors.reduce<bigint | null>((top, v) => {
    const cap = BigInt(v.per_payment_cap_atomic);
    return top === null || cap > top ? cap : top;
  }, null);

  const exact: LimitBar = exactAtomic ? { title: "Exact amount", settled: 100, reserved: 0, cap: null, value: formatAtomic(exactAtomic, decimals), note: "per bill" } : (reference[0] as LimitBar);
  const share = exactAtomic && topCap !== null ? percentOf(exactAtomic, topCap) : 64;
  const vendor: LimitBar =
    topCap !== null ? { title: "Vendor cap", settled: share, reserved: 0, cap: share, value: formatAtomic(topCap.toString(), decimals), note: "per payment" } : (reference[1] as LimitBar);

  return [exact, vendor, weeklyBar(data.policy, data.usage, decimals), lifetimeBar(data.policy, data.usage, decimals)];
}
