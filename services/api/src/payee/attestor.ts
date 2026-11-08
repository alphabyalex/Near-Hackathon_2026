import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { canonicalJson, digestOf } from "@wardline/agent";
import type { PayeeReceipt } from "@wardline/schemas";
import { receiptPayload, type PayeeRequest, type PayeeResult } from "@wardline/sdk";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";

const SEED_HEX = /^[0-9a-f]{64}$/i;
const REPO_ENV_FILE = fileURLToPath(new URL("../../../../.env", import.meta.url));

/** sha256 of the canonical request, with `context` replaced by its own sha256. */
export function requestHash(request: PayeeRequest): string {
  const context = "context" in request ? request.context : undefined;
  if (context === undefined) return digestOf(request);
  return digestOf({ ...request, context: `sha256:${createHash("sha256").update(context, "utf8").digest("hex")}` });
}

export interface Attestor {
  readonly publicKey: string;
  issueReceipt(request: PayeeRequest, result: PayeeResult, issuedAt: string): PayeeReceipt;
}

export function createAttestor(seedHex: string): Attestor {
  if (!SEED_HEX.test(seedHex)) throw new Error("WARDLINE_ATTESTOR_KEY must be a 32-byte ed25519 seed in hex.");
  const secret = hexToBytes(seedHex);
  const publicKey = `ed25519:${base58.encode(ed25519.getPublicKey(secret))}`;
  return {
    publicKey,
    issueReceipt(request, result, issuedAt) {
      const base = { id: `rcpt_${randomUUID()}`, issuedAt, requestHash: requestHash(request) };
      const text = canonicalJson(receiptPayload(result, base));
      const signature = base64.encode(ed25519.sign(new TextEncoder().encode(text), secret));
      return { ...base, signer: publicKey, signature };
    },
  };
}

export const generateAttestorSeed = (): string => randomBytes(32).toString("hex");

/**
 * Makes sure WARDLINE_ATTESTOR_KEY is set. Outside production a missing key is generated into the
 * gitignored .env. In production a missing key is an error. The key is never logged.
 */
export function ensureAttestorKey(env: NodeJS.ProcessEnv = process.env, envFile: string = REPO_ENV_FILE): void {
  if (env.WARDLINE_ATTESTOR_KEY) return;
  if (env.NODE_ENV === "production") throw new Error("WARDLINE_ATTESTOR_KEY is required in production.");
  const seed = generateAttestorSeed();
  const prefix = existsSync(envFile) && !readFileSync(envFile, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(envFile, `${prefix}WARDLINE_ATTESTOR_KEY=${seed}\n`, { mode: 0o600 });
  env.WARDLINE_ATTESTOR_KEY = seed;
  console.log("Generated a development attestor key in .env.");
}
