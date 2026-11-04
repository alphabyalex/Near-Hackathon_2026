import { z } from "zod";
import { GoodsReceiptSchema } from "./goods-receipt.js";
import { PayableSchema } from "./payable.js";
import { PurchaseOrderSchema } from "./purchase-order.js";
import { VendorSchema } from "./vendor.js";

/** Read-only trusted data given to the agent. */
export const AgentContextSchema = z.object({
  vendors: z.array(VendorSchema),
  payables: z.array(PayableSchema),
  purchase_orders: z.array(PurchaseOrderSchema),
  receipts: z.array(GoodsReceiptSchema),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;
