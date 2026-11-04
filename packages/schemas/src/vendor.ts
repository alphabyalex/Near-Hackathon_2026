import { z } from "zod";
import { AccountIdSchema, AtomicAmountSchema, RevisionSchema } from "./common.js";

export const VendorSchema = z.object({
  vendor_id: z.string().min(1),
  display_name: z.string().min(1),
  account_id: AccountIdSchema,
  revision: RevisionSchema,
  per_payment_cap_atomic: AtomicAmountSchema,
  active: z.boolean(),
});
export type Vendor = z.infer<typeof VendorSchema>;
