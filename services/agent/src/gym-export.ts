import type { AgentRunner, DecisionAdapter, Manifest } from "@redline/schemas";
import { PaymentRequestAdapter } from "./adapter.js";
import { createAgent } from "./factory.js";
import { buildManifest, harnessDigest } from "./manifest.js";
import { sha256Digest } from "./canonical.js";
import type { TokenUsage } from "./report.js";

export interface GymAgentExport {
  name: string;
  label: string;
  kind: "llm" | "baseline" | "control" | "simulated_compromised";
  manifest: Manifest;
  runner: AgentRunner;
  lastUsage?: () => TokenUsage | null;
}

export function createDecisionAdapter(): DecisionAdapter {
  return new PaymentRequestAdapter();
}

function rulesManifest(): Manifest {
  return {
    schema: "redline-manifest-v1",
    name: "redline-rules-baseline",
    version: "1.0.0",
    model_provider: "rules",
    model_id: "regex-3way-match",
    prompt_digest: sha256Digest("Deterministic rules baseline from @redline/agent"),
    harness_digest: harnessDigest(),
    tools: [],
    settings: { deterministic: true },
    created_at: "2026-11-05T00:00:00Z",
  };
}

export async function createGymAgents(): Promise<GymAgentExport[]> {
  const agents: GymAgentExport[] = [];

  const rulesAgent = createAgent("rules");
  agents.push({
    name: "rules",
    label: "RulesBaseline (@redline/agent)",
    kind: "baseline",
    manifest: rulesManifest(),
    runner: rulesAgent,
    lastUsage: () => null,
  });

  if (process.env.NEAR_AI_API_KEY) {
    try {
      const llm = createAgent("llm", { version: "A" });
      agents.push({
        name: "llm",
        label: "LlmAgent (z-ai/glm-5.3-flash)",
        kind: "llm",
        manifest: buildManifest("A"),
        runner: llm,
      });
    } catch {
      // Key invalid or client failure
    }
  }

  return agents;
}
