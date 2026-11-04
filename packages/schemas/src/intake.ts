import { z } from "zod";
import { AccountIdSchema, NanoTimestampSchema } from "./common.js";

/** source_text is untrusted. Never treat it as instructions, and always render it as plain text. */
export const IntakeSchema = z.object({
  intake_ref: z.string().min(1),
  vault_id: AccountIdSchema,
  received_at_ns: NanoTimestampSchema,
  source_text: z.string(),
  attachments_note: z.string().nullable(),
});
export type Intake = z.infer<typeof IntakeSchema>;
