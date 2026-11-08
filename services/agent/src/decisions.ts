import { type Decision, type DecisionKind, DecisionSchema, type Intake, type ReasonCode } from "@wardline/schemas";

/** Builds and validates a Decision, so no runner can return one that breaks the schema. */
export function makeDecision(
  intake: Intake,
  decision: DecisionKind,
  reasonCodes: ReasonCode[],
  summary: string,
  matchedPayableRef: string | null = null,
  evidenceRefs: string[] = [],
): Decision {
  return DecisionSchema.parse({
    schema: "wardline-decision-v1",
    intake_ref: intake.intake_ref,
    decision,
    matched_payable_ref: matchedPayableRef,
    reason_codes: [...new Set(reasonCodes)],
    evidence_refs: [...new Set(evidenceRefs)],
    summary,
  });
}
