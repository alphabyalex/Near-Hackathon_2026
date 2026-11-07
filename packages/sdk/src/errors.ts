import type { PayeeReason, PayeeVerdict } from "@redline/schemas";
import type { PayeeResult } from "./receipts.js";

/** No payment may proceed. `verdict` is null when the check itself failed. */
export class RedlineBlockedError extends Error {
  override readonly name = "RedlineBlockedError";
  readonly verdict: PayeeVerdict | null;
  readonly reasons: PayeeReason[];

  constructor(message: string, details: { verdict?: PayeeVerdict | null; reasons?: PayeeReason[]; cause?: unknown } = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.verdict = details.verdict ?? null;
    this.reasons = details.reasons ?? [];
  }
}

/** The Redline API answered with an error. Treat it as "do not pay". */
export class RedlineApiError extends Error {
  override readonly name = "RedlineApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Throws RedlineBlockedError unless the verdict is PAY. */
export function assertPayable<T extends PayeeResult>(result: T): T {
  const hasTarget = "payee" in result ? true : result.account !== null;
  if (result.verdict === "PAY" && hasTarget) return result;
  const why = result.reasons.map((r) => r.code).join(", ") || "no reasons";
  throw new RedlineBlockedError(`Do not pay: ${result.verdict} (${why}).`, { verdict: result.verdict, reasons: result.reasons });
}
