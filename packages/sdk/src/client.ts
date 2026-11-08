import { PayeeCheckRequest, PayeeCheckResult, PayeeResolveRequest, PayeeResolveResult, PayeeVendor } from "@wardline/schemas";
import { normalizeAccount, normalizeDomain } from "./caip.js";
import { WardlineApiError } from "./errors.js";
import { createMemoryHistory } from "./history.js";
import type { EngineContext, PayeeEngine, PayeeHistoryStore, PayeeRegistry, RegistryVendor, SignalsProvider } from "./interfaces.js";
import { createStubEngine } from "./stub-engine.js";
import { createMemoryRegistry, createStubSignals, STUB_VENDORS } from "./stub-registry.js";

export interface Wardline {
  readonly mode: "hosted" | "direct";
  resolve(request: PayeeResolveRequest): Promise<PayeeResolveResult>;
  check(request: PayeeCheckRequest): Promise<PayeeCheckResult>;
  getVendor(domain: string): Promise<PayeeVendor | null>;
  /** Tells Wardline a payment happened, so a later account change raises PAYEE_CHANGED. */
  recordPayment(payment: { payer: string; domain: string; account: string }): Promise<void>;
}

export interface HostedOptions {
  mode: "hosted";
  baseUrl: string;
  /** An API key from your Wardline owner. Needed to pass `payer` or record payments. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
}

export interface DirectOptions {
  mode: "direct";
  nearRpcUrl: string;
  registryAccount: string;
  /** Registry to read. Until the registry client lands, the default is the built-in sample registry. */
  registry?: PayeeRegistry;
  engine?: PayeeEngine;
  signals?: SignalsProvider;
  history?: PayeeHistoryStore;
  network?: string;
}

export type WardlineOptions = HostedOptions | DirectOptions;

function createHosted(options: HostedOptions): Wardline {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const call = async (path: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
    const headers: Record<string, string> = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};
    const init: RequestInit =
      body === undefined ? { headers } : { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) };
    const response = await doFetch(`${baseUrl}${path}`, init);
    return { status: response.status, json: await response.json().catch(() => null) };
  };

  const expectOk = (status: number, json: unknown): unknown => {
    if (status >= 200 && status < 300) return json;
    const { error, message } = (json ?? {}) as { error?: string; message?: string };
    throw new WardlineApiError(status, error ?? "API_ERROR", message ?? `The Wardline API answered ${status}.`);
  };

  return {
    mode: "hosted",
    async resolve(request) {
      const { status, json } = await call("/v1/resolve", PayeeResolveRequest.parse(request));
      return PayeeResolveResult.parse(expectOk(status, json));
    },
    async check(request) {
      const { status, json } = await call("/v1/check", PayeeCheckRequest.parse(request));
      return PayeeCheckResult.parse(expectOk(status, json));
    },
    async getVendor(domain) {
      const { status, json } = await call(`/v1/vendors/${encodeURIComponent(normalizeDomain(domain))}`);
      if (status === 404) return null;
      return PayeeVendor.parse(expectOk(status, json));
    },
    async recordPayment(payment) {
      const { status, json } = await call("/v1/payments/record", payment);
      expectOk(status, json);
    },
  };
}

const publicVendor = (vendor: RegistryVendor): PayeeVendor => PayeeVendor.parse(vendor);

let sampleRegistryWarned = false;

function createDirect(options: DirectOptions): Wardline {
  if (!options.registry && !sampleRegistryWarned) {
    sampleRegistryWarned = true;
    console.warn("@wardline/sdk: no registry passed, so direct mode is reading the built-in sample registry, not NEAR.");
  }
  const network = options.network ?? "testnet";
  const engine = options.engine ?? createStubEngine();
  const context: EngineContext = {
    registry: options.registry ?? createMemoryRegistry({ vendors: STUB_VENDORS }),
    history: options.history ?? createMemoryHistory(),
    signals: options.signals ?? createStubSignals(),
    network,
  };
  return {
    mode: "direct",
    async resolve(request) {
      return { ...(await engine.resolve(PayeeResolveRequest.parse(request), context)), receipt: null };
    },
    async check(request) {
      return { ...(await engine.check(PayeeCheckRequest.parse(request), context)), receipt: null };
    },
    async getVendor(domain) {
      const vendor = await context.registry.getVendor(normalizeDomain(domain));
      return vendor ? publicVendor(vendor) : null;
    },
    async recordPayment({ payer, domain, account }) {
      await context.history.record({ payer, domain: normalizeDomain(domain), account: normalizeAccount(account, network) });
    },
  };
}

export function createWardline(options: WardlineOptions): Wardline {
  return options.mode === "hosted" ? createHosted(options) : createDirect(options);
}
