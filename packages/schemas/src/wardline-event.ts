import { z } from "zod";

/** NEP-297 event envelope. */
export const WardlineEventSchema = z.object({
  standard: z.literal("wardline"),
  version: z.literal("1.0.0"),
  event: z.string().min(1),
  data: z.array(z.record(z.string(), z.unknown())),
});
export type WardlineEvent = z.infer<typeof WardlineEventSchema>;
