import { z } from "zod";
import { AccountIdSchema, DigestSchema, NanoTimestampSchema, RevisionSchema } from "./common.js";

export const AgentBindingSchema = z.object({
  agent_account_id: AccountIdSchema,
  public_key: z.string().min(1),
  manifest_digest: DigestSchema,
  assessment_ref: z.string().min(1),
  revision: RevisionSchema,
  expires_at_ns: NanoTimestampSchema,
  enabled: z.boolean(),
});
export type AgentBinding = z.infer<typeof AgentBindingSchema>;
