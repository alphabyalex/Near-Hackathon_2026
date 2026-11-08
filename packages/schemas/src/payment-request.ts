import { z } from "zod";
import { DigestSchema, RevisionSchema } from "./common.js";

/** Carries no amount or recipient. Both are locked inside the approved payable. */
export const PaymentRequestSchema = z.object({
  payable_ref: z.string().min(1),
  request_digest: DigestSchema,
  expected_vendor_revision: RevisionSchema,
  expected_policy_revision: RevisionSchema,
  expected_binding_revision: RevisionSchema,
  manifest_digest: DigestSchema.optional(),
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;
