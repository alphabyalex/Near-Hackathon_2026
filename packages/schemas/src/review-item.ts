import { z } from "zod";
import { NanoTimestampSchema } from "./common.js";
import { ReasonCodeSchema } from "./reason-code.js";
import { VaultRejectionSchema } from "./vault-rejection.js";

export const ReviewSourceSchema = z.enum(["AGENT", "VAULT"]);
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

export const ReviewStatusSchema = z.enum(["OPEN", "APPROVED_OWNER_PAID", "REJECTED", "RESOLVED"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewItemSchema = z.object({
  review_id: z.string().min(1),
  intake_ref: z.string().min(1),
  payable_ref: z.string().min(1).nullable(),
  source: ReviewSourceSchema,
  reason_codes: z.array(ReasonCodeSchema).min(1),
  vault_rejection: VaultRejectionSchema.nullable(),
  due_at_ns: NanoTimestampSchema.nullable(),
  status: ReviewStatusSchema,
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;
