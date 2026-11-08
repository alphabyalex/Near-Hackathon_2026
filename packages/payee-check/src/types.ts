import type { PayeeCheckResult, PayeeResolveResult, PayeeSignals, PayeeVendor } from "@wardline/schemas";
import type { ParsedAccount } from "./caip.js";

/**
 * Read side of the payee registry. Tharun's on-chain client implements this; tests use
 * InMemoryPayeeRegistry. All account strings are CAIP-10.
 */
export interface PayeeRegistry {
  getVendor(domain: string): Promise<PayeeVendor | null>;
  /** Reverse index: the vendor that listed this account, active or pending. */
  getVendorByAccount(caip10: string): Promise<PayeeVendor | null>;
  /** True only if the account is the domain's, active, and past its cooling-off period. */
  isVerifiedPayee(caip10: string, domain: string): Promise<boolean>;
  /** The domain's active account on that chain, or null. */
  resolve(domain: string, chain: string): Promise<string | null>;
  listVendors(): Promise<PayeeVendor[]>;
}

/** On-chain facts about an account, without look-alike (the engine fills that in). */
export type ChainSignals = Omit<PayeeSignals, "lookalikeOf">;

export interface SignalsProvider {
  /** Must not throw. Unknown values are null; unsupported chains return supported=false. */
  getSignals(account: ParsedAccount): Promise<ChainSignals>;
}

export interface PaymentHistory {
  /** The account this payer last paid for this vendor domain, or null if never. */
  lastPaidAccount(payer: string, domain: string): Promise<string | null>;
}

export interface CheckDeps {
  registry: PayeeRegistry;
  signals: SignalsProvider;
  history?: PaymentHistory;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Network for bare NEAR ids. Default PAYEE_CHECK_CONFIG.defaultNearNetwork. */
  defaultNearNetwork?: string;
}

/** What the engine returns; the API adds caseFile, receipt and evidenceTier. */
export type CheckOutcome = Pick<PayeeCheckResult, "verdict" | "payee" | "reasons" | "vendor" | "signals">;
export type ResolveOutcome = Pick<PayeeResolveResult, "verdict" | "domain" | "chain" | "account" | "reasons" | "vendor">;

/** Thrown when the registry or history cannot be read. There is no honest verdict without them. */
export class PayeeDependencyError extends Error {
  constructor(
    public readonly dependency: "registry" | "history",
    cause: unknown,
  ) {
    super(`${dependency} unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PayeeDependencyError";
  }
}
