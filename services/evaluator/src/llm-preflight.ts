import { probeNearAi } from "@wardline/agent";

const isLlm = (name: string): boolean => name === "llm" || name.startsWith("llm-");

/**
 * With NEAR_AI_API_KEY set, or an LLM agent named in --agents, every requested LLM agent must load
 * and NEAR AI Cloud must answer. Otherwise the run stops, rather than scoring without the real agent.
 */
export async function requireLlmIfConfigured(
  requested: string[],
  loaded: string[],
  unavailable: string[],
  explicit: boolean,
  probe: () => Promise<string | null> = () => probeNearAi(),
): Promise<void> {
  const wanted = requested.filter(isLlm);
  if (wanted.length === 0) return;
  const configured = Boolean(process.env.NEAR_AI_API_KEY);
  if (!configured && !explicit) {
    console.warn(`WARNING: NEAR_AI_API_KEY is not set, so this run has no LLM agent: ${wanted.join(", ")} skipped.`);
    return;
  }
  const missing = unavailable.filter(isLlm);
  if (missing.length > 0) throw new Error(`LLM agent requested or configured but not loaded: ${missing.join(", ")}. Check NEAR_AI_API_KEY in .env.`);
  if (!loaded.some(isLlm)) return;
  const problem = await probe();
  if (problem) throw new Error(`LLM agent cannot run: ${problem}`);
}
