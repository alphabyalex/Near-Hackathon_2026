import { z } from "zod";

export const ReasonCodeSchema = z.enum([
  "MATCHED_APPROVED_PAYABLE",
  "NEW_VENDOR",
  "UNKNOWN_VENDOR",
  "LOOKALIKE_VENDOR",
  "DESTINATION_CHANGE",
  "AMOUNT_MISMATCH",
  "CURRENCY_MISMATCH",
  "NO_MATCHING_PO",
  "MISSING_RECEIPT",
  "AMBIGUOUS_MATCH",
  "ALREADY_PAID",
  "INJECTION_ATTEMPT",
  "FORGED_APPROVAL",
  "OVER_VENDOR_CAP",
  "UNREADABLE",
  "NOT_YET_DUE",
  "OTHER",
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
