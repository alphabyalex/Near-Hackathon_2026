import { DecisionKindSchema, ReasonCodeSchema } from "@wardline/schemas";
import { LLM_SETTINGS, MODEL_ID } from "./agent-config.js";
import type { ChatMessage } from "./render.js";
import type { TokenUsage } from "./report.js";
import { collectProof, type TeeEvidence } from "./proof.js";

export interface ChatResult {
  tee?: TeeEvidence;
  content: string;
  usage: TokenUsage;
  latency_ms: number;
  /** Completion id, which NEAR AI's response signature endpoint takes. */
  completion_id: string | null;
}

/** The only thing the agent can do with the outside world: send messages, get text back. */
export interface ChatClient {
  complete(messages: ChatMessage[]): Promise<ChatResult>;
}

export class LlmTransportError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "LlmTransportError";
  }
}

/** What the model must fill in. The harness adds `schema` and `intake_ref` itself. */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "matched_payable_ref", "reason_codes", "evidence_refs", "summary"],
  properties: {
    decision: { type: "string", enum: DecisionKindSchema.options },
    matched_payable_ref: { type: ["string", "null"] },
    reason_codes: { type: "array", minItems: 1, items: { type: "string", enum: ReasonCodeSchema.options } },
    evidence_refs: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
} as const;

export interface NearAiClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
}

/** NEAR AI Cloud through its OpenAI-compatible API. Sends no `tools`, so the model cannot call anything. */
export class NearAiClient implements ChatClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: NearAiClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async complete(messages: ChatMessage[]): Promise<ChatResult> {
    const started = performance.now();
    let response: Response;
    const requestBody = JSON.stringify({ model: MODEL_ID, messages,
      temperature: LLM_SETTINGS.temperature, seed: LLM_SETTINGS.seed, max_tokens: LLM_SETTINGS.max_tokens,
      thinking_token_budget: LLM_SETTINGS.thinking_token_budget,
      response_format: { type: "json_schema", json_schema: { name: "wardline_decision", strict: true, schema: MODEL_OUTPUT_JSON_SCHEMA } } });
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: requestBody,
        signal: AbortSignal.timeout(LLM_SETTINGS.timeout_ms),
      });
    } catch (error) {
      throw new LlmTransportError(`request failed: ${error instanceof Error ? error.message : String(error)}`, null);
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300);
      throw new LlmTransportError(`HTTP ${response.status}: ${body}`, response.status);
    }

    const responseBody = await response.text();
    const body = JSON.parse(responseBody) as {
      id?: string;
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    } | null;
    return {
      tee: await collectProof(this.options.baseUrl, this.options.apiKey, this.fetchImpl,
        body?.id ?? null, requestBody, responseBody),
      content: body?.choices?.[0]?.message?.content ?? "",
      usage: {
        prompt_tokens: body?.usage?.prompt_tokens ?? 0,
        completion_tokens: body?.usage?.completion_tokens ?? 0,
        total_tokens: body?.usage?.total_tokens ?? 0,
      },
      latency_ms: Math.round(performance.now() - started),
      completion_id: body?.id ?? null,
    };
  }
}
