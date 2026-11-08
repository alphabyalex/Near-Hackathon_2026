/**
 * OpenAI-compatible upstreams for tests and demos. Each is a plain (Request) => Response handler, so
 * the gateway can call it in-process or over HTTP (src/serve.ts). None of them calls NEAR AI.
 *
 * - replay:  serves recorded NEAR AI traffic for the exact request bytes it was recorded with.
 * - cheapai: claims to serve whatever model you ask for, but answers with the cheap model's recorded
 *            response and passes through a real signature that names the cheap model (or none).
 * - simtee:  a local test TEE. Fresh responses, signed like provider_tee with a published test key
 *            that only the simulated registry trusts, for a model id that says it is simulated.
 * - hang:    never answers, to test upstream timeouts.
 */

import { createHash } from "node:crypto";
import { sha256Hex, type ProviderSignature } from "@wardline/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { loadRecording, loadRecordings, RECORDED, type Recording } from "./fixtures.js";

export type Handler = (req: Request) => Promise<Response>;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (body: Uint8Array, status = 200): Response => new Response(Buffer.from(body), { status, headers: { "content-type": "application/json" } });
const notFound = (message: string): Response => json({ error: { message, type: "not_found" } }, 404);

const route = (req: Request): { path: string; signatureId: string | null } => {
  const path = new URL(req.url).pathname.replace(/^.*?\/v1\//, "/v1/");
  const sig = /^\/v1\/signature\/([^/?]+)/.exec(path);
  return { path, signatureId: sig ? decodeURIComponent(sig[1]!) : null };
};

async function readBytes(req: Request): Promise<Uint8Array> {
  return new Uint8Array(await req.arrayBuffer());
}

export interface ReplayOptions {
  recordings?: Recording[];
  /** Answer the signature endpoint with 404 this many times first, like a signature not yet recorded. */
  signature404s?: number;
  /** Change one byte of every response after it was signed. */
  tamper?: boolean;
}

export function createReplayProvider(options: ReplayOptions = {}): Handler {
  const recordings = options.recordings ?? loadRecordings();
  const misses = new Map<string, number>();
  return async (req) => {
    const { path, signatureId } = route(req);
    if (req.method === "POST" && path === "/v1/chat/completions") {
      const hash = sha256Hex(await readBytes(req));
      const rec = recordings.find((r) => r.requestHash === hash);
      if (!rec) return notFound("No recording for these exact request bytes.");
      const out = new Uint8Array(rec.responseBytes);
      if (options.tamper) {
        const i = Buffer.from(out).indexOf("content");
        out[i + 12] = out[i + 12] === 0x41 ? 0x42 : 0x41;
      }
      return bytes(out, rec.responseStatus);
    }
    if (req.method === "GET" && signatureId) {
      const rec = recordings.find((r) => r.chatId === signatureId);
      if (!rec || !rec.signatureBytes) return notFound("No signature for this id.");
      const seen = misses.get(signatureId) ?? 0;
      if (seen < (options.signature404s ?? 0)) {
        misses.set(signatureId, seen + 1);
        return notFound("Signature not found yet.");
      }
      return bytes(rec.signatureBytes, rec.signatureStatus ?? 200);
    }
    if (req.method === "GET" && path === "/v1/models") return json({ object: "list", data: [...new Set(recordings.map((r) => r.model))].map((id) => ({ id, object: "model" })) });
    return notFound("Unknown route.");
  };
}

export type CheapAiMode = "wrong-model" | "no-signature" | "canned";

/**
 * Claims to serve the model you asked for. Actually serves the cheap model's real response, rewrites
 * the model name in the body, and passes the cheap model's real signature through.
 */
export function createCheapAi(mode: CheapAiMode = "wrong-model", cheap: Recording = loadRecording(RECORDED.cheap)): Handler {
  return async (req) => {
    const { path, signatureId } = route(req);
    if (req.method === "POST" && path === "/v1/chat/completions") {
      const asked = (JSON.parse(Buffer.from(await readBytes(req)).toString("utf8")) as { model?: string }).model ?? "unknown";
      if (mode === "canned") {
        return json({ id: `cheapai-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: asked, choices: [{ index: 0, message: { role: "assistant", content: "Verifying payees prevents fraud." }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 } });
      }
      const body = Buffer.from(cheap.responseBytes).toString("utf8").replace(`"model":"${cheap.model}"`, `"model":"${asked}"`);
      return bytes(new TextEncoder().encode(body));
    }
    if (req.method === "GET" && signatureId) {
      if (mode !== "wrong-model" || signatureId !== cheap.chatId || !cheap.signatureBytes) return notFound("Signature not found.");
      return bytes(cheap.signatureBytes);
    }
    if (req.method === "GET" && path === "/v1/models") return json({ object: "list", data: [{ id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", object: "model" }] });
    return notFound("Unknown route.");
  };
}

/** Model id served by the local test TEE. The name says it is simulated, so nobody mistakes it for NEAR AI. */
export const SIM_MODEL = "wardline/sim-echo-1";
/** Published on purpose: a test key that only the simulated model registry trusts. */
export const SIM_TEE_KEY = `0x${createHash("sha256").update("wardline-sim-tee-v1").digest("hex")}` as const;
export const SIM_TEE_ACCOUNT = privateKeyToAccount(SIM_TEE_KEY);

export interface SimTeeOptions {
  latencyMs?: number;
  /** Sign as if serving this model instead of the one asked for. */
  claimModel?: string;
}

export function createSimTee(options: SimTeeOptions = {}): Handler {
  const signatures = new Map<string, ProviderSignature>();
  let n = 0;
  return async (req) => {
    const { path, signatureId } = route(req);
    if (req.method === "POST" && path === "/v1/chat/completions") {
      const reqBytes = await readBytes(req);
      const body = JSON.parse(Buffer.from(reqBytes).toString("utf8")) as { model?: string; messages?: { content?: string }[] };
      if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
      const id = `simtee-${++n}-${sha256Hex(reqBytes).slice(0, 8)}`;
      const last = String(body.messages?.at(-1)?.content ?? "").slice(0, 80);
      const response = new TextEncoder().encode(
        JSON.stringify({ id, object: "chat.completion", created: 1_794_000_000 + n, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: `echo: ${last}` }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }),
      );
      const text = `${options.claimModel ?? body.model}:${sha256Hex(reqBytes)}:${sha256Hex(response)}`;
      signatures.set(id, { text, signature: await SIM_TEE_ACCOUNT.signMessage({ message: text }), signing_address: SIM_TEE_ACCOUNT.address.toLowerCase(), signing_algo: "ecdsa", signature_kind: "provider_tee" });
      return bytes(response);
    }
    if (req.method === "GET" && signatureId) {
      const sig = signatures.get(signatureId);
      return sig ? json(sig) : notFound("Signature not found.");
    }
    if (req.method === "GET" && path === "/v1/models") return json({ object: "list", data: [{ id: SIM_MODEL, object: "model" }] });
    return notFound("Unknown route.");
  };
}

/** Never answers. Rejects when the caller aborts. */
export function createHangingProvider(): Handler {
  return (req) =>
    new Promise((_, reject) => {
      req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
}

/**
 * A fetch that serves http://<name>.demo.internal/... from the given handlers and refuses anything
 * else, so a test or demo can never reach a real provider by accident.
 */
export function demoFetch(handlers: Record<string, Handler>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const host = new URL(req.url).hostname;
    const name = host.endsWith(".demo.internal") ? host.slice(0, -".demo.internal".length) : null;
    const handler = name ? handlers[name] : undefined;
    if (!handler) throw new Error(`demoFetch refuses ${host}: not a demo provider`);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!signal) return handler(req);
    if (signal.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
    // Honour the caller's abort or timeout directly, as a real fetch does.
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      handler(req).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }) as typeof fetch;
}

export const demoBaseUrl = (name: string): string => `http://${name}.demo.internal/v1`;
