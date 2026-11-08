import { randomBytes } from "node:crypto";
import { parseAccount } from "@redline/sdk";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

export const NEP413_RECIPIENT = "redline-payee-registry";
const NEP413_TAG = 2_147_484_061; // 2^31 + 413
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_PROOF_AGE_MS = 365 * 24 * 3_600_000;
const MAX_ACCOUNTS = 20;

const Proof = z.object({
  type: z.enum(["nep413", "eip191", "solana-ed25519"]),
  public_key: z.string().max(128).optional(),
  nonce: z.string().max(128).optional(),
  signature: z.string().min(1).max(512),
});

export const PayeeProofFile = z.object({
  version: z.literal(2),
  domain: z.string().max(253),
  name: z.string().min(1).max(120),
  issued_at: z.string().max(64),
  accounts: z.array(z.object({ account: z.string().min(3).max(160), proof: Proof })).min(1).max(MAX_ACCOUNTS),
});
export type PayeeProofFile = z.infer<typeof PayeeProofFile>;
export type ProofEntry = PayeeProofFile["accounts"][number];

export const payeeMessage = (domain: string, caip10: string, issuedAt: string): string =>
  `redline-payee:v2:${domain}:${caip10}:${issuedAt}`;

function borshString(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/** The hash NEP-413 signs: sha256 of the borsh tag and borsh Payload, with no callback URL. */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string = NEP413_RECIPIENT): Uint8Array {
  if (nonce.length !== 32) throw new Error("A NEP-413 nonce is 32 bytes.");
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  const parts = [tag, borshString(message), nonce, borshString(recipient), Uint8Array.of(0)];
  const buffer = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return sha256(buffer);
}

export interface NearAccessKey {
  publicKey: string;
  fullAccess: boolean;
}
export type NearKeyLookup = (network: string, accountId: string) => Promise<NearAccessKey[]>;

/** Reads an account's keys over JSON-RPC. Used only for the NEAR network this API is set to. */
export function createNearKeyLookup(rpcUrl: string, configuredNetwork: string, fetchImpl: typeof fetch = fetch): NearKeyLookup {
  return async (network, accountId) => {
    if (network !== configuredNetwork) throw new Error(`This API checks NEAR keys on ${configuredNetwork} only.`);
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "redline",
        method: "query",
        params: { request_type: "view_access_key_list", finality: "final", account_id: accountId },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}.`);
    const body = (await response.json()) as {
      error?: unknown;
      result?: { error?: string; keys?: { public_key: string; access_key: { permission: unknown } }[] };
    };
    if (body.error || body.result?.error || !body.result?.keys) throw new Error("NEAR RPC could not list this account's keys.");
    return body.result.keys.map((k) => ({ publicKey: k.public_key, fullAccess: k.access_key.permission === "FullAccess" }));
  };
}

export interface Nep413Input {
  network: string;
  accountId: string;
  /** ed25519:<base58> */
  publicKey: string;
  /** base64 */
  signature: string;
  nonce: Uint8Array;
  message: string;
  recipient?: string;
}

/**
 * Verifies a NEP-413 signature and that the key is a current full-access key on the account.
 * Returns null when it holds, otherwise the reason. Shared by vendor proofs, owner sign-in and
 * payer-signed payment records, each with its own recipient so a signature for one is useless for another.
 */
export async function verifyNep413(input: Nep413Input, lookupKeys: NearKeyLookup): Promise<string | null> {
  const [keyType, encodedKey] = input.publicKey.split(":");
  if (keyType !== "ed25519" || !encodedKey) return "Expected an ed25519 public key.";
  let valid = false;
  try {
    valid = ed25519.verify(base64.decode(input.signature), nep413Hash(input.message, input.nonce, input.recipient), base58.decode(encodedKey));
  } catch {
    valid = false;
  }
  if (!valid) return "The signature does not match.";
  const keys = await lookupKeys(input.network, input.accountId);
  const key = keys.find((k) => k.publicKey === input.publicKey);
  if (!key) return "This public key is not on the account.";
  if (!key.fullAccess) return "This public key is not a full-access key.";
  return null;
}

/** Signs a NEP-413 message with a raw ed25519 secret. For tests and scripts; wallets do this in production. */
export function signNep413(message: string, nonce: Uint8Array, secret: Uint8Array, recipient?: string): string {
  return base64.encode(ed25519.sign(nep413Hash(message, nonce, recipient), secret));
}

export type ProofCheck ={ account: string; ok: true; normalized: string } | { account: string; ok: false; reason: string };

async function verifyEntry(entry: ProofEntry, domain: string, issuedAt: string, lookupKeys: NearKeyLookup): Promise<string | null> {
  const parsed = parseAccount(entry.account);
  const message = payeeMessage(domain, entry.account, issuedAt);
  const { proof } = entry;
  switch (proof.type) {
    case "nep413": {
      if (parsed.namespace !== "near") return "nep413 verifies NEAR accounts only.";
      if (!proof.public_key || !proof.nonce) return "nep413 needs public_key and nonce.";
      return verifyNep413(
        { network: parsed.reference, accountId: parsed.address, publicKey: proof.public_key, signature: proof.signature, nonce: base64.decode(proof.nonce), message },
        lookupKeys,
      );
    }
    case "eip191": {
      if (parsed.namespace !== "eip155") return "eip191 verifies EVM accounts only.";
      const recovered = await recoverMessageAddress({ message, signature: proof.signature as `0x${string}` });
      return recovered.toLowerCase() === parsed.address ? null : "The signature does not match.";
    }
    case "solana-ed25519": {
      if (parsed.namespace !== "solana") return "solana-ed25519 verifies Solana accounts only.";
      const valid = ed25519.verify(base58.decode(proof.signature), new TextEncoder().encode(message), base58.decode(parsed.address));
      return valid ? null : "The signature does not match.";
    }
  }
}

export interface ProofFileResult {
  ok: boolean;
  message: string;
  file: PayeeProofFile | null;
  accounts: ProofCheck[];
}

/** Every account must pass. A file with one bad signature counts for nothing. */
export async function verifyProofFile(raw: unknown, domain: string, options: { lookupKeys: NearKeyLookup; now: Date }): Promise<ProofFileResult> {
  const parsed = PayeeProofFile.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "The proof file is not in the expected format.", file: null, accounts: [] };
  const file = parsed.data;
  const fail = (message: string): ProofFileResult => ({ ok: false, message, file, accounts: [] });

  if (file.domain !== domain) return fail(`The proof file names ${file.domain}, not ${domain}.`);
  const issuedAt = new Date(file.issued_at).getTime();
  if (Number.isNaN(issuedAt)) return fail("issued_at is not a date.");
  if (issuedAt > options.now.getTime() + FUTURE_SKEW_MS) return fail("issued_at is in the future.");
  if (issuedAt < options.now.getTime() - MAX_PROOF_AGE_MS) return fail("issued_at is over a year old.");

  const accounts: ProofCheck[] = [];
  const seen = new Set<string>();
  for (const entry of file.accounts) {
    try {
      const normalized = parseAccount(entry.account).caip10;
      const reason = seen.has(normalized) ? "This account is listed twice." : await verifyEntry(entry, domain, file.issued_at, options.lookupKeys);
      seen.add(normalized);
      accounts.push(reason === null ? { account: entry.account, ok: true, normalized } : { account: entry.account, ok: false, reason });
    } catch {
      accounts.push({ account: entry.account, ok: false, reason: "This proof could not be verified." });
    }
  }
  const ok = accounts.every((a) => a.ok);
  return { ok, message: ok ? "All accounts verified." : "At least one account failed its proof.", file, accounts };
}

/** Signs one account's proof with its own key. Runs on the vendor's machine, never on the API. */
export async function signProofEntry(account: string, privateKey: string, domain: string, issuedAt: string): Promise<ProofEntry> {
  const parsed = parseAccount(account);
  const caip10 = parsed.caip10;
  const message = payeeMessage(domain, caip10, issuedAt);
  switch (parsed.namespace) {
    case "near": {
      const [keyType, encoded] = privateKey.split(":");
      if (keyType !== "ed25519" || !encoded) throw new Error(`${caip10}: expected an ed25519:<base58> private key.`);
      const secret = base58.decode(encoded).slice(0, 32);
      const nonce = new Uint8Array(randomBytes(32));
      const signature = ed25519.sign(nep413Hash(message, nonce), secret);
      return {
        account: caip10,
        proof: {
          type: "nep413",
          public_key: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}`,
          nonce: base64.encode(nonce),
          signature: base64.encode(signature),
        },
      };
    }
    case "eip155": {
      const signer = privateKeyToAccount(privateKey as `0x${string}`);
      if (signer.address.toLowerCase() !== parsed.address) throw new Error(`${caip10}: this key is for a different address.`);
      return { account: caip10, proof: { type: "eip191", signature: await signer.signMessage({ message }) } };
    }
    case "solana": {
      const secret = (privateKey.startsWith("0x") ? hexToBytes(privateKey.slice(2)) : base58.decode(privateKey)).slice(0, 32);
      if (base58.encode(ed25519.getPublicKey(secret)) !== parsed.address) throw new Error(`${caip10}: this key is for a different address.`);
      const signature = ed25519.sign(new TextEncoder().encode(message), secret);
      return { account: caip10, proof: { type: "solana-ed25519", signature: base58.encode(signature) } };
    }
    default:
      throw new Error(`${caip10}: no proof type for this chain.`);
  }
}

export async function buildProofFile(input: {
  domain: string;
  name: string;
  issuedAt: string;
  accounts: { account: string; privateKey: string }[];
}): Promise<PayeeProofFile> {
  const accounts: ProofEntry[] = [];
  for (const { account, privateKey } of input.accounts) {
    accounts.push(await signProofEntry(account, privateKey, input.domain, input.issuedAt));
  }
  return { version: 2, domain: input.domain, name: input.name, issued_at: input.issuedAt, accounts };
}
