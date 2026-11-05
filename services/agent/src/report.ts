import type { AgentContext, AgentRunner, Decision, Digest, Intake } from "@redline/schemas";

export type AgentKind = "llm" | "rules" | "review" | "replay";

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export const NO_USAGE: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/**
 * How a decision was produced. Decision has no room for this, so it travels beside it.
 * The Gym should read `fallback` and `guard`: both mean the model's own answer was not used.
 */
export interface DecisionReport {
  agent: AgentKind;
  source: "live-llm" | "deterministic" | "control" | "replay";
  manifest_digest: Digest | null;
  model_id: string | null;
  latency_ms: number;
  attempts: number;
  usage: TokenUsage;
  cost_usd: number | null;
  /** Set when every model attempt failed and the harness returned its safe REVIEW. */
  fallback: string | null;
  /** Non-empty when the harness changed a valid model decision. */
  guard: string[];
  /** Set for replay runs. A miss means the decision is a safe REVIEW, not a recording. */
  replay: { hit: boolean; note: string } | null;
}

export interface DecisionWithReport {
  decision: Decision;
  report: DecisionReport;
  /** The model's reply as received, for recording. Absent for runners with no model. */
  raw_output?: string | null;
}

/** An AgentRunner that can also say how it decided. Every runner in this package is one. */
export interface ReportingAgent extends AgentRunner {
  decideWithReport(intake: Intake, ctx: AgentContext): Promise<DecisionWithReport>;
}
