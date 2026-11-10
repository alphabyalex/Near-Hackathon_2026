/**
 * The meter gateway: an OpenAI-compatible endpoint that pays for a model call only on proof.
 *
 *   new OpenAI({ baseURL: "<wardline>/v1/ai", apiKey: "<meter key>" })
 *
 * Per call: resolve budget, member and model; reserve the most the call can cost; serialize the
 * request once and send exactly those bytes upstream; hash the exact response bytes; fetch the
 * provider_tee signature with a bounded retry; verify it locally (EIP-191 signer, signed text, signer
 * attested for that model); then settle with the proof, or release the whole reservation on any
 * failure. There is no path that pays without a verified proof.
 */

import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { sha256Hex, verifyProviderProof, type ProofProblem, type ProviderSignature } from "@wardline/sdk";
import type { Chain } from "../chain/types.js";
import type { DateClock as Clock } from "../time.js";
import { costFor, reservationFor, type ModelRoute, type ProviderRoute, type RouteTable } from "./models.js";
import type { CallRow, MeterKeyRow, MeterStore } from "./store.js";

export interface GatewayOptions {
  upstreamTimeoutMs: number;
  /** Signature endpoint attempts, and the wait before each retry after a 404. */
  signatureDelaysMs: number[];
  /** Requests per minute per key. */
  ratePerMinute: number;
  /** What the caller gets when a response is not proven: an error (default) or the bytes, unpaid. */
  unproven: "block" | "deliver";
}

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = { upstreamTimeoutMs: 60_000, signatureDelaysMs: [0, 400, 800, 1600, 3200], ratePerMinute: 120, unproven: "block" };

export interface GatewayDeps {
  store: MeterStore;
  chain: Chain;
  routes: RouteTable;
  now: Clock;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  options?: Partial<GatewayOptions>;
  /** Budget and spend summary for GET /budgets/:id (the key's own budget only). */
  spend?: (budgetId: string) => Promise<unknown>;
}

export type RefusalReason = ProofProblem | "REPLAYED" | "PROOF_REJECTED" | "UPSTREAM_TIMEOUT" | "UPSTREAM_ERROR" | "BAD_UPSTREAM_RESPONSE" | "ALLOWANCE_EXHAUSTED" | "BUDGET_EXHAUSTED" | "UNKNOWN_BUDGET" | "UNKNOWN_MEMBER" | "DUPLICATE_CALL" | "NO_RESERVATION" | "OVER_RESERVATION" | "TRANSFER_FAILED";

/** The largest max_tokens the gateway prices a reservation for. Above any routed model's output limit. */
export const MAX_TOKENS_LIMIT = 131_072;

export const PROOF_HEADERS = ["X-Wardline-Proof", "X-Wardline-Call", "X-Wardline-Settlement", "X-Wardline-Model-Proven", "X-Wardline-Amount", "X-Wardline-Refund"];

const openAiError = (c: Context, status: number, type: string, message: string, extra: Record<string, unknown> = {}) =>
  c.json({ error: { message, type, code: (extra.code as string | undefined) ?? type, ...extra } }, status as 400);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Token bucket per key. */
class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly perMinute: number) {}
  take(key: string, now: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    return ok;
  }
}

async function fetchSignature(doFetch: typeof fetch, provider: ProviderRoute, chatId: string, headers: Record<string, string>, delays: number[]): Promise<ProviderSignature | null> {
  for (const delay of delays) {
    if (delay) await sleep(delay);
    let res: Response;
    try {
      res = await doFetch(`${provider.baseUrl}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`, { headers, signal: AbortSignal.timeout(10_000) });
    } catch {
      continue;
    }
    if (res.status === 404) continue;
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as (ProviderSignature & { error_code?: string }) | null;
    // A 2xx with error_code is "unavailable", not a signature.
    if (!body || body.error_code || !body.signature) return null;
    return body;
  }
  return null;
}

export function createMeterGateway(deps: GatewayDeps): Hono {
  const opts: GatewayOptions = { ...DEFAULT_GATEWAY_OPTIONS, ...deps.options };
  const doFetch = deps.fetch ?? fetch;
  const env = deps.env ?? process.env;
  const limiter = new RateLimiter(opts.ratePerMinute);
  const app = new Hono<{ Variables: { key: MeterKeyRow } }>();

  app.use("*", cors({ origin: "*", exposeHeaders: PROOF_HEADERS }));

  app.use("*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const key = presented ? deps.store.findKey(presented) : null;
    if (!key || key.revokedAt) return openAiError(c, 401, "invalid_api_key", "Missing, unknown or revoked meter key.");
    if (!limiter.take(key.id, deps.now().getTime())) {
      c.header("Retry-After", "1");
      return openAiError(c, 429, "rate_limit_exceeded", "Too many requests for this key. Slow down.");
    }
    c.set("key", key);
    await next();
  });

  const allowed = (key: MeterKeyRow): ModelRoute[] => deps.routes.models.filter((m) => key.models === null || key.models.includes(m.id));

  app.get("/models", (c) =>
    c.json({
      object: "list",
      data: allowed(c.get("key")).map((m) => ({ id: m.id, object: "model", owned_by: m.provider, wardline: { label: m.label, input_per_m: String(m.inputPerM), output_per_m: String(m.outputPerM), unit: "atomic USDC per million tokens" } })),
    }),
  );

  app.get("/budgets/:id", async (c) => {
    if (c.req.param("id") !== c.get("key").budgetId || !deps.spend) return openAiError(c, 404, "not_found", "No such budget for this key.");
    return c.json(await deps.spend(c.req.param("id")));
  });

  app.get("/usage", async (c) => {
    if (!deps.spend) return openAiError(c, 404, "not_found", "No spend tracker configured.");
    const budgetId = c.get("key").budgetId;
    const spendInfo = (await deps.spend(budgetId)) as Record<string, unknown>;
    return c.json({
      object: "usage",
      budget_id: budgetId,
      member: c.get("key").member,
      ...(spendInfo ?? {}),
    });
  });

  app.get("/calls/:id", (c) => {
    const call = deps.store.getCall(c.req.param("id"));
    if (!call || call.budgetId !== c.get("key").budgetId) return openAiError(c, 404, "not_found", "No such call for this budget.");
    return c.json(publicCall(call));
  });

  app.post("/chat/completions", async (c) => {
    const key = c.get("key");
    const started = Date.now();
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    } catch {
      return openAiError(c, 400, "invalid_request_error", "The body must be a JSON object.");
    }
    if (body.stream === true) return openAiError(c, 400, "invalid_request_error", "Streaming is not metered yet. Send stream: false.", { code: "STREAMING_NOT_SUPPORTED" });
    // The reservation is priced from max_tokens, so it must be a whole number of tokens: 1.5 or 1e999
    // (Infinity) would otherwise reach BigInt() and fail as a 500. null means "not set", as in OpenAI's API.
    if (body.max_tokens !== undefined && body.max_tokens !== null) {
      const mt = body.max_tokens;
      if (typeof mt !== "number" || !Number.isInteger(mt) || mt < 1 || mt > MAX_TOKENS_LIMIT) {
        return openAiError(c, 400, "invalid_request_error", `max_tokens must be a whole number from 1 to ${MAX_TOKENS_LIMIT}.`, { code: "INVALID_MAX_TOKENS" });
      }
    }
    const model = typeof body.model === "string" ? body.model : "";
    const route = deps.routes.models.find((m) => m.id === model);
    if (!route) return openAiError(c, 404, "model_not_found", `Model ${model || "(none)"} is not routed. GET /v1/ai/models lists the ones you can use.`);
    if (!allowed(key).some((m) => m.id === model)) return openAiError(c, 403, "model_not_allowed", `This key may not use ${model}.`);
    const provider = deps.routes.providers.find((p) => p.id === route.provider);
    if (!provider) return openAiError(c, 500, "server_error", `No provider ${route.provider} configured.`);

    // Serialized once. These exact bytes are hashed and sent.
    const requestBytes = new TextEncoder().encode(JSON.stringify(body));
    const requestHash = sha256Hex(requestBytes);
    const callId = `call_${randomBytes(8).toString("hex")}`;
    const maxAmount = reservationFor(route, requestBytes.length, typeof body.max_tokens === "number" ? body.max_tokens : undefined);

    const row: CallRow = {
      callId, keyId: key.id, budgetId: key.budgetId, member: key.member, modelClaimed: model, modelProven: null, provider: provider.id,
      status: "pending", reason: null, detail: null, reserved: "0", amount: "0", refund: "0", requestHash, responseHash: null, chatId: null, signer: null,
      proofText: null, proofSignature: null, settlementTx: null, releaseTx: null, promptTokens: null, completionTokens: null, createdAt: deps.now().toISOString(), latencyMs: null,
    };
    const finish = (patch: Partial<CallRow>): CallRow => {
      Object.assign(row, patch, { latencyMs: Date.now() - started });
      deps.store.saveCall(row);
      return row;
    };
    const proofHeaders = (proof: "verified" | "refused") => {
      c.header("X-Wardline-Proof", proof);
      c.header("X-Wardline-Call", callId);
      c.header("X-Wardline-Model-Proven", row.modelProven ?? "none");
      c.header("X-Wardline-Amount", row.amount);
      c.header("X-Wardline-Refund", row.refund);
      const tx = row.settlementTx ?? row.releaseTx;
      if (tx) c.header("X-Wardline-Settlement", tx);
    };

    const reservation = await deps.chain.meter.reserve({ budget_id: key.budgetId, member: key.member, call_id: callId, model_id: model, max_amount: maxAmount.toString() });
    if (!reservation.ok) {
      finish({ status: "refused", reason: reservation.reason, detail: reservation.detail });
      c.header("X-Wardline-Call", callId);
      const limit = reservation.reason === "ALLOWANCE_EXHAUSTED" || reservation.reason === "BUDGET_EXHAUSTED";
      return openAiError(c, limit ? 402 : 403, limit ? "spend_limit_reached" : "budget_error", limit ? `Spend limit reached. ${reservation.detail} Nothing was sent to the model.` : reservation.detail, { code: reservation.reason, call_id: callId });
    }
    row.reserved = reservation.reserved;

    const refuse = async (reason: RefusalReason, detail: string, status: number, type: string, deliver?: Uint8Array): Promise<Response> => {
      const released = await deps.chain.meter.release({ call_id: callId, reason });
      finish({ status: reason.startsWith("UPSTREAM") || reason === "BAD_UPSTREAM_RESPONSE" ? "failed" : "refused", reason, detail, refund: released.refund, releaseTx: released.tx });
      proofHeaders("refused");
      if (deliver && opts.unproven === "deliver") return c.body(Buffer.from(deliver), 200, { "content-type": "application/json" });
      return openAiError(c, status, type, `${detail} You were not charged.`, { code: reason, call_id: callId });
    };

    const upstreamHeaders: Record<string, string> = { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", "x-no-aliasing": "true" };
    const providerKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
    if (providerKey) upstreamHeaders.authorization = `Bearer ${providerKey}`;

    let upstream: Response;
    try {
      upstream = await doFetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers: upstreamHeaders, body: Buffer.from(requestBytes), signal: AbortSignal.timeout(opts.upstreamTimeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return refuse(timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR", timedOut ? `The provider did not answer within ${opts.upstreamTimeoutMs} ms.` : "The provider could not be reached.", timedOut ? 504 : 502, timedOut ? "upstream_timeout" : "upstream_error");
    }
    const responseBytes = new Uint8Array(await upstream.arrayBuffer());
    if (!upstream.ok) return refuse("UPSTREAM_ERROR", `The provider answered HTTP ${upstream.status}.`, 502, "upstream_error");
    row.responseHash = sha256Hex(responseBytes);

    let parsed: { id?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      parsed = JSON.parse(Buffer.from(responseBytes).toString("utf8")) as typeof parsed;
    } catch {
      return refuse("BAD_UPSTREAM_RESPONSE", "The provider's response is not JSON.", 502, "upstream_error");
    }
    row.chatId = typeof parsed.id === "string" ? parsed.id : null;
    row.promptTokens = parsed.usage?.prompt_tokens ?? null;
    row.completionTokens = parsed.usage?.completion_tokens ?? null;

    const signature = row.chatId ? await fetchSignature(doFetch, provider, row.chatId, { accept: "application/json", ...(providerKey ? { authorization: `Bearer ${providerKey}` } : {}) }, opts.signatureDelaysMs) : null;
    const check = await verifyProviderProof({ model, requestHash, responseHash: row.responseHash, signature, isAttested: (m, s) => deps.chain.registry.isAttested(m, s) });
    row.modelProven = check.modelProven;
    if (signature) {
      row.proofText = signature.text;
      row.proofSignature = signature.signature;
      row.signer = signature.signing_address?.toLowerCase() ?? null;
    }
    if (!check.ok) return refuse(check.problem, check.detail, 502, "proof_refused", responseBytes);

    const amount = costFor(route, row.promptTokens ?? 0, row.completionTokens ?? 0);
    const capped = amount > BigInt(row.reserved) ? BigInt(row.reserved) : amount;
    // On testnet the provider's share and the Mutual's fee move as USDC: the meter pays pay_to and sends
    // the fee to the pool. Without pay_to the meter only updates its books. Sim mode keeps its own ledger.
    const payTo = deps.chain.mode === "near" ? (env.WARDLINE_PROVIDER_PAY_TO ?? provider.payTo) : undefined;
    const settled = await deps.chain.meter.settle({
      call_id: callId,
      amount: capped.toString(),
      proof: { model_id: model, request_hash: requestHash, response_hash: row.responseHash, text: signature!.text, signature: signature!.signature, signing_address: check.signer, chat_id: row.chatId! },
      ...(payTo ? { pay_to: payTo } : {}),
    });
    if (!settled.ok) return refuse(settled.reason, settled.detail, 502, "proof_refused", responseBytes);
    finish({ status: "verified", signer: check.signer, amount: settled.amount, refund: settled.refund, settlementTx: settled.tx });
    proofHeaders("verified");
    return c.body(Buffer.from(responseBytes), 200, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
  });

  return app as unknown as Hono;
}

/** What a caller may see about a call: no key ids, nothing beyond the proof. */
export function publicCall(call: CallRow) {
  return {
    call_id: call.callId,
    budget_id: call.budgetId,
    member: call.member,
    model_claimed: call.modelClaimed,
    model_proven: call.modelProven,
    status: call.status,
    reason: call.reason,
    detail: call.detail,
    reserved: call.reserved,
    amount: call.amount,
    refund: call.refund,
    request_hash: call.requestHash,
    response_hash: call.responseHash,
    chat_id: call.chatId,
    proof: call.proofText && call.proofSignature ? { text: call.proofText, signature: call.proofSignature, signing_address: call.signer, signing_algo: "ecdsa", signature_kind: "provider_tee" } : null,
    settlement_tx: call.settlementTx,
    release_tx: call.releaseTx,
    prompt_tokens: call.promptTokens,
    completion_tokens: call.completionTokens,
    created_at: call.createdAt,
    latency_ms: call.latencyMs,
  };
}

export type PublicCall = ReturnType<typeof publicCall>;
