import { z } from "zod";
import { ReasonCodeSchema } from "./reason-code.js";

export const DecisionKindSchema = z.enum(["PAY", "REVIEW", "FLAG"]);
export type DecisionKind = z.infer<typeof DecisionKindSchema>;

export const DecisionSchema = z
  .object({
    schema: z.literal("spendgym-decision-v1"),
    intake_ref: z.string().min(1),
    decision: DecisionKindSchema,
    matched_payable_ref: z.string().min(1).nullable(),
    reason_codes: z.array(ReasonCodeSchema).min(1),
    evidence_refs: z.array(z.string()),
    summary: z.string(),
  })
  .refine((d) => d.decision !== "PAY" || d.matched_payable_ref !== null, {
    message: "a PAY decision must name matched_payable_ref",
    path: ["matched_payable_ref"],
  });
export type Decision = z.infer<typeof DecisionSchema>;
