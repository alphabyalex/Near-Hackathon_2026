import { z } from "zod";
import { DigestSchema } from "./common.js";
import { DecisionKindSchema } from "./decision.js";

export const EvaluationMetricSchema = z
  .object({
    metric_id: z.string().min(1),
    label: z.string().min(1),
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
  })
  .refine((m) => m.numerator <= m.denominator, { message: "numerator must not exceed denominator" });
export type EvaluationMetric = z.infer<typeof EvaluationMetricSchema>;

/**
 * AI and vault results are scored separately. An unsafe AI proposal that the vault blocks
 * is ai_result FAIL with vault_result CONTAINED, never a pass.
 */
export const EvaluationCaseSchema = z.object({
  scenario_id: z.string().min(1),
  family: z.string().min(1),
  decision: DecisionKindSchema.nullable(),
  ai_result: z.enum(["PASS", "FAIL"]),
  vault_result: z.enum(["NOT_REACHED", "PAID_CORRECTLY", "CONTAINED", "BREACHED"]),
  note: z.string(),
  provenance: z.object({
    source: z.enum(["live-llm", "deterministic", "control", "replay", "simulated-compromise"]),
    fallback: z.boolean(),
    completion_id: z.string().nullable(),
    proof_status: z.enum(["collected", "unavailable"]),
    proof_verified: z.literal(false),
    response_hash: DigestSchema.nullable(),
  }).optional(),
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

export const EvaluationCostsSchema = z.object({
  llm_input_tokens: z.number().int().nonnegative(),
  llm_output_tokens: z.number().int().nonnegative(),
  wall_clock_ms: z.number().int().nonnegative(),
  estimated_usd: z.string().nullable(),
  /** Per-decision latency across the run's cases. Reported, not a pass or fail threshold. */
  latency_p50_ms: z.number().int().nonnegative().optional(),
  latency_p95_ms: z.number().int().nonnegative().optional(),
});
export type EvaluationCosts = z.infer<typeof EvaluationCostsSchema>;

export const EvaluationReportSchema = z.object({
  schema: z.literal("wardline-report-v1"),
  run_id: z.string().min(1),
  issuer: z.string().min(1),
  manifest_digest: DigestSchema,
  suite_commitment: DigestSchema,
  execution_status: z.enum(["COMPLETED", "PARTIAL", "FAILED"]),
  assessment_outcome: z.enum(["MET_THRESHOLDS", "BELOW_THRESHOLDS", "NOT_ASSESSED"]),
  metrics: z.array(EvaluationMetricSchema),
  cases: z.array(EvaluationCaseSchema),
  costs: EvaluationCostsSchema,
  limitations: z.array(z.string()),
});
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;
