import { type AgentContext, type Decision, DecisionSchema, type Digest, type Intake } from "@wardline/schemas";
import { LLM_SETTINGS, MODEL_ID, nearAiApiKey, nearAiBaseUrl } from "./agent-config.js";
import { scopeContext } from "./checks.js";
import { makeDecision } from "./decisions.js";
import { applyGuard } from "./guard.js";
import { type ChatClient, NearAiClient } from "./llm-client.js";
import { buildManifest, manifestDigest } from "./manifest.js";
import type { PromptVersion } from "./prompts.js";
import type { TeeEvidence } from "./proof.js";
import { buildMessages, type ChatMessage } from "./render.js";
import type { DecisionWithReport, ReportingAgent, TokenUsage } from "./report.js";
import { type CallLogger, estimateCostUsd, noopCallLogger } from "./telemetry.js";

export interface LlmAgentOptions {
  version?: PromptVersion;
  /** Defaults to NEAR AI Cloud with NEAR_AI_API_KEY. Tests pass a fake. */
  client?: ChatClient;
  logger?: CallLogger;
}

type ParsedOutput = { ok: true; decision: Decision } | { ok: false; problem: string };

/**
 * Reads the model's reply. The harness sets `schema` and `intake_ref` itself, after the model's
 * fields, so the model cannot redirect a decision to another intake. Unknown fields, such as an
 * amount or a recipient the model volunteers, are dropped by the schema.
 */
export function parseModelOutput(content: string, intake: Intake): ParsedOutput {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problem: "the reply was not valid JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problem: "the reply was not a JSON object" };
  }
  const parsed = DecisionSchema.safeParse({ ...value, schema: "wardline-decision-v1", intake_ref: intake.intake_ref });
  if (parsed.success) return { ok: true, decision: parsed.data };
  const fields = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, problem: fields.join("; ") };
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  prompt_tokens: a.prompt_tokens + b.prompt_tokens,
  completion_tokens: a.completion_tokens + b.completion_tokens,
  total_tokens: a.total_tokens + b.total_tokens,
});

/**
 * Asks a TEE-hosted model on NEAR AI Cloud for a decision. Sends only the prompt, the trusted
 * records for this vault, and the labeled invoice text. It has no tools and no web access.
 * Any failure ends in a REVIEW, never in a payment.
 */
export class LlmAgent implements ReportingAgent {
  readonly version: PromptVersion;
  readonly manifestDigest: Digest;
  private readonly client: ChatClient;
  private readonly logger: CallLogger;

  constructor(options: LlmAgentOptions = {}) {
    this.version = options.version ?? "A";
    this.manifestDigest = manifestDigest(buildManifest(this.version));
    this.logger = options.logger ?? noopCallLogger;
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = nearAiApiKey();
      if (!apiKey) throw new Error("NEAR_AI_API_KEY is not set. Add it to the repo root .env, or use another agent.");
      this.client = new NearAiClient({ apiKey, baseUrl: nearAiBaseUrl() });
    }
  }

  async decide(intake: Intake, ctx: AgentContext): Promise<Decision> {
    return (await this.decideWithReport(intake, ctx)).decision;
  }

  async decideWithReport(intake: Intake, ctx: AgentContext): Promise<DecisionWithReport> {
    const started = performance.now();
    const scoped = scopeContext(ctx, intake.vault_id);
    const messages: ChatMessage[] = buildMessages(this.version, intake, scoped);
    let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let lastProblem = "no attempt was made";
    let attempts = 0;
    let tee: TeeEvidence | undefined;

    while (attempts < LLM_SETTINGS.max_attempts) {
      attempts += 1;
      const base = { at: new Date().toISOString(), intake_ref: intake.intake_ref, manifest_digest: this.manifestDigest, model_id: MODEL_ID, attempt: attempts };
      try {
        const result = await this.client.complete(messages);
        tee = result.tee;
        usage = addUsage(usage, result.usage);
        const parsed = parseModelOutput(result.content, intake);
        this.logger({
          ...base,
          outcome: parsed.ok ? "ok" : "invalid_output",
          latency_ms: result.latency_ms,
          usage: result.usage,
          cost_usd: estimateCostUsd(MODEL_ID, result.usage),
          detail: parsed.ok ? null : parsed.problem,
          completion_id: result.completion_id,
        });
        if (parsed.ok) {
          const guarded = applyGuard(parsed.decision, intake, scoped);
          return this.finish(guarded.decision, started, attempts, usage, null, guarded.notes, result.content, tee);
        }
        lastProblem = parsed.problem;
        // The problem text names schema fields only. It never echoes the reply or the invoice.
        messages.push({ role: "user", content: `Your last reply was rejected: ${parsed.problem}. Reply with only the JSON object described in your instructions.` });
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : String(error);
        this.logger({
          ...base,
          outcome: "transport_error",
          latency_ms: Math.round(performance.now() - started),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          cost_usd: null,
          detail: lastProblem,
          completion_id: null,
        });
      }
    }

    const fallback = makeDecision(intake, "REVIEW", ["OTHER"], "The agent could not produce a valid decision, so this goes to a human.");
    return this.finish(fallback, started, attempts, usage, lastProblem, [], null, tee);
  }

  private finish(
    decision: Decision,
    started: number,
    attempts: number,
    usage: TokenUsage,
    fallback: string | null,
    guard: string[],
    rawOutput: string | null,
    tee?: TeeEvidence,
  ): DecisionWithReport {
    return {
      decision,
      raw_output: rawOutput,
      report: {
        ...(tee ? { tee } : {}),
        agent: "llm",
        source: "live-llm",
        manifest_digest: this.manifestDigest,
        model_id: MODEL_ID,
        latency_ms: Math.round(performance.now() - started),
        attempts,
        usage,
        cost_usd: estimateCostUsd(MODEL_ID, usage),
        fallback,
        guard,
        replay: null,
      },
    };
  }
}
