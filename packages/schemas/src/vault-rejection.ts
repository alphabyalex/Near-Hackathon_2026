import { z } from "zod";

export const VaultRejectionSchema = z.enum([
  "UNKNOWN_PAYABLE",
  "ALREADY_PAID",
  "ALREADY_PENDING",
  "NOT_YET_PAYABLE",
  "PAYABLE_EXPIRED",
  "STALE_REVISION",
  "OVER_VENDOR_CAP",
  "OVER_WEEKLY_CAP",
  "OVER_LIFETIME_CAP",
  "INSUFFICIENT_BALANCE",
  "CAPACITY_FULL",
  "PAUSED",
  "BINDING_INACTIVE",
  "BAD_CALLER",
  "ENDPOINT_REVISION_MISMATCH",
  "PAYEE_NOT_VERIFIED",
  "RELEASE_MISMATCH",
]);
export type VaultRejection = z.infer<typeof VaultRejectionSchema>;
