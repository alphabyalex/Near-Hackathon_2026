import { loadAttestations, SIM_MODEL, SIM_TEE_ACCOUNT } from "@wardline/demo-provider";
import { readEnv } from "@wardline/schemas";
import {
  NearCoverPoolClient,
  NearMeterClient,
  NearModelRegistryClient,
  makeProvider,
  makeSigner,
} from "@wardline/vault-client";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { activityPaths, auditedRows, readIfExists, REPO_ROOT } from "../activity/log.js";
import type { DateClock as Clock } from "../time.js";
import { createSimChain, createSimMutual, SimPool, type SimChainSeed } from "./sim.js";
import type { AttestedModel, Chain, ChainMode, GovernanceClient, MutualProposalView, ReputationClient, ReputationView, TierRule } from "./types.js";

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
        name: "Aurora Lab",
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

/** More groups with a track record, for the live sim: the leaderboard, the Groups page and the home stats. */
export const SIM_GROUPS = [
  { budget_id: "bgt_mission", name: "Mission Street hacker house", owner: "mission-house.sputnikv2.testnet", members: ["dana.testnet", "eli.testnet", "build-bot.testnet"] },
  { budget_id: "bgt_nightshade", name: "Nightshade DAO", owner: "nightshade.sputnikv2.testnet", members: ["ruth.testnet", "tomas.testnet"] },
  { budget_id: "bgt_hayes", name: "Hayes Valley house", owner: "hayes-valley.sputnikv2.testnet", members: ["sam.testnet", "owen.testnet"] },
  { budget_id: "bgt_kelp", name: "Kelp Collective", owner: "kelp-robotics.sputnikv2.testnet", members: ["ana.testnet", "kelp-agent.testnet"] },
] as const;

/** Solo builders: a community of one, with the budget id and "(solo)" name the Groups page recognises. */
export const SIM_SOLOS = [
  { budget_id: "bgt_ind_ivan", name: "Ivan (solo)", member: "ivan.testnet" },
  { budget_id: "bgt_ind_yuki", name: "Yuki (solo)", member: "yuki.testnet" },
  { budget_id: "bgt_ind_chloe", name: "Chloe (solo)", member: "chloe.testnet" },
  { budget_id: "bgt_ind_lucas", name: "Lucas (solo)", member: "lucas.testnet" },
  { budget_id: "bgt_ind_gabriel", name: "Gabriel (solo)", member: "gabriel.testnet" },
  { budget_id: "bgt_ind_nadia", name: "Nadia (solo)", member: "nadia.testnet" },
] as const;

/**
 * Recent calls from the live sim's groups, so the latest-proofs feed is never empty in sim mode.
 * Shaped like the public /v1/proofs rows (no member, key or request content); minutes_ago sets the time.
 */
export const SIM_SEED_PROOFS = [
  { call_id: "call_sim_seed_01", budget_id: "bgt_mission", status: "verified", reason: null, model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017", amount: "98", refund: "641", minutes_ago: 3 },
  { call_id: "call_sim_seed_02", budget_id: "bgt_nightshade", status: "verified", reason: null, model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017", amount: "142", refund: "597", minutes_ago: 9 },
  { call_id: "call_sim_seed_03", budget_id: "bgt_kelp", status: "refused", reason: "MODEL_MISMATCH", model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "z-ai/glm-5.3-flash", amount: "0", refund: "739", minutes_ago: 14 },
  { call_id: "call_sim_seed_04", budget_id: "bgt_mission", status: "verified", reason: null, model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017", amount: "117", refund: "622", minutes_ago: 22 },
  { call_id: "call_sim_seed_05", budget_id: "bgt_kelp", status: "refused", reason: "ALLOWANCE_EXHAUSTED", model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: null, amount: "0", refund: "0", minutes_ago: 31 },
  { call_id: "call_sim_seed_06", budget_id: "bgt_nightshade", status: "verified", reason: null, model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017", amount: "105", refund: "634", minutes_ago: 47 },
  { call_id: "call_sim_seed_07", budget_id: "bgt_hayes", status: "verified", reason: null, model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017", amount: "88", refund: "651", minutes_ago: 58 },
  { call_id: "call_sim_seed_08", budget_id: "bgt_ind_ivan", status: "verified", reason: null, model_claimed: "z-ai/glm-5.3-flash", model_proven: "z-ai/glm-5.3-flash", amount: "61", refund: "678", minutes_ago: 71 },
  { call_id: "call_sim_seed_09", budget_id: "bgt_hayes", status: "refused", reason: "MODEL_MISMATCH", model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "z-ai/glm-5.3-flash", amount: "0", refund: "739", minutes_ago: 96 },
  { call_id: "call_sim_seed_10", budget_id: "bgt_ind_yuki", status: "verified", reason: null, model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017", model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017", amount: "94", refund: "645", minutes_ago: 122 },
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
  for (const solo of SIM_SOLOS) {
    seed.budgets.push({ budget_id: solo.budget_id, name: solo.name, owner: solo.member, deposit: W(10), period: "week", members: [{ member: solo.member, allowance: W(8) }] });
  }
  // A third liquidity provider, so the pool is not two wallets.
  seed.pool.positions.push({ account: "lp-solano.testnet", amount: W(30) });
  seed.reputation = {
    bgt_mission: { tier: "gold", proven_calls: 412, refused_calls: 9, capped_calls: 31, blocked_payees: 2, claims: 0, clean_calls: 377, spent: W(61.8), fees_paid: W(0.74) },
    bgt_nightshade: { tier: "silver", proven_calls: 186, refused_calls: 4, capped_calls: 12, blocked_payees: 1, claims: 0, clean_calls: 14, spent: W(23.4), fees_paid: W(0.38) },
    bgt_hayes: { tier: "silver", proven_calls: 143, refused_calls: 3, capped_calls: 9, blocked_payees: 1, claims: 0, clean_calls: 21, spent: W(17.2), fees_paid: W(0.26) },
    bgt_kelp: { tier: "silver", proven_calls: 57, refused_calls: 2, capped_calls: 40, blocked_payees: 0, claims: 0, clean_calls: 47, spent: W(6.1), fees_paid: W(0.12) },
    bgt_ind_ivan: { tier: "gold", proven_calls: 71, refused_calls: 1, capped_calls: 4, blocked_payees: 0, claims: 0, clean_calls: 36, spent: W(4.9), fees_paid: W(0.07) },
    bgt_ind_yuki: { tier: "silver", proven_calls: 48, refused_calls: 2, capped_calls: 3, blocked_payees: 0, claims: 0, clean_calls: 22, spent: W(3.1), fees_paid: W(0.05) },
    bgt_ind_chloe: { tier: "silver", proven_calls: 33, refused_calls: 0, capped_calls: 6, blocked_payees: 0, claims: 0, clean_calls: 15, spent: W(2.2), fees_paid: W(0.04) },
    bgt_ind_lucas: { tier: "silver", proven_calls: 27, refused_calls: 1, capped_calls: 2, blocked_payees: 0, claims: 0, clean_calls: 12, spent: W(1.8), fees_paid: W(0.03) },
    bgt_ind_gabriel: { tier: "bronze", proven_calls: 8, refused_calls: 1, capped_calls: 0, blocked_payees: 0, claims: 0, clean_calls: 8, spent: W(0.6), fees_paid: W(0.01) },
    bgt_ind_nadia: { tier: "bronze", proven_calls: 3, refused_calls: 0, capped_calls: 0, blocked_payees: 0, claims: 0, clean_calls: 3, spent: W(0.2), fees_paid: W(0.004) },
  };
  seed.claims = [
    { subject: "rcpt_kelp_parts_0331", claimant: "kelp-robotics.sputnikv2.testnet", amount: W(1.5), reason: "Wardline answered PAY for a parts vendor whose website had been taken over a day earlier.", budget_id: "bgt_kelp" },
  ];
  seed.proposals = [
    // Executed at launch: it set the fee the Gold tier still charges. (GLM-5.3 Flash is the swapped-model
    // villain in the demo, so no seed proposal covers it.)
    { proposer: "lp-north.testnet", description: "Set the Gold fee to 1.00%", action: { type: "set_fee_bps", tier: "gold", fee_bps: 100 }, opened_days_ago: 12, votes: [["lp-north.testnet", "for"], ["lp-harbor.testnet", "for"]], execute: true },
    { proposer: "lp-harbor.testnet", description: "Raise the Bronze fee to 2.50%", action: { type: "set_fee_bps", tier: "bronze", fee_bps: 250 }, opened_days_ago: 9, votes: [["lp-harbor.testnet", "for"], ["lp-north.testnet", "against"]] },
    { proposer: "lp-north.testnet", description: "Raise coverage to 1.25x for every tier", action: { type: "set_coverage_multiplier", multiplier_bps: 12_500 }, opened_days_ago: 1, votes: [["lp-north.testnet", "for"], ["lp-solano.testnet", "for"]] },
    { proposer: "lp-harbor.testnet", description: "Lower the Silver fee to 1.25%", action: { type: "set_fee_bps", tier: "silver", fee_bps: 125 }, opened_days_ago: 0.5, votes: [["lp-harbor.testnet", "for"]] },
  ];
  return seed;
}

/**
 * The meter counts proven and refused calls. A reserve refused at an allowance changes no state, so it
 * has no counter: its record is the transaction itself, one audited "capped" row each in the testnet
 * activity log. Payee blocks happen before anything reaches the chain, so none is on chain to count.
 */
function auditedCapped(): Map<string, number> {
  const paths = activityPaths();
  const counts = new Map<string, number>();
  for (const r of auditedRows(readIfExists(paths.log), readIfExists(paths.audit)).rows) {
    if (r.kind === "call" && r.outcome === "capped") counts.set(r.community, (counts.get(r.community) ?? 0) + 1);
  }
  return counts;
}

function withUncounted(view: Omit<ReputationView, "capped_calls" | "blocked_payees">, capped: Map<string, number>): ReputationView {
  return { ...view, tier: view.tier as ReputationView["tier"], capped_calls: capped.get(view.budget_id) ?? 0, blocked_payees: 0 };
}

/**
 * Near-mode views, cached for a few seconds: one page load asks for the same pool, budgets and
 * reputations many times, and public testnet RPC rate-limits. Writes are never cached.
 */
const VIEW_CACHE_MS = 3_000;
function cachedViews<T extends object>(client: T, views: readonly string[]): T {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  return new Proxy(client, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== "string" || !views.includes(prop) || typeof original !== "function") return typeof original === "function" ? original.bind(target) : original;
      return (...args: unknown[]) => {
        const key = `${prop}:${JSON.stringify(args)}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < VIEW_CACHE_MS) return hit.value;
        const value = (original as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        cache.set(key, { at: Date.now(), value });
        value.catch(() => cache.delete(key));
        return value;
      };
    },
  });
}

/**
 * The testnet cast's budgets: every community and individual in scripts/testnet/cast.json. The meter
 * also holds older test budgets (bgt_engineering, bgt_leaked_*); the list views show only the cast.
 * Null when there is no cast file, and then nothing is filtered.
 */
export function castBudgetIds(path = join(REPO_ROOT, "scripts/testnet/cast.json")): Set<string> | null {
  if (!existsSync(path)) return null;
  const cast = JSON.parse(readFileSync(path, "utf8")) as { communities?: Array<{ id: string }>; individuals?: Array<{ budget: string }> };
  return new Set([...(cast.communities ?? []).map((c) => c.id), ...(cast.individuals ?? []).map((i) => i.budget)]);
}

/** Keeps the views whose budget is in the cast; all of them when there is no cast. */
export function onlyCast<T extends { budget_id: string }>(views: T[], cast: Set<string> | null): T[] {
  return cast ? views.filter((v) => cast.has(v.budget_id)) : views;
}

/** Reputation in near mode: the meter contract's own get_reputation and list_reputations (T4.6). */
class NearReputation implements ReputationClient {
  readonly mode = "near" as const;
  constructor(
    private readonly meter: NearMeterClient,
    /** The tier table is fixed in the meter contract; it has no view, so the API's copy of it answers. */
    private readonly rules: () => Promise<{ rules: TierRule[]; coverage_multiplier_bps: number }>,
    private readonly cast: Set<string> | null = castBudgetIds(),
  ) {}
  async getReputation(budgetId: string): Promise<ReputationView | null> {
    const view = await this.meter.getReputation(budgetId);
    return view ? withUncounted(view, auditedCapped()) : null;
  }
  async listReputations(): Promise<ReputationView[]> {
    const capped = auditedCapped();
    return onlyCast(await this.meter.listReputations(), this.cast).map((v) => withUncounted(v, capped));
  }
  async tierRules(): Promise<{ rules: TierRule[]; coverage_multiplier_bps: number }> {
    try {
      const [bronzeFee, silverFee, goldFee, multiplier] = await Promise.all([
        this.meter.getFeeBps("bronze"),
        this.meter.getFeeBps("silver"),
        this.meter.getFeeBps("gold"),
        this.meter.getCoverageMultiplierBps(),
      ]);
      const base = await this.rules();
      return {
        rules: base.rules.map((r) => {
          const fee = r.tier === "gold" ? goldFee : r.tier === "silver" ? silverFee : bronzeFee;
          return { ...r, fee_bps: fee };
        }),
        coverage_multiplier_bps: multiplier,
      };
    } catch {
      return this.rules();
    }
  }
}

/**
 * WARD-holder voting in near mode: the pool contract's proposals and weights (T4.6). Votes and proposals
 * are signed by the holder's own wallet against the pool, so the API never casts one for them.
 */
const realTx = <T extends { tx?: string | null }>(p: T): T => ({ ...p, tx: p.tx && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(p.tx) ? p.tx : null });

class NearGovernance implements GovernanceClient {
  readonly mode = "near" as const;
  constructor(private readonly pool: NearCoverPoolClient) {}
  // The pool labels an executed proposal "<contract>:proposal:<id>", which is not a transaction hash.
  async listProposals(): Promise<MutualProposalView[]> {
    return ((await this.pool.listProposals()) as unknown as MutualProposalView[]).map(realTx);
  }
  async getProposal(id: number): Promise<MutualProposalView | null> {
    const p = (await this.pool.getProposal(id)) as unknown as MutualProposalView | null;
    return p ? realTx(p) : null;
  }
  propose(): Promise<MutualProposalView> {
    return Promise.reject(new Error("On testnet, a WARD holder proposes from their own wallet: call propose on the pool contract."));
  }
  vote(): Promise<MutualProposalView> {
    return Promise.reject(new Error("On testnet, a WARD holder votes from their own wallet: call vote on the pool contract."));
  }
  execute(): Promise<MutualProposalView> {
    return Promise.reject(new Error("On testnet, anyone executes a passed proposal by calling execute on the pool contract."));
  }
  weightOf(id: number, voter: string): Promise<string> {
    return this.pool.weightOf(id, voter);
  }
  params(): Promise<{ quorum_bps: number; voting_days: number }> {
    return this.pool.governanceParams();
  }
}

export function chainModeFromEnv(env: Record<string, string | undefined> = process.env): ChainMode {
  const mode = readEnv("WARDLINE_CHAIN_MODE", env) ?? "sim";
  if (mode !== "sim" && mode !== "near") throw new Error(`WARDLINE_CHAIN_MODE must be sim or near, not ${mode}`);
  return mode;
}

/**
 * sim: the simulations in sim.ts. near: Tharun's typed clients from @wardline/vault-client against the
 * contracts in repo.config.json (each overridable by env), including T4.6's reputation and WARD voting.
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

  const meter = cachedViews(new NearMeterClient({
    contractId: meterContract,
    provider,
    signer,
  }), ["listBudgets", "getBudget", "getReputation", "listReputations", "getFeeBps", "getCoverageMultiplierBps"]);
  const registry = new NearModelRegistryClient({
    contractId: registryContract,
    provider,
    signer,
  });
  const nearPool = cachedViews(new NearCoverPoolClient({
    contractId: poolContract,
    provider,
    signer,
  }), ["getPool", "getPosition", "listClaims", "listProposals", "getProposal", "weightOf", "governanceParams", "ftBalanceOf"]);

  // Tiers and WARD voting are on chain since T4.6. Only the tier table, which the meter fixes in code
  // and exposes no view for, comes from the API's copy.
  const rules = createSimMutual({ budgets: [], pool: new SimPool(seed.pool, now), registry: null, now }).reputation;
  return { mode: "near", meter, registry, pool: nearPool, reputation: new NearReputation(meter, () => rules.tierRules()), governance: new NearGovernance(nearPool) };
}

/** The numbers on the Mutual home page. extraBlocked: look-alike payouts flagged right now, not yet in any group's record. */
export async function mutualStats(chain: Chain, extraBlocked = 0) {
  const [pool, claims, groups] = await Promise.all([chain.pool.getPool(), chain.pool.listClaims(), chain.reputation.listReputations()]);
  return {
    total_pooled: pool.tvl,
    ward_price: pool.ward_price,
    launch_price: pool.launch_price,
    yield_earned: pool.fees_earned,
    // Groups only: a solo builder (budget id bgt_ind_...) is covered too, but is not a group.
    groups_covered: groups.filter((g) => !g.budget_id.startsWith("bgt_ind_")).length,
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
