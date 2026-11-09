import { loadAttestations, SIM_MODEL, SIM_TEE_ACCOUNT } from "@wardline/demo-provider";
import { readEnv } from "@wardline/schemas";
import {
  NearCoverPoolClient,
  NearMeterClient,
  NearModelRegistryClient,
  makeProvider,
  makeSigner,
} from "@wardline/vault-client";
import { readFileSync } from "node:fs";
import type { DateClock as Clock } from "../time.js";
import { createSimChain, createSimMutual, SimPool, type SimChainSeed } from "./sim.js";
import type { SimReputation } from "./sim-mutual.js";
import type { AttestedModel, Chain, ChainMode, MeterClient, ReputationClient, ReputationView, TierRule } from "./types.js";

export * from "./types.js";
export { createSimChain, createSimMutual, COVER_FEE_BPS, SimMeter, SimPool, SimRegistry, type MeterHooks, type PoolHooks, type SimBudgetSeed, type SimChainSeed, type SimMutual, type SimPoolSeed } from "./sim.js";
export { DEFAULT_TIER_RULES, SimGovernance, SimReputation, type GovernanceSeed, type ReputationSeed } from "./sim-mutual.js";

/** NEAR testnet ids of the deployed contracts, from repo.config.json at the repository root. */
export interface RepoNear {
  network: string;
  rootAccount: string;
  contracts: { payeeRegistry: string; vault: string; modelRegistry: string; meter: string; coverPool: string; dao: string };
}

let repoNearCache: RepoNear | null = null;
export function repoNear(): RepoNear {
  // src/chain and dist/chain are both four levels below the repository root.
  repoNearCache ??= (JSON.parse(readFileSync(new URL("../../../../repo.config.json", import.meta.url), "utf8")) as { near: RepoNear }).near;
  return repoNearCache;
}

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
      junior: W(20),
      junior_holder: "wardline-labs.testnet",
      withdraw_delay_days: 7,
      large_claim_threshold: W(30),
      max_claim_bps: 2_500,
      positions: [
        { account: "lp-north.testnet", amount: W(70) },
        { account: "lp-harbor.testnet", amount: W(50) },
      ],
      trade_url: readEnv("WARDLINE_WARD_TRADE_URL", process.env) ?? null,
    },
  };
}

const DAY = 86_400_000;

/** More groups with a track record, for the live sim: the leaderboard, the Groups page and the home stats. */
export const SIM_GROUPS = [
  { budget_id: "bgt_mission", name: "Mission Street hacker house", owner: "mission-house.sputnikv2.testnet", members: ["dana.testnet", "eli.testnet", "build-bot.testnet"] },
  { budget_id: "bgt_nightshade", name: "Nightshade research DAO", owner: "nightshade.sputnikv2.testnet", members: ["ruth.testnet", "tomas.testnet"] },
  { budget_id: "bgt_kelp", name: "Kelp Robotics club", owner: "kelp-robotics.sputnikv2.testnet", members: ["ana.testnet", "kelp-agent.testnet"] },
] as const;

/**
 * The live sim: the launch seed plus three groups with a history (proven calls, the fees they paid,
 * one claim), and past and open WARD-holder proposals. Demo scenes and unit tests use defaultSimSeed.
 */
export function liveSimSeed(): SimChainSeed {
  const seed = defaultSimSeed();
  // The stake starts at 21.50 and paid Kelp's 1.50 claim, so it stands at 20.00 like every other screen says.
  seed.pool.junior = W(21.5);
  for (const g of SIM_GROUPS) {
    seed.budgets.push({ budget_id: g.budget_id, name: g.name, owner: g.owner, deposit: W(40), period: "week", members: g.members.map((m) => ({ member: m, allowance: W(10) })) });
  }
  seed.reputation = {
    bgt_mission: { tier: "gold", proven_calls: 412, refused_calls: 9, capped_calls: 31, blocked_payees: 2, claims: 0, clean_calls: 377, spent: W(61.8), fees_paid: W(0.74) },
    bgt_nightshade: { tier: "silver", proven_calls: 186, refused_calls: 4, capped_calls: 12, blocked_payees: 1, claims: 0, clean_calls: 14, spent: W(23.4), fees_paid: W(0.38) },
    bgt_kelp: { tier: "silver", proven_calls: 57, refused_calls: 2, capped_calls: 40, blocked_payees: 0, claims: 0, clean_calls: 47, spent: W(6.1), fees_paid: W(0.12) },
  };
  seed.claims = [
    { subject: "rcpt_kelp_parts_0331", claimant: "kelp-robotics.sputnikv2.testnet", amount: W(1.5), reason: "Wardline answered PAY for a parts vendor whose website had been taken over a day earlier.", budget_id: "bgt_kelp" },
  ];
  seed.proposals = [
    // Executed at launch: it set the fee the Gold tier still charges. (GLM-5.3 Flash is the swapped-model
    // villain in the demo, so no seed proposal covers it.)
    { proposer: "lp-north.testnet", description: "Set the Gold fee to 1.00%", action: { type: "set_fee_bps", tier: "gold", fee_bps: 100 }, opened_days_ago: 12, votes: [["lp-north.testnet", "for"], ["lp-harbor.testnet", "for"]], execute: true },
    { proposer: "lp-harbor.testnet", description: "Raise the Bronze fee to 2.50%", action: { type: "set_fee_bps", tier: "bronze", fee_bps: 250 }, opened_days_ago: 9, votes: [["lp-harbor.testnet", "for"], ["lp-north.testnet", "against"]] },
    { proposer: "lp-north.testnet", description: "Raise coverage to 1.25x for every tier", action: { type: "set_coverage_multiplier", multiplier_bps: 12_500 }, opened_days_ago: 1, votes: [["lp-north.testnet", "for"]] },
    { proposer: "lp-harbor.testnet", description: "Lower the Silver fee to 1.25%", action: { type: "set_fee_bps", tier: "silver", fee_bps: 125 }, opened_days_ago: 0.5, votes: [["lp-harbor.testnet", "for"]] },
  ];
  return seed;
}

/** Reputation in near mode until T4.6: simulated, with groups read from the meter contract's budgets. */
class MeterBackedReputation implements ReputationClient {
  readonly mode = "sim" as const;
  constructor(
    private readonly inner: SimReputation,
    private readonly meter: MeterClient,
  ) {}
  private async sync(): Promise<void> {
    for (const b of await this.meter.listBudgets().catch(() => [])) this.inner.ensure({ budget_id: b.budget_id, name: b.name || b.budget_id, owner: b.owner });
  }
  async getReputation(budgetId: string): Promise<ReputationView | null> {
    await this.sync();
    return this.inner.getReputation(budgetId);
  }
  async listReputations(): Promise<ReputationView[]> {
    await this.sync();
    return this.inner.listReputations();
  }
  tierRules(): Promise<{ rules: TierRule[]; coverage_multiplier_bps: number }> {
    return this.inner.tierRules();
  }
}

export function chainModeFromEnv(env: Record<string, string | undefined> = process.env): ChainMode {
  const mode = readEnv("WARDLINE_CHAIN_MODE", env) ?? "sim";
  if (mode !== "sim" && mode !== "near") throw new Error(`WARDLINE_CHAIN_MODE must be sim or near, not ${mode}`);
  return mode;
}

/**
 * sim: the simulations in sim.ts. near: Tharun's typed clients from @wardline/vault-client against the
 * contracts in repo.config.json (each overridable by env). Reputation and WARD voting stay simulated
 * in near mode until T4.6 deploys them.
 */
export function createChain(mode: ChainMode, now: Clock, seed: SimChainSeed = defaultSimSeed()): Chain {
  if (mode === "sim") return createSimChain(seed, now);

  const ids = repoNear().contracts;
  const rpcUrl = readEnv("WARDLINE_NEAR_RPC_URL", process.env) ?? readEnv("NEAR_RPC_URL", process.env) ?? "https://test.rpc.fastnear.com";
  const meterContract = readEnv("WARDLINE_METER_CONTRACT", process.env) ?? ids.meter;
  const registryContract = readEnv("WARDLINE_MODEL_REGISTRY_CONTRACT", process.env) ?? ids.modelRegistry;
  const poolContract = readEnv("WARDLINE_COVER_POOL_CONTRACT", process.env) ?? ids.coverPool;

  const provider = makeProvider(rpcUrl);

  const signerAccount = readEnv("WARDLINE_GATEWAY_ACCOUNT", process.env);
  const signerKey = readEnv("WARDLINE_GATEWAY_KEY", process.env);
  const signer =
    signerAccount && signerKey
      ? makeSigner(provider, signerAccount, signerKey)
      : undefined;

  const meter = new NearMeterClient({
    contractId: meterContract,
    provider,
    signer,
  });
  const registry = new NearModelRegistryClient({
    contractId: registryContract,
    provider,
    signer,
  });
  const nearPool = new NearCoverPoolClient({
    contractId: poolContract,
    provider,
    signer,
  });

  // Until T4.6: voting weights come from a simulated WARD ledger, and tiers from a simulated record
  // of the meter's budgets. Both report mode "sim" so the UI can say so.
  const shadow = new SimPool(seed.pool, now);
  const mutual = createSimMutual({ budgets: [], pool: shadow, registry: null, now });
  return { mode: "near", meter, registry, pool: nearPool, reputation: new MeterBackedReputation(mutual.reputation, meter), governance: mutual.governance };
}

/** The numbers on the Mutual home page. extraBlocked: look-alike payouts flagged right now, not yet in any group's record. */
export async function mutualStats(chain: Chain, extraBlocked = 0) {
  const [pool, claims, groups] = await Promise.all([chain.pool.getPool(), chain.pool.listClaims(), chain.reputation.listReputations()]);
  return {
    total_pooled: pool.tvl,
    ward_price: pool.ward_price,
    launch_price: pool.launch_price,
    yield_earned: pool.fees_earned,
    groups_covered: groups.length,
    proven_payments: groups.reduce((n, g) => n + g.proven_calls, 0),
    payouts: claims.filter((c) => c.status === "paid").length,
    // Below the line: never paid, and refunded where anything was held.
    below: (() => {
      const swapped = groups.reduce((n, g) => n + g.refused_calls, 0);
      const lookalike = groups.reduce((n, g) => n + g.blocked_payees, 0) + extraBlocked;
      const capped = groups.reduce((n, g) => n + g.capped_calls, 0);
      return { swapped, lookalike, capped, total: swapped + lookalike + capped };
    })(),
  };
}
