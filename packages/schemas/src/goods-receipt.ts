import { z } from "zod";
import { NanoTimestampSchema } from "./common.js";

export const GoodsReceiptSchema = z.object({
  receipt_id: z.string().min(1),
  po_number: z.string().min(1),
  received_at_ns: NanoTimestampSchema,
  note: z.string(),
});
export type GoodsReceipt = z.infer<typeof GoodsReceiptSchema>;
