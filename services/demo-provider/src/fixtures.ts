/**
 * Real NEAR AI Cloud traffic recorded once by scripts/nearai/record.ts: exact request bytes, exact
 * response bytes and the provider_tee signature, plus the model attestation reports that bind each
 * signer to its model. Tests and demos replay these, so they never call NEAR AI.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderSignature } from "@wardline/sdk";

export const FIXTURE_DIR = process.env.WARDLINE_NEARAI_FIXTURES ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/nearai");

export interface Recording {
  name: string;
  model: string;
  recordedAt: string;
  requestBytes: Uint8Array;
  requestHash: string;
  responseStatus: number;
  responseBytes: Uint8Array;
  responseHash: string;
  chatId: string | null;
  /** Raw signature endpoint body and status, or null if none was recorded. */
  signatureStatus: number | null;
  signatureBytes: Uint8Array | null;
  signature: ProviderSignature | null;
}

interface RawFixture {
  name: string;
  model: string;
  recorded_at: string;
  request: { body_b64: string; sha256: string };
  response: { status: number; body_b64: string; sha256: string; chat_id: string | null };
  signature: { status: number; body_b64: string } | null;
}

const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

export function loadRecording(name: string, dir = FIXTURE_DIR): Recording {
  const raw = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as RawFixture;
  const sigBytes = raw.signature ? fromB64(raw.signature.body_b64) : null;
  return {
    name: raw.name,
    model: raw.model,
    recordedAt: raw.recorded_at,
    requestBytes: fromB64(raw.request.body_b64),
    requestHash: raw.request.sha256,
    responseStatus: raw.response.status,
    responseBytes: fromB64(raw.response.body_b64),
    responseHash: raw.response.sha256,
    chatId: raw.response.chat_id,
    signatureStatus: raw.signature?.status ?? null,
    signatureBytes: sigBytes,
    signature: raw.signature?.status === 200 && sigBytes ? (JSON.parse(Buffer.from(sigBytes).toString("utf8")) as ProviderSignature) : null,
  };
}

/** Every completion recording in the folder. */
export function loadRecordings(dir = FIXTURE_DIR): Recording[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("attestation-") && f !== "ledger.json" && f !== "models.json")
    .sort()
    .map((f) => loadRecording(f.slice(0, -5), dir));
}

export interface RecordedAttestation {
  model: string;
  signingAddress: string;
  signingAlgo: string;
  recordedAt: string;
  file: string;
}

/** Signers named by the recorded model attestation reports. Quote verification is the attestor's job. */
export function loadAttestations(dir = FIXTURE_DIR): RecordedAttestation[] {
  if (!existsSync(dir)) return [];
  const out: RecordedAttestation[] = [];
  for (const file of readdirSync(dir).filter((f) => f.startsWith("attestation-")).sort()) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { model: string; recorded_at: string; body_b64: string };
    const report = JSON.parse(Buffer.from(raw.body_b64, "base64").toString("utf8")) as { model_attestations?: { signing_address?: string; signing_algo?: string }[] };
    for (const a of report.model_attestations ?? []) {
      if (a.signing_address) out.push({ model: raw.model, signingAddress: a.signing_address.toLowerCase(), signingAlgo: a.signing_algo ?? "ecdsa", recordedAt: raw.recorded_at, file });
    }
  }
  return out;
}

/** Names used by tests and the demo scenes. */
export const RECORDED = {
  /** DeepSeek V4.1 Flash on NEAR AI: provider_tee, verifies. */
  expensive: "deepseek-plugin",
  /** GLM-5.3 Flash on NEAR AI: provider_tee for the cheap model. */
  cheap: "glm53flash-cheap",
  /** GLM-5.3 through the gateway: a gateway signature, not a model TEE signature. */
  gatewayOnly: "glm53-plugin",
} as const;
