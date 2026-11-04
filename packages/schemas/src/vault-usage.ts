import { z } from "zod";
import { AtomicAmountSchema } from "./common.js";

/** Returned by VaultGateway.getUsage. Reserved money counts against caps until it resolves. */
export const VaultUsageSchema = z.object({
  weekly_settled_atomic: AtomicAmountSchema,
  weekly_reserved_atomic: AtomicAmountSchema,
  lifetime_settled_atomic: AtomicAmountSchema,
  lifetime_reserved_atomic: AtomicAmountSchema,
  balance_atomic: AtomicAmountSchema,
});
export type VaultUsage = z.infer<typeof VaultUsageSchema>;
