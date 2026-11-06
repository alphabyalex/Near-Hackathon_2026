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
  max_tokens: 2000,
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
