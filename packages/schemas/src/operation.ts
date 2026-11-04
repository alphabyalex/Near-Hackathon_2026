import { z } from "zod";
import { AccountIdSchema, AtomicAmountSchema, NanoTimestampSchema } from "./common.js";

export const OperationStatusSchema = z.enum(["REQUESTED", "RESERVED", "SETTLED", "FAILED_KNOWN", "OUTCOME_UNCERTAIN"]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const OperationSchema = z.object({
  operation_id: z.string().min(1),
  payable_ref: z.string().min(1),
  amount_atomic: AtomicAmountSchema,
  recipient: AccountIdSchema,
  status: OperationStatusSchema,
  attempt: z.number().int().positive(),
  reserved_at_ns: NanoTimestampSchema,
  resolved_at_ns: NanoTimestampSchema.nullable(),
  tx_hash: z.string().min(1).nullable(),
});
export type Operation = z.infer<typeof OperationSchema>;
