import { z } from "zod";
import { DigestSchema } from "./common.js";

export const ManifestSchema = z.object({
  schema: z.literal("wardline-manifest-v1"),
  name: z.string().min(1),
  version: z.string().min(1),
  model_provider: z.string().min(1),
  model_id: z.string().min(1),
  prompt_digest: DigestSchema,
  harness_digest: DigestSchema,
  tools: z.array(z.string()),
  settings: z.record(z.string(), z.unknown()),
  created_at: z.iso.datetime(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
