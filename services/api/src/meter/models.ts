/**
 * Which upstream serves which model, and what a call may cost. Prices are NEAR AI Cloud's list prices
 * in atomic USDC (6 decimals) per million tokens. The reservation is the most a call can cost; the
 * settlement uses the token counts the provider reports, capped at the reservation. We do not prove
 * token counts, only which model's TEE signed the exact response.
 *
 * Override with WARDLINE_MODEL_ROUTES=<path to JSON with the same shape>.
 */

import { readFileSync } from "node:fs";
import { readEnv } from "@wardline/schemas";

export interface ProviderRoute {
  id: string;
  /** OpenAI-compatible base, ending in /v1. */
  baseUrl: string;
  /** Env var holding the provider API key. Never logged. */
  apiKeyEnv?: string;
  /** Who gets paid on settlement. */
  payTo: string;
}

export interface ModelRoute {
  id: string;
  provider: string;
  label: string;
  /** Atomic USDC per million prompt and completion tokens. */
  inputPerM: number;
  outputPerM: number;
  /** Flat atomic USDC per call, added to token pricing. */
  perCall?: number;
  /** Used for the reservation when the request sets no max_tokens. */
  defaultMaxTokens: number;
}

export interface RouteTable {
  providers: ProviderRoute[];
  models: ModelRoute[];
}

export const NEAR_AI: ProviderRoute = { id: "nearai", baseUrl: "https://cloud-api.near.ai/v1", apiKeyEnv: "NEAR_AI_API_KEY", payTo: "nearai.testnet" };

export const DEFAULT_ROUTES: RouteTable = {
  providers: [NEAR_AI],
  models: [
    { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", provider: "nearai", label: "DeepSeek V4.1 Flash", inputPerM: 300_000, outputPerM: 1_200_000, defaultMaxTokens: 1024 },
    { id: "z-ai/glm-5.3-flash", provider: "nearai", label: "GLM-5.3 Flash", inputPerM: 80_000, outputPerM: 500_000, defaultMaxTokens: 1024 },
    { id: "Qwen/Qwen3.6-35B-A3B-FP8", provider: "nearai", label: "Qwen3.6 35B", inputPerM: 170_000, outputPerM: 1_100_000, defaultMaxTokens: 1024 },
    { id: "Qwen/Qwen3.8-27B", provider: "nearai", label: "Qwen3.8 27B", inputPerM: 40_000, outputPerM: 1_350_000, defaultMaxTokens: 1024 },
  ],
};

export function routesFromEnv(env: Record<string, string | undefined> = process.env): RouteTable {
  const file = readEnv("WARDLINE_MODEL_ROUTES", env);
  return file ? (JSON.parse(readFileSync(file, "utf8")) as RouteTable) : DEFAULT_ROUTES;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Rough prompt size from the request bytes: about 3 bytes per token, rounded up. */
export const estimatePromptTokens = (requestBytes: number): number => Math.ceil(requestBytes / 3);

export function costFor(route: ModelRoute, promptTokens: number, completionTokens: number): bigint {
  const tokens = BigInt(route.inputPerM) * BigInt(Math.max(0, promptTokens)) + BigInt(route.outputPerM) * BigInt(Math.max(0, completionTokens));
  return ceilDiv(tokens, 1_000_000n) + BigInt(route.perCall ?? 0);
}

/** The most this request can cost: the whole prompt plus every token max_tokens allows. */
export function reservationFor(route: ModelRoute, requestBytes: number, maxTokens: number | undefined): bigint {
  return costFor(route, estimatePromptTokens(requestBytes), maxTokens ?? route.defaultMaxTokens);
}
