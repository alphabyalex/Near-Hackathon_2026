import { z } from "zod";
import { AtomicAmountSchema, NanoTimestampSchema } from "./common.js";

export const PurchaseOrderLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price_atomic: AtomicAmountSchema,
  line_total_atomic: AtomicAmountSchema,
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

export const PurchaseOrderSchema = z.object({
  po_number: z.string().min(1),
  vendor_id: z.string().min(1),
  lines: z.array(PurchaseOrderLineSchema).min(1),
  total_atomic: AtomicAmountSchema,
  approved_by: z.string().min(1),
  approved_at_ns: NanoTimestampSchema,
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
