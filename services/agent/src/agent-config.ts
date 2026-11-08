import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Decision-affecting configuration. Every value here except the base URL and the paths is
 * written into the manifest, so changing one changes the manifest digest.
 */
export const MODEL_PROVIDER = "near-ai-cloud";

/**
 * TEE-hosted on NEAR AI Cloud's own vLLM stack (metadata.verifiable and
 * metadata.attestationSupported are both true on GET /v1/model/list). Chosen on 2026-11-05.
 * Run `pnpm --filter agent models` to re-check. See docs/AGENT.md for why this one.
 */
export const MODEL_ID = "z-ai/glm-5.3-flash";

export const DEFAULT_BASE_URL = "https://cloud-api.near.ai/v1";

/** Matches TOKEN_DECIMALS in contracts/mock-token/src/lib.rs. */
export const TOKEN_SYMBOL = "REDL";
export const TOKEN_DECIMALS = 6;

/** Sent on every chat completion and recorded in the manifest. */
export const LLM_SETTINGS = {
  temperature: 0,
  seed: 7,
  // Reasoning counts as completion tokens and defaults to an 8,192 token budget on this model, so
  // 2,000 tokens cut answers off. Cap reasoning, and leave room for the JSON answer.
  max_tokens: 4000,
  thinking_token_budget: 1024,
  response_format: "json_schema",
  max_attempts: 2,
  timeout_ms: 60000,
  token_symbol: TOKEN_SYMBOL,
  token_decimals: TOKEN_DECIMALS,
} as const;

/** The agent has no tools. This stays empty; the manifest records that it is empty. */
export const AGENT_TOOLS: string[] = [];

/** USD per token, from GET /v1/model/list on 2026-11-05. Only used for cost estimates. */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  [MODEL_ID]: { input: 0.08 / 1e6, output: 0.5 / 1e6 },
};

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
export const DEFAULT_REPLAY_DIR = join(PACKAGE_ROOT, "replay-recordings");
export const DEFAULT_LOG_FILE = join(PACKAGE_ROOT, "logs", "calls.jsonl");
export const MANIFEST_DIR = join(PACKAGE_ROOT, "manifests");
export const SCRATCH_FIXTURES_DIR = join(PACKAGE_ROOT, "scratch-fixtures");
export const DEV_FIXTURES_DIR = join(REPO_ROOT, "fixtures", "dev");

/** Loads the repo root .env if present. Values already in the environment win. */
export function loadRepoEnv(): void {
  const file = join(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export const nearAiBaseUrl = (): string => process.env.NEAR_AI_BASE_URL || DEFAULT_BASE_URL;
export const nearAiApiKey = (): string | null => process.env.NEAR_AI_API_KEY || null;

/**
 * Checks NEAR AI Cloud answers with this key and lists the model, without running inference.
 * Returns null when it is usable, otherwise the reason.
 */
export async function probeNearAi(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const key = nearAiApiKey();
  if (!key) return "NEAR_AI_API_KEY is not set.";
  let response: Response;
  try {
    response = await fetchImpl(`${nearAiBaseUrl()}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    return `NEAR AI Cloud is unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (response.status === 401 || response.status === 403) return `NEAR AI Cloud rejected the key (HTTP ${response.status}).`;
  if (!response.ok) return `NEAR AI Cloud answered HTTP ${response.status}.`;
  const text = await response.text();
  return text.includes(MODEL_ID) ? null : `NEAR AI Cloud does not list ${MODEL_ID}.`;
}
