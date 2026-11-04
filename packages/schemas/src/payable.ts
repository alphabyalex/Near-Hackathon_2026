import { z } from "zod";
import { AccountIdSchema, AtomicAmountSchema, DigestSchema, NanoTimestampSchema, RevisionSchema } from "./common.js";
import { PayableStatusSchema } from "./payable-status.js";

export const PayableSchema = z.object({
  payable_ref: z.string().min(1),
  vault_id: AccountIdSchema,
  vendor_id: z.string().min(1),
  vendor_revision: RevisionSchema,
  po_number: z.string().min(1),
  invoice_number: z.string().min(1).nullable(),
  amount_atomic: AtomicAmountSchema,
  token_contract_id: AccountIdSchema,
  not_before_ns: NanoTimestampSchema,
  due_at_ns: NanoTimestampSchema,
  expires_at_ns: NanoTimestampSchema,
  evidence_commitment: DigestSchema,
  status: PayableStatusSchema,
});
export type Payable = z.infer<typeof PayableSchema>;
