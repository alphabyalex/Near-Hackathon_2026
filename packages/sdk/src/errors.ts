import type { EvidenceTier, PayeeReason, PayeeVerdict } from "@wardline/schemas";
import type { PayeeResult } from "./receipts.js";

/** No payment may proceed. `verdict` is null when the check itself failed. */
export class WardlineBlockedError extends Error {
  override readonly name = "WardlineBlockedError";
  readonly verdict: PayeeVerdict | null;
  readonly reasons: PayeeReason[];
  readonly evidenceTier: EvidenceTier | null;

  constructor(message: string, details: { verdict?: PayeeVerdict | null; reasons?: PayeeReason[]; evidenceTier?: EvidenceTier | null; cause?: unknown } = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.verdict = details.verdict ?? null;
    this.reasons = details.reasons ?? [];
    this.evidenceTier = details.evidenceTier ?? null;
  }
}

/** The Wardline API answered with an error. Treat it as "do not pay". */
export class WardlineApiError extends Error {
  override readonly name = "WardlineApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TIER_ORDER: readonly EvidenceTier[] = ["T0_NONE", "T1_WALLET_CONTROL", "T2_DOMAIN_LINKED", "T3_RELATIONSHIP", "T4_EXTERNAL_KYB"];

/** True when the result's evidence tier is at least `minimum`. A missing tier counts as T0_NONE. */
export const meetsTier = (result: { evidenceTier?: EvidenceTier | undefined }, minimum: EvidenceTier): boolean =>
  TIER_ORDER.indexOf(result.evidenceTier ?? "T0_NONE") >= TIER_ORDER.indexOf(minimum);

/** Throws WardlineBlockedError unless the verdict is PAY, and the tier is at least `minTier` when given. */
export function assertPayable<T extends PayeeResult>(result: T, options: { minTier?: EvidenceTier } = {}): T {
  const hasTarget = "payee" in result ? true : result.account !== null;
  const tierOk = options.minTier === undefined || meetsTier(result, options.minTier);
  if (result.verdict === "PAY" && hasTarget && tierOk) return result;
  const why = result.reasons.map((r) => r.code).join(", ") || "no reasons";
  const tier = result.evidenceTier ?? "T0_NONE";
  const message = result.verdict === "PAY" && !tierOk ? `Do not pay: evidence tier ${tier} is below ${options.minTier}.` : `Do not pay: ${result.verdict} (${why}), evidence tier ${tier}.`;
  throw new WardlineBlockedError(message, { verdict: result.verdict, reasons: result.reasons, evidenceTier: tier });
}
