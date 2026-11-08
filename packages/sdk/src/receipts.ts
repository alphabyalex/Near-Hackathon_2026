import type { PayeeCheckRequest, PayeeCheckResult, PayeeReceipt, PayeeResolveRequest, PayeeResolveResult } from "@redline/schemas";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import canonicalize from "canonicalize";

export type PayeeRequest = PayeeCheckRequest | PayeeResolveRequest;
export type PayeeResult = PayeeCheckResult | PayeeResolveResult;

const sha256Digest = (text: string): string => `sha256:${bytesToHex(sha256(utf8ToBytes(text)))}`;

function canonical(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("value cannot be represented as canonical JSON");
  return out;
}

/** sha256 of the RFC 8785 canonical request, with `context` replaced by its own sha256. */
export function hashRequest(request: PayeeRequest): string {
  const context = "context" in request ? request.context : undefined;
  return sha256Digest(canonical(context === undefined ? request : { ...request, context: sha256Digest(context) }));
}

/** The exact fields a receipt's signature covers. */
export function receiptPayload(result: PayeeResult, receipt: Pick<PayeeReceipt, "id" | "issuedAt" | "requestHash">): Record<string, unknown> {
  const base = {
    id: receipt.id,
    issuedAt: receipt.issuedAt,
    requestHash: receipt.requestHash,
    verdict: result.verdict,
    reasonCodes: result.reasons.map((r) => r.code),
    evidenceTier: result.evidenceTier ?? null,
  };
  return "payee" in result
    ? { ...base, payee: result.payee, domain: result.vendor?.domain ?? null }
    : { ...base, account: result.account, domain: result.domain };
}

export const receiptSigningText = (result: PayeeResult, receipt: Pick<PayeeReceipt, "id" | "issuedAt" | "requestHash">): string =>
  canonical(receiptPayload(result, receipt));

const parsePublicKey = (publicKey: string | Uint8Array): Uint8Array => {
  if (typeof publicKey !== "string") return publicKey;
  const [type, encoded] = publicKey.split(":");
  if (type !== "ed25519" || !encoded) throw new Error("Expected an ed25519:<base58> public key.");
  return base58.decode(encoded);
};

/**
 * Checks a receipt against a public key you already trust. Pass `request` to also confirm the
 * receipt answers that exact request. Returns false for anything that fails, including no receipt.
 * The receipt's `signer` field is never used as the key.
 */
export function verifyReceipt(result: PayeeResult, publicKey: string | Uint8Array, options: { request?: PayeeRequest } = {}): boolean {
  const { receipt } = result;
  if (!receipt) return false;
  try {
    if (options.request && hashRequest(options.request) !== receipt.requestHash) return false;
    const message = utf8ToBytes(receiptSigningText(result, receipt));
    return ed25519.verify(base64.decode(receipt.signature), message, parsePublicKey(publicKey));
  } catch {
    return false;
  }
}
