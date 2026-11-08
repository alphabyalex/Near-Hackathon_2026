import { loadAttestations, SIM_MODEL, SIM_TEE_ACCOUNT } from "@wardline/demo-provider";
import { readEnv } from "@wardline/schemas";
import type { DateClock as Clock } from "../time.js";
import { createSimChain, type SimChainSeed } from "./sim.js";
import type { AttestedModel, Chain, ChainMode } from "./types.js";

export * from "./types.js";
export { createSimChain, COVER_FEE_BPS, SimMeter, SimPool, SimRegistry, type SimBudgetSeed, type SimChainSeed, type SimPoolSeed } from "./sim.js";

const W = (whole: number): string => (BigInt(Math.round(whole * 1_000_000))).toString();

/** NEAR AI signers from the recorded model attestation reports in fixtures/nearai. */
export function recordedModels(): AttestedModel[] {
  return loadAttestations().map((a) => ({
    model_id: a.model,
    signing_address: a.signingAddress,
    signing_algo: "ecdsa",
    source: `NEAR AI model attestation report, recorded ${a.recordedAt.slice(0, 10)}`,
    attested_at: a.recordedAt,
  }));
}

export const SIM_TEE_MODEL: AttestedModel = {
  model_id: SIM_MODEL,
  signing_address: SIM_TEE_ACCOUNT.address.toLowerCase(),
  signing_algo: "ecdsa",
  source: "Local test TEE (simulated, sim mode only)",
  attested_at: "2026-11-08T00:00:00.000Z",
};

export const GROUP_BUDGET = "bgt_aurora";
export const GROUP_DAO = "aurora-lab.sputnikv2.testnet";

/** The group, pool and models a sim run starts with. */
export function defaultSimSeed(): SimChainSeed {
  return {
    budgets: [
      {
        budget_id: GROUP_BUDGET,
        name: "Aurora Lab shared AI budget",
        owner: GROUP_DAO,
        deposit: W(25),
        period: "week",
        members: [
          { member: "alice.testnet", allowance: W(5) },
          { member: "bob.testnet", allowance: W(5) },
          { member: "ci-agent.testnet", allowance: W(10) },
        ],
      },
    ],
    models: [...recordedModels(), SIM_TEE_MODEL],
    pool: {
      junior: W(5_000),
      junior_holder: "wardline-labs.testnet",
      senior: W(20_000),
      withdraw_delay_days: 7,
      large_claim_threshold: W(1_000),
      max_claim_bps: 1_000,
      positions: [
        { account: "lp-north.testnet", amount: W(12_000) },
        { account: "lp-harbor.testnet", amount: W(8_000) },
      ],
    },
  };
}

export function chainModeFromEnv(env: Record<string, string | undefined> = process.env): ChainMode {
  const mode = readEnv("WARDLINE_CHAIN_MODE", env) ?? "sim";
  if (mode !== "sim" && mode !== "near") throw new Error(`WARDLINE_CHAIN_MODE must be sim or near, not ${mode}`);
  return mode;
}

/**
 * sim: the simulations in sim.ts. near: Tharun's typed clients from @wardline/vault-client, which do
 * not exist yet; this refuses to start rather than fall back silently.
 */
export function createChain(mode: ChainMode, now: Clock, seed: SimChainSeed = defaultSimSeed()): Chain {
  if (mode === "sim") return createSimChain(seed, now);
  // TODO(tharun): construct MeterClient, ModelRegistryClient and CoverPoolClient from vault-client here.
  throw new Error("WARDLINE_CHAIN_MODE=near needs the meter, model registry and cover pool clients from @wardline/vault-client, which have not landed. Use sim.");
}
