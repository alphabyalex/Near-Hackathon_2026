import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

/** A JSON reply shape: the schema sent to the model and the check applied to what comes back. */
export interface JsonSpec<T> {
  name: string;
  jsonSchema: Record<string, unknown>;
  parse(value: unknown): T | null;
}

export type JsonClient = <T>(system: string, user: string, spec: JsonSpec<T>) => Promise<{ value: T; usage: Usage }>;

/** One chat completion with reasoning off, since the text needs none and reasoning is billed. */
export function nearAiJsonClient(model: ModelChoice, apiKey: string, fetchImpl: typeof fetch = fetch, baseUrl = NEAR_AI_BASE): JsonClient {
  return async (system, user, spec) => {
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
        response_format: { type: "json_schema", json_schema: { name: spec.name, strict: true, schema: spec.jsonSchema } },
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
    const value = spec.parse(parsed);
    if (value === null) throw Object.assign(new Error(`The model's JSON did not match ${spec.name}.`), { usage });
    return { value, usage };
  };
}

export type Purpose = "prose" | "adversarial" | "agent";

export interface Tally {
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface Ledger extends Tally {
  model: string | null;
  byPurpose?: Partial<Record<Purpose, Tally>>;
  runs: { at: string; mode: string; calls: number; costUsd: number }[];
}

const emptyTally = (): Tally => ({ calls: 0, failedCalls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 });
export const emptyLedger = (): Ledger => ({ ...emptyTally(), model: null, runs: [] });

export const readLedger = (path: string): Ledger => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Ledger) : emptyLedger());
export const writeLedger = (path: string, ledger: Ledger): void => writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);

/** Adds one call to the totals and to its purpose. Calls made before purposes existed count as prose. */
export function charge(ledger: Ledger, purpose: Purpose, usage: Usage, costUsd: number, ok: boolean): void {
  if (!ledger.byPurpose) ledger.byPurpose = { prose: { calls: ledger.calls, failedCalls: ledger.failedCalls, promptTokens: ledger.promptTokens, completionTokens: ledger.completionTokens, costUsd: ledger.costUsd } };
  const bucket = (ledger.byPurpose[purpose] ??= emptyTally());
  for (const tally of [ledger, bucket]) {
    tally.calls++;
    if (!ok) tally.failedCalls++;
    tally.promptTokens += usage.promptTokens;
    tally.completionTokens += usage.completionTokens;
    tally.costUsd += costUsd;
  }
}

export const costOf = (usage: Usage, price: ModelChoice["price"]): number => usage.promptTokens * price.input + usage.completionTokens * price.output;

/** The most one call can cost: a generous prompt estimate plus every allowed output token. */
export const worstCaseCallUsd = (price: ModelChoice["price"]): number => 1_500 * price.input + MAX_TOKENS * price.output;
