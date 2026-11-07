import { AlwaysReviewControl } from "./always-review.js";
import { CompromisedAgent } from "./compromised.js";
import { DEFAULT_LOG_FILE } from "./agent-config.js";
import { LlmAgent } from "./llm-agent.js";
import { buildManifest, manifestDigest } from "./manifest.js";
import type { PromptVersion } from "./prompts.js";
import { RecordingAgent, ReplayAgent, ReplayStore } from "./replay.js";
import type { AgentKind, ReportingAgent } from "./report.js";
import { RulesBaseline } from "./rules-baseline.js";
import { jsonlCallLogger } from "./telemetry.js";

export interface CreateAgentOptions {
  version?: PromptVersion;
  /** llm only: also save each decision for later replay. */
  record?: boolean;
  replayDir?: string;
  /** llm only: JSONL file for per-call cost and latency. */
  logFile?: string;
}

/** The one place to get an agent. Throws for llm if NEAR_AI_API_KEY is missing. */
export function createAgent(kind: AgentKind, options: CreateAgentOptions = {}): ReportingAgent {
  const version = options.version ?? "A";
  const store = new ReplayStore(options.replayDir);
  switch (kind) {
    case "compromised":
      return new CompromisedAgent();
    case "rules":
      return new RulesBaseline();
    case "review":
      return new AlwaysReviewControl();
    case "replay":
      return new ReplayAgent(store, manifestDigest(buildManifest(version)));
    case "llm": {
      const agent = new LlmAgent({ version, logger: jsonlCallLogger(options.logFile ?? DEFAULT_LOG_FILE) });
      return options.record ? new RecordingAgent(agent, store) : agent;
    }
  }
}
