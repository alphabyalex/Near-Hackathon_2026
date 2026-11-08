/**
 * Proof of what was delivered: a NEAR AI Cloud `provider_tee` signature over
 * "<MODEL_ID>:<sha256(request bytes)>:<sha256(response bytes)>", signed with EIP-191 by a key that a
 * model attestation binds to that model. This checks one response locally. It proves which model's
 * TEE signed those exact bytes. It does not prove token counts.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isAddressEqual, recoverMessageAddress, type Hex } from "viem";

/** The signature endpoint's answer, as NEAR AI Cloud returns it. */
export interface ProviderSignature {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string;
}

export type ProofProblem =
  | "SIGNATURE_MISSING"
  | "BAD_SIGNATURE_KIND"
  | "BAD_SIGNING_ALGO"
  | "MALFORMED_TEXT"
  | "MODEL_MISMATCH"
  | "REQUEST_HASH_MISMATCH"
  | "RESPONSE_HASH_MISMATCH"
  | "BAD_SIGNATURE"
  | "SIGNER_MISMATCH"
  | "SIGNER_NOT_ATTESTED";

export type ProofCheck =
  | { ok: true; signer: string; modelProven: string }
  | { ok: false; problem: ProofProblem; detail: string; modelProven: string | null };

export interface ProofInput {
  /** The model the caller asked for and is paying for. */
  model: string;
  /** sha256 hex of the exact request bytes sent upstream. */
  requestHash: string;
  /** sha256 hex of the exact response bytes received. */
  responseHash: string;
  signature: ProviderSignature | null;
  /** Whether a model attestation binds this signer to this model (the model registry). */
  isAttested: (model: string, signer: string) => boolean | Promise<boolean>;
}

/** sha256 hex of bytes or of a UTF-8 string. */
export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === "string" ? new TextEncoder().encode(data) : data));
}

export const expectedProofText = (model: string, requestHash: string, responseHash: string): string => `${model}:${requestHash}:${responseHash}`;

const HEX64 = /^[0-9a-f]{64}$/;

/** Splits "<model>:<req>:<res>" from the right, since model ids can contain ':' too. */
export function parseProofText(text: string): { model: string; requestHash: string; responseHash: string } | null {
  const parts = text.split(":");
  if (parts.length < 3) return null;
  const responseHash = parts.pop() as string;
  const requestHash = parts.pop() as string;
  const model = parts.join(":");
  if (!model || !HEX64.test(requestHash) || !HEX64.test(responseHash)) return null;
  return { model, requestHash, responseHash };
}

/** Checks one signature against the bytes we hashed and the model we pay for. Every failure says why. */
export async function verifyProviderProof(input: ProofInput): Promise<ProofCheck> {
  const sig = input.signature;
  if (!sig || !sig.text || !sig.signature) return { ok: false, problem: "SIGNATURE_MISSING", detail: "The provider returned no signature for this response.", modelProven: null };
  if (sig.signature_kind !== undefined && sig.signature_kind !== "provider_tee") {
    return { ok: false, problem: "BAD_SIGNATURE_KIND", detail: `Signature kind is ${sig.signature_kind}, not provider_tee, so no model TEE signed it.`, modelProven: null };
  }
  if (sig.signing_algo !== "ecdsa") return { ok: false, problem: "BAD_SIGNING_ALGO", detail: `Signing algorithm ${sig.signing_algo} is not accepted.`, modelProven: null };
  const parsed = parseProofText(sig.text);
  if (!parsed) return { ok: false, problem: "MALFORMED_TEXT", detail: "Signed text is not <model>:<request hash>:<response hash>.", modelProven: null };
  if (parsed.model !== input.model) {
    return { ok: false, problem: "MODEL_MISMATCH", detail: `The signature names ${parsed.model}, not ${input.model}.`, modelProven: parsed.model };
  }
  if (parsed.requestHash !== input.requestHash) return { ok: false, problem: "REQUEST_HASH_MISMATCH", detail: "The signature covers a different request.", modelProven: parsed.model };
  if (parsed.responseHash !== input.responseHash) return { ok: false, problem: "RESPONSE_HASH_MISMATCH", detail: "The response bytes were changed after signing.", modelProven: parsed.model };
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: sig.text, signature: sig.signature as Hex });
  } catch {
    return { ok: false, problem: "BAD_SIGNATURE", detail: "The signature does not recover to an address.", modelProven: parsed.model };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(sig.signing_address) || !isAddressEqual(signer as Hex, sig.signing_address as Hex)) {
    return { ok: false, problem: "SIGNER_MISMATCH", detail: `Recovered ${signer}, but the provider named ${sig.signing_address}.`, modelProven: parsed.model };
  }
  if (!(await input.isAttested(parsed.model, signer))) {
    return { ok: false, problem: "SIGNER_NOT_ATTESTED", detail: `${signer} is not attested for ${parsed.model} in the model registry.`, modelProven: parsed.model };
  }
  return { ok: true, signer: signer.toLowerCase(), modelProven: parsed.model };
}
