import type { EvaluationDetail, EvaluationReport, EvaluationSummary } from "@wardline/schemas";
import { shortDigest } from "../format";
import { useApi } from "./client";

export interface Score {
  hasRun: boolean;
  outcome: EvaluationReport["assessment_outcome"] | null;
  eligible: string;
  unsafe: string;
  exceptions: string;
  stopped: string;
  fingerprint: string;
  /** Full digest for the title attribute, when the record on NEAR confirms it. */
  fingerprintFull: string | null;
}

const PLACEHOLDER: Score = {
  hasRun: false,
  outcome: null,
  eligible: "[ ] of 20",
  unsafe: "[ ] of 20",
  exceptions: "[ ] of 8",
  stopped: "[ ] of [ ]",
  fingerprint: "[ sha256 ]",
  fingerprintFull: null,
};

/** Only a finished, assessed run counts. Example and partial runs stay on the Evaluation tab. */
export const isScoredRun = (run: EvaluationSummary): boolean => run.execution_status === "COMPLETED" && run.assessment_outcome !== "NOT_ASSESSED";

export function scoreFrom(detail: EvaluationDetail | null): Score {
  if (!detail) return PLACEHOLDER;
  const { report, verification } = detail;
  const metric = (id: string, fallback: string): string => {
    const found = report.metrics.find((m) => m.metric_id === id);
    return found ? `${found.numerator} of ${found.denominator}` : fallback;
  };
  const onChain = verification.on_chain_digest !== null && verification.matches;
  return {
    hasRun: true,
    outcome: report.assessment_outcome,
    eligible: metric("useful_payments", PLACEHOLDER.eligible),
    unsafe: metric("unsafe_proposals", PLACEHOLDER.unsafe),
    exceptions: metric("exceptions_to_human", PLACEHOLDER.exceptions),
    stopped: metric("vault_containment", PLACEHOLDER.stopped),
    fingerprint: onChain ? shortDigest(report.suite_commitment) : PLACEHOLDER.fingerprint,
    fingerprintFull: onChain ? report.suite_commitment : null,
  };
}

/** Placeholders until a scored run exists, and also if the API cannot be reached. */
export function useScore(version = 0): Score {
  const runs = useApi<EvaluationSummary[]>("/evaluations", version);
  const run = runs.data?.find(isScoredRun) ?? null;
  const detail = useApi<EvaluationDetail>(run ? `/evaluations/${encodeURIComponent(run.run_id)}` : null, version);
  return scoreFrom(detail.data);
}
