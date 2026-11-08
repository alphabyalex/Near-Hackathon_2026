import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ProseSchema, type Prose } from "./prose.js";

export const NEAR_AI_BASE = "https://cloud-api.near.ai/v1";
export const PREFERRED_MODEL = "Qwen/Qwen3.8-27B-abliterated";
/** The repo's default agent model, used if the preferred model is not listed. */
export const FALLBACK_MODEL = "z-ai/glm-5.3-flash";
export const MAX_TOKENS = 900;

export interface ModelChoice {
  id: string;
  fallback: boolean;
  /** USD per token. */
  price: { input: number; output: number };
  note: string;
}

interface ListedModel {
  id: string;
  pricing?: { input?: number; output?: number };
}

/** Picks the model from GET /v1/models, which costs nothing. */
export async function chooseModel(fetchImpl: typeof fetch = fetch, baseUrl = NEAR_AI_BASE): Promise<ModelChoice> {
  const response = await fetchImpl(`${baseUrl}/models`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GET /v1/models answered ${response.status}.`);
  const body = (await response.json()) as { data?: ListedModel[] };
  const models = body.data ?? [];
  const price = (m: ListedModel) => ({ input: (m.pricing?.input ?? 0) / 1e6, output: (m.pricing?.output ?? 0) / 1e6 });
  const preferred = models.find((m) => m.id === PREFERRED_MODEL);
  if (preferred) return { id: preferred.id, fallback: false, price: price(preferred), note: `${PREFERRED_MODEL} is listed.` };
  const fallback = models.find((m) => m.id === FALLBACK_MODEL);
  if (!fallback) throw new Error(`Neither ${PREFERRED_MODEL} nor ${FALLBACK_MODEL} is listed.`);
  return { id: fallback.id, fallback: true, price: price(fallback), note: `${PREFERRED_MODEL} is not listed, so the repo default ${FALLBACK_MODEL} wrote the prose.` };
}

export interface Completion {
  prose: Prose;
  usage: { promptTokens: number; completionTokens: number };
}

export type ProseClient = (system: string, user: string) => Promise<Completion>;

const PROSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: { subject: { type: "string" }, body: { type: "string" } },
};

/** One chat completion with reasoning off, since the prose needs none and reasoning is billed. */
export function nearAiProseClient(model: ModelChoice, apiKey: string, fetchImpl: typeof fetch = fetch, baseUrl = NEAR_AI_BASE): ProseClient {
  return async (system, user) => {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.9,
        max_tokens: MAX_TOKENS,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: "json_schema", json_schema: { name: "redteam_prose", strict: true, schema: PROSE_JSON_SCHEMA } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`NEAR AI answered HTTP ${response.status}: ${text.slice(0, 200)}`);
    const body = JSON.parse(text) as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const usage = { promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 };
    const content = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw Object.assign(new Error("The model did not return JSON."), { usage });
    }
    const prose = ProseSchema.safeParse(parsed);
    if (!prose.success) throw Object.assign(new Error("The model's JSON did not match {subject, body}."), { usage });
    return { prose: prose.data, usage };
  };
}

export interface Ledger {
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string | null;
  runs: { at: string; mode: string; calls: number; costUsd: number }[];
}

export const emptyLedger = (): Ledger => ({ calls: 0, failedCalls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, model: null, runs: [] });

export const readLedger = (path: string): Ledger => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Ledger) : emptyLedger());
export const writeLedger = (path: string, ledger: Ledger): void => writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);

export const costOf = (usage: { promptTokens: number; completionTokens: number }, price: ModelChoice["price"]): number =>
  usage.promptTokens * price.input + usage.completionTokens * price.output;

/** The most one call can cost: a generous prompt estimate plus every allowed output token. */
export const worstCaseCallUsd = (price: ModelChoice["price"]): number => 1_500 * price.input + MAX_TOKENS * price.output;
