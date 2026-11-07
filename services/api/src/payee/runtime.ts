import { chainOf, createMemoryRegistry, createStubEngine, createStubSignals, ALL_SEED_VENDORS, STUB_VENDORS, type EngineContext, type PayeeEngine, type PayeeHistoryStore, type PayeeRegistry, type SignalsProvider } from "@redline/sdk";
import type { Store } from "../store.js";
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
});

/** The stub engine, memory registry and stub signals, unless a backend is passed in. */
export function createPayeeRuntime(store: Store, clock: Clock, overrides: PayeeOverrides = {}, env: NodeJS.ProcessEnv = process.env): PayeeRuntime {
  const nowDate = () => new Date(Number(clock() / NS_PER_MS));
  const network = env.NEAR_NETWORK ?? "testnet";
  const freeCalls = Number(env.REDLINE_FREE_CALLS_PER_DAY ?? DEFAULT_FREE_CALLS_PER_DAY);
  return {
    engine: overrides.engine ?? createStubEngine(),
    context: {
      registry: overrides.registry ?? createMemoryRegistry({ vendors: env.REDLINE_SEED_PAYEES === "all" ? ALL_SEED_VENDORS : STUB_VENDORS, now: nowDate }),
      history: storeHistory(store, nowDate),
      signals: overrides.signals ?? createStubSignals(),
      network,
    },
    attestor: overrides.attestor ?? createAttestor(env.REDLINE_ATTESTOR_KEY ?? generateAttestorSeed()),
    fetchFile: overrides.fetchFile ?? fetchWellKnown,
    lookupKeys: overrides.lookupKeys ?? createNearKeyLookup(env.NEAR_RPC_URL ?? DEFAULT_NEAR_RPC, network),
    freeCallsPerDay: overrides.freeCallsPerDay ?? (Number.isSafeInteger(freeCalls) && freeCalls >= 0 ? freeCalls : DEFAULT_FREE_CALLS_PER_DAY),
    x402: overrides.x402 ?? {
      enabled: env.REDLINE_X402 === "on",
      payTo: env.REDLINE_X402_PAY_TO || null,
      network: env.REDLINE_X402_NETWORK ?? "eip155:84532",
      asset: env.REDLINE_X402_ASSET ?? BASE_SEPOLIA_USDC,
    },
    trustProxy: overrides.trustProxy ?? env.REDLINE_TRUST_PROXY === "1",
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

/**
 * Picks backends from REDLINE_PAYEE_ENGINE and REDLINE_REGISTRY_MODE. A mode that cannot be met
 * stops the API. It never falls back to the stub, because stub verdicts are not real verdicts.
 */
export async function loadPayeeBackends(env: NodeJS.ProcessEnv = process.env): Promise<PayeeBackends> {
  const backends: PayeeBackends = {};
  const engineMode = env.REDLINE_PAYEE_ENGINE ?? "stub";
  const registryMode = env.REDLINE_REGISTRY_MODE ?? "memory";

  if (engineMode === "live") {
    const payeeCheck = await importOptional("@redline/payee-check");
    if (!payeeCheck) throw new Error("REDLINE_PAYEE_ENGINE=live needs @redline/payee-check, which is not installed yet.");
    // TODO(lucy): wrap payeeCheck's pure functions as a PayeeEngine and set backends.engine here.
    throw new Error("REDLINE_PAYEE_ENGINE=live: @redline/payee-check is installed but not wired to PayeeEngine yet.");
  } else if (engineMode !== "stub") {
    throw new Error(`Unknown REDLINE_PAYEE_ENGINE: ${engineMode}`);
  }

  if (registryMode === "near") {
    const vaultClient = await importOptional("@redline/vault-client");
    if (!vaultClient?.PayeeRegistryClient) throw new Error("REDLINE_REGISTRY_MODE=near needs PayeeRegistryClient from @redline/vault-client, which has not landed.");
    // TODO(tharun): wrap PayeeRegistryClient as a PayeeRegistry and set backends.registry here.
    throw new Error("REDLINE_REGISTRY_MODE=near: PayeeRegistryClient is exported but not wired to PayeeRegistry yet.");
  } else if (registryMode !== "memory") {
    throw new Error(`Unknown REDLINE_REGISTRY_MODE: ${registryMode}`);
  }

  return backends;
}
