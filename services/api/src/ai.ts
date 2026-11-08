/** Wiring for metered AI calls: model routes, the chain clients, the meter store and the group's DAO. */

import type Database from "better-sqlite3";
import { buildProposal, createSimDao, createSputnikClient, type DaoClient, type WardlineContracts } from "@wardline/dao-adapter";
import { SIM_MODEL } from "@wardline/demo-provider";
import { readEnv, usdcAccount } from "@wardline/schemas";
import { chainModeFromEnv, createChain, GROUP_BUDGET, GROUP_DAO, type Chain } from "./chain/index.js";
import type { GatewayOptions } from "./meter/gateway.js";
import { routesFromEnv, type RouteTable } from "./meter/models.js";
import { MeterStore } from "./meter/store.js";
import { toDateClock, type Clock } from "./time.js";

export interface AiDeps {
  chain: Chain;
  meter: MeterStore;
  routes: RouteTable;
  fetch?: typeof fetch;
  gateway?: Partial<GatewayOptions>;
  dao: DaoClient;
  contracts: WardlineContracts;
  env: Record<string, string | undefined>;
}

export interface AiOverrides {
  chain?: Chain;
  routes?: RouteTable;
  fetch?: typeof fetch;
  gateway?: Partial<GatewayOptions>;
  dao?: DaoClient;
  env?: Record<string, string | undefined>;
}

export function contractsFromEnv(env: Record<string, string | undefined>): WardlineContracts {
  return {
    meter: readEnv("WARDLINE_METER_CONTRACT", env) ?? "meter.wardline.testnet",
    registry: readEnv("WARDLINE_MODEL_REGISTRY_CONTRACT", env) ?? "models.wardline.testnet",
    pool: readEnv("WARDLINE_COVER_POOL_CONTRACT", env) ?? "mutual.wardline.testnet",
    token: usdcAccount(env),
    vault: readEnv("WARDLINE_GROUP_VAULT", env) ?? "vault-a.wardline.testnet",
  };
}

/**
 * Model routes for this process. WARDLINE_AI_PROVIDER_URL points the NEAR AI route somewhere else
 * (the local replay provider, for example). Sim mode adds the local test TEE model.
 */
export function aiRoutesFromEnv(env: Record<string, string | undefined>, simMode: boolean): RouteTable {
  const base = routesFromEnv(env);
  const providerUrl = readEnv("WARDLINE_AI_PROVIDER_URL", env);
  const providers = base.providers.map((p) => (p.id === "nearai" && providerUrl ? { ...p, baseUrl: providerUrl.replace(/\/$/, "") } : p));
  if (!simMode) return { providers, models: base.models };
  return {
    providers: [...providers, { id: "simtee", baseUrl: (readEnv("WARDLINE_SIMTEE_URL", env) ?? "http://127.0.0.1:8791/simtee/v1").replace(/\/$/, ""), payTo: "sim-provider.testnet" }],
    models: [...base.models, { id: SIM_MODEL, provider: "simtee", label: "Sim Echo (local test TEE)", inputPerM: 0, outputPerM: 0, perCall: 500_000, defaultMaxTokens: 256 }],
  };
}

const DAY = 86_400_000;

/** The group's DAO in sim mode: a few decided and pending proposals, including two vendor payouts. */
export function simGroupDao(now: Date, contracts: WardlineContracts): DaoClient {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  const sim = createSimDao({
    seed: [
      { proposer: "alice.testnet", input: buildProposal({ type: "fund_budget", budget_id: GROUP_BUDGET, amount: "25000000" }, contracts, "Weekly AI budget"), at: at(6), votes: [["alice.testnet", "VoteApprove"], ["bob.testnet", "VoteApprove"]] },
      { proposer: "bob.testnet", input: buildProposal({ type: "add_provider", provider_id: "nearai", pay_to: "nearai.testnet", model_ids: ["deepseek-ai/DeepSeek-V4.1-Flash-1017", "z-ai/glm-5.3-flash"] }, contracts), at: at(5), votes: [["alice.testnet", "VoteApprove"], ["carol.testnet", "VoteApprove"]] },
      { proposer: "alice.testnet", input: buildProposal({ type: "set_allowance", budget_id: GROUP_BUDGET, member: "ci-agent.testnet", allowance: "15000000" }, contracts, "CI runs nightly evals"), at: at(1), votes: [["alice.testnet", "VoteApprove"]] },
      { proposer: "bob.testnet", input: { description: "Pay northwind.example invoice 55187 for lab freight", kind: { Transfer: { token_id: contracts.token, receiver_id: "northwind.testnet", amount: "12000000", msg: null } } }, at: at(1) },
      { proposer: "carol.testnet", input: { description: "Pay northwind.example invoice 55190. Their bank details changed, see email", kind: { Transfer: { token_id: contracts.token, receiver_id: "northw1nd.testnet", amount: "9500000", msg: null } } }, at: at(0.2) },
      { proposer: "bob.testnet", input: buildProposal({ type: "approve_payout_change", vendor_id: "vnd_fernhill", revision: 2, account: "fernhill-cloud.testnet" }, contracts, "fernhill.example says it moved hosts"), at: at(0.5) },
    ],
  });
  return createSputnikClient({ dao: GROUP_DAO, contracts, provider: sim.provider });
}

export function createAiDeps(db: Database.Database, now: Clock, overrides: AiOverrides = {}): AiDeps {
  const env = overrides.env ?? process.env;
  const nowDate = toDateClock(now);
  const mode = chainModeFromEnv(env);
  const contracts = contractsFromEnv(env);
  const meter = new MeterStore(db);
  meter.reset();
  const dao =
    overrides.dao ??
    (mode === "sim"
      ? simGroupDao(nowDate(), contracts)
      : createSputnikClient({ dao: readEnv("WARDLINE_DAO_ACCOUNT", env) ?? GROUP_DAO, contracts, rpcUrl: env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com" }));
  return {
    chain: overrides.chain ?? createChain(mode, nowDate),
    meter,
    routes: overrides.routes ?? aiRoutesFromEnv(env, mode === "sim"),
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.gateway ? { gateway: overrides.gateway } : {}),
    dao,
    contracts,
    env,
  };
}
