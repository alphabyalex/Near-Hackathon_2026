import { randomBytes } from "node:crypto";
import type { Digest } from "@wardline/schemas";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, MODEL_ID } from "./agent-config.js";
import { sha256Digest } from "./canonical.js";

export interface TeeEvidence {
  status: "collected" | "unavailable";
  verified: false;
  completion_id: string | null;
  model_id: string;
  request_hash: Digest;
  response_hash: Digest;
  nonce: string;
  signature: unknown;
  attestation: unknown;
  error: string | null;
}

/** Preserve exact wire bytes for an independent verifier; never claim collection is verification. */
export async function collectProof(baseUrl: string, apiKey: string, fetchImpl: typeof fetch,
  completionId: string | null, request: string, response: string): Promise<TeeEvidence> {
  const nonce = randomBytes(32).toString("hex");
  const evidence: TeeEvidence = { status: "unavailable", verified: false, completion_id: completionId,
    model_id: MODEL_ID, request_hash: sha256Digest(request), response_hash: sha256Digest(response),
    nonce, signature: null, attestation: null, error: null };
  try {
    if (!completionId) throw new Error("Completion ID missing");
    const get = async (path: string) => {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/${path}`, {
        headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Proof endpoint HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    };
    const model = encodeURIComponent(MODEL_ID);
    [evidence.signature, evidence.attestation] = await Promise.all([
      get(`signature/${encodeURIComponent(completionId)}?model=${model}&signing_algo=ecdsa`),
      get(`attestation/report?model=${model}&signing_algo=ecdsa&nonce=${nonce}`),
    ]);
    evidence.status = "collected";
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : "Proof collection failed";
  }
  try {
    const dir = process.env.WARDLINE_PROOF_DIR ?? join(REPO_ROOT, "evidence", "local-ai-proofs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${evidence.response_hash.slice(7)}.json`),
      JSON.stringify({ schema: "wardline-tee-evidence-v1", evidence, request, response }, null, 2), { mode: 0o600 });
  } catch {
    evidence.status = "unavailable";
    evidence.error = "Could not persist proof artifact";
  }
  return evidence;
}
