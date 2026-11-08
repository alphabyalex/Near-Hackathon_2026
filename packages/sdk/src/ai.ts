/**
 * Metered AI calls through the Wardline gateway: an OpenAI-compatible client, the call record, and
 * local re-verification of a call's provider_tee proof.
 */

import { sha256Hex, verifyProviderProof, type ProofCheck, type ProviderSignature } from "./proof.js";

export interface AiCall {
  call_id: string;
  budget_id: string;
  member: string;
  model_claimed: string;
  model_proven: string | null;
  status: "verified" | "refused" | "failed" | "pending";
  reason: string | null;
  detail: string | null;
  reserved: string;
  amount: string;
  refund: string;
  request_hash: string | null;
  response_hash: string | null;
  chat_id: string | null;
  proof: ProviderSignature | null;
  settlement_tx: string | null;
  release_tx: string | null;
  created_at: string;
}

export interface AttestedModel {
  model_id: string;
  signing_address: string;
}

export interface OpenAIConfig {
  baseURL: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

/** What the gateway says about a call, from its response headers. */
export interface ProofHeaders {
  proof: "verified" | "refused" | null;
  callId: string | null;
  settlement: string | null;
  modelProven: string | null;
  amount: string | null;
  refund: string | null;
}

/** A minimal OpenAI-compatible client, for when the openai package is not installed. */
export interface WardlineAiClient {
  chat: { completions: { create(body: Record<string, unknown>): Promise<Record<string, unknown> & { wardline: ProofHeaders }> } };
  models: { list(): Promise<{ data: { id: string }[] }> };
}

export class WardlineAiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly wardline: ProofHeaders,
  ) {
    super(message);
    this.name = "WardlineAiError";
  }
}

export const proofHeaders = (h: Headers): ProofHeaders => ({
  proof: (h.get("x-wardline-proof") as ProofHeaders["proof"]) ?? null,
  callId: h.get("x-wardline-call"),
  settlement: h.get("x-wardline-settlement"),
  modelProven: h.get("x-wardline-model-proven"),
  amount: h.get("x-wardline-amount"),
  refund: h.get("x-wardline-refund"),
});

export function builtInClient(config: OpenAIConfig): WardlineAiClient {
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" };
  return {
    chat: {
      completions: {
        async create(body) {
          const res = await doFetch(`${config.baseURL}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
          const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: string; message?: string } };
          const wardline = proofHeaders(res.headers);
          if (!res.ok) throw new WardlineAiError(res.status, json.error?.code ?? "API_ERROR", json.error?.message ?? `The gateway answered ${res.status}.`, wardline);
          return { ...json, wardline };
        },
      },
    },
    models: {
      async list() {
        const res = await doFetch(`${config.baseURL}/models`, { headers });
        if (!res.ok) throw new WardlineAiError(res.status, "API_ERROR", `The gateway answered ${res.status}.`, proofHeaders(res.headers));
        return (await res.json()) as { data: { id: string }[] };
      },
    },
  };
}

export interface VerifyCallOptions {
  /** Whether a signer is attested for a model. Pass one that reads the model registry contract to trust nobody. */
  isAttested?: (model: string, signer: string) => boolean | Promise<boolean>;
  /** The exact response bytes you received, to check they are the ones the proof covers. */
  responseBytes?: Uint8Array;
}

/** Re-checks a call's proof locally. Optionally checks your copy of the response against it. */
export async function verifyCall(call: AiCall, isAttested: (model: string, signer: string) => boolean | Promise<boolean>, responseBytes?: Uint8Array): Promise<ProofCheck> {
  if (!call.request_hash || !call.response_hash) return { ok: false, problem: "SIGNATURE_MISSING", detail: "This call has no recorded hashes.", modelProven: null };
  if (responseBytes && sha256Hex(responseBytes) !== call.response_hash) return { ok: false, problem: "RESPONSE_HASH_MISMATCH", detail: "Your copy of the response is not the one the proof covers.", modelProven: call.model_proven };
  return verifyProviderProof({ model: call.model_claimed, requestHash: call.request_hash, responseHash: call.response_hash, signature: call.proof, isAttested });
}
