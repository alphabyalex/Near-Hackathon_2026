import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Digest } from "@wardline/schemas";
import { MODEL_PRICES } from "./agent-config.js";
import type { TokenUsage } from "./report.js";

/** One line per model call, including failed attempts. */
export interface CallRecord {
  at: string;
  intake_ref: string;
  manifest_digest: Digest;
  model_id: string;
  attempt: number;
  outcome: "ok" | "invalid_output" | "transport_error";
  latency_ms: number;
  usage: TokenUsage;
  cost_usd: number | null;
  detail: string | null;
  completion_id: string | null;
}

export type CallLogger = (record: CallRecord) => void;

/** Appends to a JSONL file. A logging failure must never change a decision, so it only warns. */
export function jsonlCallLogger(file: string): CallLogger {
  return (record) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(record)}\n`);
    } catch (error) {
      console.error(`could not write call log: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

export const noopCallLogger: CallLogger = () => {};

/** Estimate from the price table. Null if the model has no listed price. */
export function estimateCostUsd(modelId: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES[modelId];
  if (!price) return null;
  return usage.prompt_tokens * price.input + usage.completion_tokens * price.output;
}
