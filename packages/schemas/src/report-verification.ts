import { z } from "zod";
import { DigestSchema } from "./common.js";

/** Returned by EvidenceGateway.verifyReport. */
export const ReportVerificationSchema = z.object({
  run_id: z.string().min(1),
  matches: z.boolean(),
  computed_digest: DigestSchema,
  on_chain_digest: DigestSchema.nullable(),
});
export type ReportVerification = z.infer<typeof ReportVerificationSchema>;
