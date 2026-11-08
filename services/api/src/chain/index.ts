import { loadAttestations, SIM_MODEL, SIM_TEE_ACCOUNT } from "@wardline/demo-provider";
import { readEnv } from "@wardline/schemas";
import {
  NearCoverPoolClient,
  NearMeterClient,
  NearModelRegistryClient,
  makeProvider,
  makeSigner,
} from "@wardline/vault-client";
import type { DateClock as Clock } from "../time.js";
import { createSimChain, type SimChainSeed } from "./sim.js";
import type { AttestedModel, Chain, ChainMode, CoverPoolClient } from "./types.js";

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

  const rpcUrl =
    readEnv("WARDLINE_NEAR_RPC_URL", process.env) ??
    readEnv("NEAR_RPC_URL", process.env) ??
    "https://rpc.testnet.near.org";
  const meterContract =
    readEnv("WARDLINE_METER_CONTRACT", process.env) ?? "meter.wardline.testnet";
  const registryContract =
    readEnv("WARDLINE_MODEL_REGISTRY_CONTRACT", process.env) ??
    "models.wardline.testnet";
  const poolContract =
    readEnv("WARDLINE_COVER_POOL_CONTRACT", process.env) ??
    "mutual.wardline.testnet";

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

  return { mode: "near", meter, registry, pool: wardPoolAdapter(nearPool, readEnv("WARDLINE_WARD_TRADE_URL", process.env) ?? null) };
}

/**
 * Maps the deployed cover pool's shares (share_price, senior_shares) onto WARD. Remove once the
 * contract exposes ward_supply, ward_price and redeem itself.
 * TODO(tharun): WARD as NEP-141 on the cover pool, ft_on_transfer for USDC deposits, and redeem.
 */
function wardPoolAdapter(near: NearCoverPoolClient, tradeUrl: string | null): CoverPoolClient {
  return {
    mode: "near",
    async getPool() {
      const p = await near.getPool();
      return {
        tvl: p.tvl,
        junior: p.junior,
        senior: p.senior,
        junior_holder: p.junior_holder,
        ward_symbol: "WARD",
        ward_name: "Wardline Mutual share",
        ward_supply: p.senior_shares,
        ward_price: p.share_price,
        launch_price: "1000000",
        price_history: [],
        fees_earned: p.fees_earned,
        claims_paid: p.claims_paid,
        coverage_capacity: p.coverage_capacity,
        withdraw_delay_days: p.withdraw_delay_days,
        large_claim_threshold: p.large_claim_threshold,
        trade_url: tradeUrl,
      };
    },
    async getPosition(account) {
      const p = await near.getPosition(account);
      const locked = p.pending_withdrawals.reduce((n, w) => n + BigInt(w.shares), 0n);
      return {
        account: p.account,
        ward: (BigInt(p.shares) - locked).toString(),
        ward_locked: locked.toString(),
        value: p.value,
        pending_withdrawals: p.pending_withdrawals.map((w) => ({ id: w.id, ward: w.shares, value: w.value, requested_at: w.requested_at, available_at: w.available_at })),
      };
    },
    async deposit(account, amount) {
      const r = await near.deposit(account, amount);
      return { tx: r.tx, ward: r.shares };
    },
    requestWithdraw: (account, ward) => near.requestWithdraw(account, ward),
    async redeem() {
      throw new Error("The deployed cover pool has no redeem yet.");
    },
    async listClaims() {
      return (await near.listClaims()).map((c) => ({ ...c, ward_price_before: "", ward_price_after: "" }));
    },
    async fileClaim(args) {
      const c = await near.fileClaim(args);
      return { ...c, ward_price_before: "", ward_price_after: "" };
    },
    addFees: (amount) => near.addFees(amount),
  };
}
