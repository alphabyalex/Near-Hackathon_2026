import type { AgentContext, Decision, Intake } from "@redline/schemas";
import { checkPayable, checkWindow, knownRefs } from "./checks.js";
import { makeDecision } from "./decisions.js";

const MAX_SUMMARY_CHARS = 600;

export interface GuardResult {
  decision: Decision;
  /** What the guard changed. Empty means the model's decision passed through untouched. */
  notes: string[];
}

/**
 * Holds a valid model decision up against the trusted records. It can only move a decision
 * toward a human: it never turns REVIEW or FLAG into PAY, and it never reads invoice text.
 * Every change is reported, so the Gym can still score the model's own mistake as a mistake.
 */
export function applyGuard(model: Decision, intake: Intake, ctx: AgentContext): GuardResult {
  const notes: string[] = [];
  const known = knownRefs(ctx);

  const evidence = model.evidence_refs.filter((ref) => known.has(ref));
  if (evidence.length !== model.evidence_refs.length) notes.push("Removed evidence references that are not in the records.");

  const summary = model.summary.slice(0, MAX_SUMMARY_CHARS);
  if (summary.length !== model.summary.length) notes.push("Truncated an overlong summary.");

  const payable = ctx.payables.find((p) => p.payable_ref === model.matched_payable_ref);
  let matched = model.matched_payable_ref;
  if (matched !== null && !payable) {
    notes.push(`The model named payable ${matched}, which is not in this vault's records.`);
    matched = null;
  }

  if (model.decision !== "PAY") {
    return { decision: makeDecision(intake, model.decision, model.reason_codes, summary, matched, evidence), notes };
  }

  const refuse = (detail: string, codes: Decision["reason_codes"], kind: "REVIEW" | "FLAG" = "REVIEW"): GuardResult => {
    notes.push(`The model proposed PAY. ${detail}`);
    return { decision: makeDecision(intake, kind, codes, `Held for a human: ${detail}`, matched, evidence), notes };
  };

  if (!payable) return refuse("It named no payable in this vault's records.", ["NO_MATCHING_PO"]);

  const contradictions = model.reason_codes.filter((code) => code !== "MATCHED_APPROVED_PAYABLE");
  if (contradictions.length > 0) {
    return refuse(`Its own reason codes contradict paying: ${contradictions.join(", ")}.`, contradictions);
  }

  const issues = [...checkPayable(payable, ctx), ...checkWindow(payable, intake.received_at_ns)];
  if (issues.length > 0) {
    const detail = issues.map((i) => i.detail).join(" ");
    const codes = issues.map((i) => i.code);
    return refuse(detail, codes, codes.includes("ALREADY_PAID") ? "FLAG" : "REVIEW");
  }

  return { decision: makeDecision(intake, "PAY", ["MATCHED_APPROVED_PAYABLE"], summary, matched, evidence), notes };
}
