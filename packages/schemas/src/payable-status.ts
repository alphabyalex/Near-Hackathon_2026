import { z } from "zod";

export const PayableStatusSchema = z.enum(["OPEN", "PENDING", "SETTLED", "FAILED_KNOWN", "CANCELLED", "EXPIRED"]);
export type PayableStatus = z.infer<typeof PayableStatusSchema>;
