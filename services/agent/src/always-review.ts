import type { AgentContext, Decision, Intake } from "@wardline/schemas";
import { makeDecision } from "./decisions.js";
import { type DecisionWithReport, NO_USAGE, type ReportingAgent } from "./report.js";

/** Control: refuses everything. It catches no fraud on merit and pays nothing, so a score that rewards it is broken. */
export class AlwaysReviewControl implements ReportingAgent {
  async decide(intake: Intake, ctx: AgentContext): Promise<Decision> {
    return (await this.decideWithReport(intake, ctx)).decision;
  }

  async decideWithReport(intake: Intake, _ctx: AgentContext): Promise<DecisionWithReport> {
    return {
      decision: makeDecision(intake, "REVIEW", ["OTHER"], "Control agent: every invoice goes to a human."),
      report: {
        agent: "review",
        source: "control",
        manifest_digest: null,
        model_id: null,
        latency_ms: 0,
        attempts: 0,
        usage: NO_USAGE,
        cost_usd: null,
        fallback: null,
        guard: [],
        replay: null,
      },
    };
  }
}
