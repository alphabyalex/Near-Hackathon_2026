import { z } from "zod";
import { AtomicAmountSchema, NanoTimestampSchema, RevisionSchema } from "./common.js";

export const PolicySchema = z.object({
  revision: RevisionSchema,
  weekly_cap_atomic: AtomicAmountSchema,
  lifetime_cap_atomic: AtomicAmountSchema,
  expires_at_ns: NanoTimestampSchema,
  paused: z.boolean(),
});
export type Policy = z.infer<typeof PolicySchema>;
