/**
 * Local walkthrough helpers that create meter keys at startup. They are opt-in only, and refused
 * anywhere a stranger could reach them: near mode, a public bind, or NODE_ENV=production. A hosted
 * API behind a tunnel binds 127.0.0.1, so the bind check alone is not enough; the key must be set
 * explicitly and is never on by default.
 */

import type { ChainMode } from "./chain/types.js";

const WHERE = "Use it only for a local walkthrough.";

function assertLocalOnly(name: string, env: Record<string, string | undefined>, mode: ChainMode): void {
  if (mode !== "sim") throw new Error(`${name} works in sim mode only. Unset it to run with WARDLINE_CHAIN_MODE=${mode}.`);
  if (env.WARDLINE_BIND_PUBLIC === "true") throw new Error(`${name} is refused when WARDLINE_BIND_PUBLIC=true. ${WHERE}`);
  if (env.NODE_ENV === "production") throw new Error(`${name} is refused when NODE_ENV=production. ${WHERE}`);
}

/** The fixed demo meter key from WARDLINE_DEMO_METER_KEY, or null when it is not set. Never a default. */
export function demoMeterKeyFromEnv(env: Record<string, string | undefined>, mode: ChainMode): string | null {
  const key = env.WARDLINE_DEMO_METER_KEY?.trim();
  if (!key) return null;
  assertLocalOnly("WARDLINE_DEMO_METER_KEY", env, mode);
  return key;
}

/** True when WARDLINE_SEED_METER_KEYS=true asks for printed meter keys. Same limits as the demo key. */
export function seedMeterKeysFromEnv(env: Record<string, string | undefined>, mode: ChainMode): boolean {
  if (env.WARDLINE_SEED_METER_KEYS !== "true") return false;
  assertLocalOnly("WARDLINE_SEED_METER_KEYS", env, mode);
  return true;
}
