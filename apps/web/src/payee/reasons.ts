import type { EvidenceTier, PayeeReasonCode, PayeeVerdict } from "@redline/schemas";

/** Each reason code in plain words. The API's own detail is shown under it. */
export const REASON_WORDS: Record<PayeeReasonCode, string> = {
  VERIFIED_MATCH: "This account is linked to the vendor's domain.",
  NOT_IN_REGISTRY: "No business has linked this account.",
  ACCOUNT_NOT_VENDORS: "This is not an account the vendor linked.",
  CHAIN_NOT_VERIFIED: "The vendor has not linked an account on this chain.",
  LOOKALIKE_ACCOUNT: "This account imitates one the vendor linked.",
  COOLING_OFF: "The vendor added this account recently. It is still in its cooldown.",
  NEW_ACCOUNT: "This account was created recently.",
  RECENT_FULL_ACCESS_KEY: "A new full-access key was added to this account in the last 7 days.",
  RECENT_CODE_CHANGE: "The contract on this account changed in the last 7 days.",
  PAYEE_CHANGED: "You paid a different account for this vendor before.",
  ACCOUNT_MISSING: "This account does not exist on chain.",
  SIGNALS_UNAVAILABLE: "This account's on-chain history could not be read.",
};

export const reasonWords = (code: string): string => REASON_WORDS[code as PayeeReasonCode] ?? code;

export const TIER_CODES: Record<EvidenceTier, string> = {
  T0_NONE: "T0",
  T1_WALLET_CONTROL: "T1",
  T2_DOMAIN_LINKED: "T2",
  T3_RELATIONSHIP: "T3",
  T4_EXTERNAL_KYB: "T4",
};

export const verdictClass = (verdict: PayeeVerdict): string => (verdict === "PAY" ? "v-pay" : verdict === "HOLD" ? "v-hold" : "v-block");
