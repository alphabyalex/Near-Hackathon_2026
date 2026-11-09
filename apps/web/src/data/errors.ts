/**
 * Every failure a person can meet, in the Horizon voice: what happened, then what to do next. No
 * apologies, nothing vague. Used by <Problem> everywhere a request or a wallet can fail.
 */
import { ApiRequestError } from "../api/client";
import { ERRORS } from "../brand";

export type ProblemKind = Exclude<keyof typeof ERRORS, "retry">;

export interface Explained {
  kind: ProblemKind;
  title: string;
  next: string;
  /** Show a Try again button: the same request may work in a moment. */
  retry: boolean;
}

/** Raised by a wallet, sorted into the cases a person can act on. */
export class WalletError extends Error {
  constructor(
    readonly kind: "walletRejected" | "walletMissing" | "walletMismatch",
    message: string,
  ) {
    super(message);
  }
}

export function walletError(error: unknown): WalletError {
  const text = error instanceof Error ? error.message : String(error);
  if (/reject|denied|declin|cancel|closed|user (did not|didn't)|aborted/i.test(text)) return new WalletError("walletRejected", text);
  if (/not installed|no test wallet|not found|unavailable|no wallet|extension|failed to load|is not defined/i.test(text)) return new WalletError("walletMissing", text);
  if (/signed as/i.test(text)) return new WalletError("walletMismatch", text);
  return new WalletError("walletRejected", text);
}

const CODE_KIND: Record<string, ProblemKind> = {
  CHAIN_UNAVAILABLE: "chainDown",
  BELOW_MINIMUM: "belowMinimum",
  VOTING_CLOSED: "votingClosed",
  COOLDOWN: "cooldown",
  ALREADY_VOTED: "alreadyVoted",
  NO_WEIGHT: "noWeight",
  NOT_ENOUGH_WARD: "notEnoughWard",
  ALREADY_EXECUTED: "alreadyExecuted",
  NOT_WIRED_YET: "notWired",
};

export function explain(error: unknown): Explained {
  let kind: ProblemKind = "unknown";
  if (error instanceof WalletError) kind = error.kind;
  else if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string" && CODE_KIND[(error as { code: string }).code]) {
    kind = CODE_KIND[(error as { code: string }).code]!;
  } else if (error instanceof ApiRequestError) {
    // A proxy or gateway answering for an API that is down.
    kind = error.status === 502 || error.status === 503 || error.status === 504 ? "apiDown" : "unknown";
  } else if (error instanceof TypeError) {
    // fetch rejects with a TypeError when nothing answers at all.
    kind = "apiDown";
  }
  const copy = ERRORS[kind];
  const detail = kind === "unknown" && error instanceof Error && error.message ? error.message : copy.title;
  return { kind, title: kind === "unknown" ? detail : copy.title, next: copy.next, retry: kind === "apiDown" || kind === "chainDown" };
}
