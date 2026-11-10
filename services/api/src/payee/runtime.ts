import { chainOf, createMemoryRegistry, createStubEngine, createStubSignals, ALL_SEED_VENDORS, STUB_VENDORS, type EngineContext, type PayeeEngine, type PayeeHistoryStore, type PayeeRegistry, type SignalsProvider } from "@wardline/sdk";
import type { Store } from "../store.js";
import { repoNear } from "../chain/index.js";
import type { Clock } from "../time.js";
import { NS_PER_MS } from "../time.js";
import { createAttestor, generateAttestorSeed, type Attestor } from "./attestor.js";
import { createNearKeyLookup, type NearKeyLookup } from "./proofs.js";
import { fetchWellKnown, type WellKnownFetcher } from "./well-known.js";

const DEFAULT_FREE_CALLS_PER_DAY = 200;
const DEFAULT_NEAR_RPC = "https://test.rpc.fastnear.com";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export interface X402Config {
  enabled: boolean;
  payTo: string | null;
  network: string;
  asset: string;
}

export interface PayeeRuntime {
  engine: PayeeEngine;
  context: EngineContext;
  attestor: Attestor;
  fetchFile: WellKnownFetcher;
  lookupKeys: NearKeyLookup;
  freeCallsPerDay: number;
  x402: X402Config;
  trustProxy: boolean;
  nowDate: () => Date;
}

export interface PayeeBackends {
  engine?: PayeeEngine;
  registry?: PayeeRegistry;
  signals?: SignalsProvider;
}

export type PayeeOverrides = PayeeBackends & Partial<Pick<PayeeRuntime, "attestor" | "fetchFile" | "lookupKeys" | "freeCallsPerDay" | "x402" | "trustProxy">>;

const storeHistory = (store: Store, now: () => Date): PayeeHistoryStore => ({
  async record({ payer, domain, account }) {
    store.recordPayment({ payer, domain, chain: chainOf(account), account, at: now().toISOString() });
  },
  async lastAccount(payer, domain, chain) {
    return store.lastPaidAccount(payer, domain, chain);
  },
  async hasRelationship(payer, account) {
    return store.hasRelationship(payer, account);
  },
});

/** The stub engine, memory registry and stub signals, unless a backend is passed in. */
export function createPayeeRuntime(store: Store, clock: Clock, overrides: PayeeOverrides = {}, env: NodeJS.ProcessEnv = process.env): PayeeRuntime {
  const nowDate = () => new Date(Number(clock() / NS_PER_MS));
  const network = env.NEAR_NETWORK ?? "testnet";
  const freeCalls = Number(env.WARDLINE_FREE_CALLS_PER_DAY ?? DEFAULT_FREE_CALLS_PER_DAY);
  return {
    engine: overrides.engine ?? createStubEngine(),
    context: {
      registry: overrides.registry ?? createMemoryRegistry({ vendors: env.WARDLINE_SEED_PAYEES === "all" ? ALL_SEED_VENDORS : STUB_VENDORS, now: nowDate }),
      history: storeHistory(store, nowDate),
      signals: overrides.signals ?? createStubSignals(),
      network,
    },
    attestor: overrides.attestor ?? createAttestor(env.WARDLINE_ATTESTOR_KEY ?? generateAttestorSeed()),
    fetchFile: overrides.fetchFile ?? fetchWellKnown,
    lookupKeys: overrides.lookupKeys ?? createNearKeyLookup(env.NEAR_RPC_URL ?? DEFAULT_NEAR_RPC, network),
    freeCallsPerDay: overrides.freeCallsPerDay ?? (Number.isSafeInteger(freeCalls) && freeCalls >= 0 ? freeCalls : DEFAULT_FREE_CALLS_PER_DAY),
    x402: overrides.x402 ?? {
      enabled: env.WARDLINE_X402 === "on",
      payTo: env.WARDLINE_X402_PAY_TO || null,
      network: env.WARDLINE_X402_NETWORK ?? "eip155:84532",
      asset: env.WARDLINE_X402_ASSET ?? BASE_SEPOLIA_USDC,
    },
    trustProxy: overrides.trustProxy ?? env.WARDLINE_TRUST_PROXY === "1",
    nowDate,
  };
}

const importOptional = async (specifier: string): Promise<Record<string, unknown> | null> => {
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** The contract stores evidence tiers as short codes ("T2"); the SDK names them in full. */
const TIER_NAMES: Record<string, string> = { T0: "T0_NONE", T1: "T1_WALLET_CONTROL", T2: "T2_DOMAIN_LINKED", T3: "T3_RELATIONSHIP", T4: "T4_EXTERNAL_KYB" };

function withTierNames<T>(vendor: T): T {
  if (!vendor || typeof vendor !== "object") return vendor;
  const v = vendor as unknown as { accounts?: Array<{ evidenceTier?: string }> };
  return { ...vendor, accounts: (v.accounts ?? []).map((a) => ({ ...a, evidenceTier: a.evidenceTier ? (TIER_NAMES[a.evidenceTier] ?? a.evidenceTier) : a.evidenceTier })) } as T;
}

/** The payee registry contract as a PayeeRegistry, with the SDK's tier names. */
export function nearRegistry(client: PayeeRegistry): PayeeRegistry {
  return {
    getVendor: async (domain) => withTierNames(await client.getVendor(domain)),
    listVendors: async () => (await client.listVendors()).map(withTierNames),
    findByAccount: async (caip10) => withTierNames(await client.findByAccount(caip10)),
    attestVendor: async (input) => withTierNames(await client.attestVendor(input)),
  };
}

/**
 * Picks backends from WARDLINE_PAYEE_ENGINE and WARDLINE_REGISTRY_MODE. A mode that cannot be met
 * stops the API. It never falls back to the stub, because stub verdicts are not real verdicts.
 */
export async function loadPayeeBackends(env: NodeJS.ProcessEnv = process.env, signer?: unknown): Promise<PayeeBackends> {
  const backends: PayeeBackends = {};
  const engineMode = env.WARDLINE_PAYEE_ENGINE ?? "stub";
  const registryMode = env.WARDLINE_REGISTRY_MODE ?? "memory";

  if (engineMode === "live") {
    const payeeCheck = await importOptional("@wardline/payee-check");
    if (!payeeCheck) throw new Error("WARDLINE_PAYEE_ENGINE=live needs @wardline/payee-check, which is not installed yet.");
    // TODO(lucy): wrap payeeCheck's pure functions as a PayeeEngine and set backends.engine here.
    throw new Error("WARDLINE_PAYEE_ENGINE=live: @wardline/payee-check is installed but not wired to PayeeEngine yet.");
  } else if (engineMode !== "stub") {
    throw new Error(`Unknown WARDLINE_PAYEE_ENGINE: ${engineMode}`);
  }

  if (registryMode === "near") {
    // The payee registry contract on NEAR testnet. Read-only here: vendors are attested by the attestor
    // account (pnpm payee:seed with WARDLINE_REGISTRY_MODE=near signs with its key).
    const vaultClient = await importOptional("@wardline/vault-client");
    if (!vaultClient?.PayeeRegistryClient) throw new Error("WARDLINE_REGISTRY_MODE=near needs PayeeRegistryClient from @wardline/vault-client.");
    const rpcUrl = env.WARDLINE_NEAR_RPC_URL ?? env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
    const contractId = env.WARDLINE_PAYEE_REGISTRY_CONTRACT ?? repoNear().contracts.payeeRegistry;
    const vc = vaultClient as unknown as { PayeeRegistryClient: new (options: object) => PayeeRegistry; makeProvider: (url: string) => unknown };
    backends.registry = nearRegistry(new vc.PayeeRegistryClient({ contractId, provider: vc.makeProvider(rpcUrl), ...(signer ? { signer } : {}) }));
  } else if (registryMode !== "memory") {
    throw new Error(`Unknown WARDLINE_REGISTRY_MODE: ${registryMode}`);
  }

  return backends;
}
