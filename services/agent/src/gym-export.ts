import type { AgentRunner, DecisionAdapter, Manifest } from "@wardline/schemas";
import { PaymentRequestAdapter } from "./adapter.js";
import { loadRepoEnv } from "./agent-config.js";
import { createAgent } from "./factory.js";
import { buildManifest, harnessDigest } from "./manifest.js";
import { sha256Digest } from "./canonical.js";
import type { DecisionReport, ReportingAgent } from "./report.js";

export interface GymAgentExport {
  name: string;
  label: string;
  kind: "llm" | "baseline" | "control" | "simulated_compromised";
  manifest: Manifest;
  runner: AgentRunner;
  lastUsage?: () => { input_tokens: number; output_tokens: number } | null;
  lastReport?: () => DecisionReport | null;
}

export function createDecisionAdapter(): DecisionAdapter {
  return new PaymentRequestAdapter();
}

function rulesManifest(): Manifest {
  return {
    schema: "wardline-manifest-v1",
    name: "wardline-rules-baseline",
    version: "1.0.0",
    model_provider: "rules",
    model_id: "regex-3way-match",
    prompt_digest: sha256Digest("Deterministic rules baseline from @wardline/agent"),
    harness_digest: harnessDigest(),
    tools: [],
    settings: { deterministic: true },
    created_at: "2026-11-05T00:00:00Z",
  };
}

export async function createGymAgents(): Promise<GymAgentExport[]> {
  loadRepoEnv();
  const agents: GymAgentExport[] = [];

  const rulesAgent = createAgent("rules");
  agents.push({
    name: "rules",
    label: "RulesBaseline (@wardline/agent)",
    kind: "baseline",
    manifest: rulesManifest(),
    runner: rulesAgent,
    lastUsage: () => null,
  });

  if (process.env.NEAR_AI_API_KEY) {
    for (const version of ["A", "B"] as const) {
      const llm = createAgent("llm", { version });
      let report: DecisionReport | null = null;
      const runner: ReportingAgent = {
        async decideWithReport(intake, ctx) {
          report = null;
          const result = await llm.decideWithReport(intake, ctx);
          report = result.report;
          return result;
        },
        async decide(intake, ctx) { return (await this.decideWithReport(intake, ctx)).decision; },
      };
      agents.push({
        name: version === "A" ? "llm" : "llm-b",
        label: `LlmAgent version ${version}${version === "B" ? " (intentionally weak candidate)" : ""}`,
        kind: "llm",
        manifest: buildManifest(version),
        runner,
        lastReport: () => report,
        lastUsage: () => report ? { input_tokens: report.usage.prompt_tokens, output_tokens: report.usage.completion_tokens } : null,
      });
    }
  }

  return agents;
}
