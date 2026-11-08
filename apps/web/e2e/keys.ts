import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";

/** Test-only keys, derived from fixed labels so the stub API and the browser mocks agree. Never real funds. */
const secretFor = (label: string): Uint8Array => sha256(new TextEncoder().encode(`wardline-e2e:${label}`));

export const API_PORT = 8799;
export const WEB_PORT = 5199;
export const SHOTS_PORT = 5198;

export const OWNER_ACCOUNT = "owner.wardline-e2e.testnet";
export const APPROVER_ACCOUNT = "approver.wardline-e2e.testnet";
export const REQUESTER_ACCOUNT = "ops.vault-a.wardline.testnet";
export const VENDOR_NEAR_ACCOUNT = "acme-payouts.testnet";
export const NEAR_ACCOUNTS = [OWNER_ACCOUNT, APPROVER_ACCOUNT, REQUESTER_ACCOUNT, VENDOR_NEAR_ACCOUNT];

export const nearPublicKey = (account: string): string => `ed25519:${base58.encode(ed25519.getPublicKey(secretFor(account)))}`;

function borshString(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/** NEP-413: sha256 of the borsh tag (2^31 + 413) and payload, signed with ed25519. */
export function signNep413(account: string, message: string, recipient: string, nonceBase64: string): { accountId: string; publicKey: string; signature: string } {
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, 2_147_484_061, true);
  const parts = [tag, borshString(message), base64.decode(nonceBase64), borshString(recipient), Uint8Array.of(0)];
  const buffer = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return { accountId: account, publicKey: nearPublicKey(account), signature: base64.encode(ed25519.sign(sha256(buffer), secretFor(account))) };
}

export const evmAccount = privateKeyToAccount(`0x${Buffer.from(secretFor("evm")).toString("hex")}`);

export const solanaSecret = secretFor("solana");
export const solanaAddress = base58.encode(ed25519.getPublicKey(solanaSecret));
export const signSolana = (bytes: number[]): number[] => Array.from(ed25519.sign(Uint8Array.from(bytes), solanaSecret));
