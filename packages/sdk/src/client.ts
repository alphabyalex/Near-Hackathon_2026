import { PayeeCheckRequest, PayeeCheckResult, PayeeResolveRequest, PayeeResolveResult, PayeeVendor } from "@wardline/schemas";
import { normalizeAccount, normalizeDomain } from "./caip.js";
import { WardlineApiError } from "./errors.js";
import { createMemoryHistory } from "./history.js";
import type { EngineContext, PayeeEngine, PayeeHistoryStore, PayeeRegistry, RegistryVendor, SignalsProvider } from "./interfaces.js";
import { builtInClient, verifyCall, type AiCall, type AttestedModel, type OpenAIConfig, type VerifyCallOptions, type WardlineAiClient } from "./ai.js";
import type { ProofCheck } from "./proof.js";
import { createStubEngine } from "./stub-engine.js";
import { createMemoryRegistry, createStubSignals, STUB_VENDORS } from "./stub-registry.js";

export interface Wardline {
  readonly mode: "hosted" | "direct";
  resolve(request: PayeeResolveRequest): Promise<PayeeResolveResult>;
  check(request: PayeeCheckRequest): Promise<PayeeCheckResult>;
  getVendor(domain: string): Promise<PayeeVendor | null>;
  /** Tells Wardline a payment happened, so a later account change raises PAYEE_CHANGED. */
  recordPayment(payment: { payer: string; domain: string; account: string }): Promise<void>;
  /**
   * An OpenAI-compatible client pointed at the metered gateway. Pass the OpenAI class to get a real
   * OpenAI client (`wardline.openai(OpenAI)`), or nothing for a small built-in one. Hosted mode only.
   */
  openai(): WardlineAiClient;
  openai<T>(OpenAI: new (config: OpenAIConfig) => T): T;
  /** The base URL and key for any OpenAI-compatible client, in any language. */
  openaiConfig(): OpenAIConfig;
  /** One metered call, with its proof. */
  getCall(callId: string): Promise<AiCall>;
  /** The meter key's budget: deposit, spent, members, and verified calls and refunds over time. */
  getAiSpend(budgetId: string): Promise<unknown>;
  /** Re-checks a call's TEE proof locally. Without isAttested, trusts the gateway's list of attested signers. */
  verifyProof(call: AiCall, options?: VerifyCallOptions): Promise<ProofCheck>;
}

export interface HostedOptions {
  mode: "hosted";
  baseUrl: string;
  /** An API key from your Wardline owner. Needed to pass `payer` or record payments. */
  apiKey?: string;
  /** A meter key (wk_...) for metered AI calls. One per budget member. */
  meterKey?: string;
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
  const meterKey = (): string => {
    const key = options.meterKey ?? options.apiKey;
    if (!key) throw new Error("Pass meterKey to createWardline for metered AI calls.");
    return key;
  };
  const aiConfig = (): OpenAIConfig => ({ baseURL: `${baseUrl}/v1/ai`, apiKey: meterKey(), ...(options.fetch ? { fetch: options.fetch } : {}) });

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
    openai: ((OpenAI?: new (config: OpenAIConfig) => unknown) => (OpenAI ? new OpenAI(aiConfig()) : builtInClient(aiConfig()))) as Wardline["openai"],
    openaiConfig: () => aiConfig(),
    async getCall(callId) {
      const res = await doFetch(`${baseUrl}/v1/ai/calls/${encodeURIComponent(callId)}`, { headers: { authorization: `Bearer ${meterKey()}` } });
      const json = (await res.json().catch(() => null)) as AiCall | { error?: { code?: string; message?: string } } | null;
      if (!res.ok) throw new WardlineApiError(res.status, (json as { error?: { code?: string } })?.error?.code ?? "API_ERROR", (json as { error?: { message?: string } })?.error?.message ?? `The Wardline API answered ${res.status}.`);
      return json as AiCall;
    },
    async getAiSpend(budgetId) {
      const res = await doFetch(`${baseUrl}/v1/ai/budgets/${encodeURIComponent(budgetId)}`, { headers: { authorization: `Bearer ${meterKey()}` } });
      const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (!res.ok) throw new WardlineApiError(res.status, json?.error?.code ?? "API_ERROR", json?.error?.message ?? `The Wardline API answered ${res.status}.`);
      return json;
    },
    async verifyProof(callRecord, opts = {}) {
      let isAttested = opts.isAttested;
      if (!isAttested) {
        const { status, json } = await call("/v1/ai-registry");
        const models = (expectOk(status, json) as { models: AttestedModel[] }).models;
        isAttested = (model, signer) => models.some((m) => m.model_id === model && m.signing_address.toLowerCase() === signer.toLowerCase());
      }
      return verifyCall(callRecord, isAttested, opts.responseBytes);
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
    openai: (() => {
      throw new Error("Metered AI calls go through the hosted gateway. Use mode: \"hosted\".");
    }) as Wardline["openai"],
    openaiConfig() {
      throw new Error("Metered AI calls go through the hosted gateway. Use mode: \"hosted\".");
    },
    async getCall() {
      throw new Error("Metered AI calls go through the hosted gateway. Use mode: \"hosted\".");
    },
    async getAiSpend() {
      throw new Error("Metered AI calls go through the hosted gateway. Use mode: \"hosted\".");
    },
    async verifyProof(callRecord, opts = {}) {
      if (!opts.isAttested) throw new Error("Direct mode needs isAttested, read from the model registry.");
      return verifyCall(callRecord, opts.isAttested, opts.responseBytes);
    },
  };
}

export function createWardline(options: WardlineOptions): Wardline {
  return options.mode === "hosted" ? createHosted(options) : createDirect(options);
}
