import { z } from "zod";
import { VaultRejectionSchema } from "./vault-rejection.js";

export const RequestResultSchema = z
  .object({
    ok: z.boolean(),
    operation_id: z.string().min(1).nullable(),
    rejection: VaultRejectionSchema.nullable(),
  })
  .refine((r) => (r.ok ? r.operation_id !== null && r.rejection === null : r.operation_id === null && r.rejection !== null), {
    message: "ok results carry operation_id and no rejection; rejected results carry rejection and no operation_id",
  });
export type RequestResult = z.infer<typeof RequestResultSchema>;
