import type { WalletSelector } from "@near-wallet-selector/core";
import { NEAR_NETWORK, TEST_WALLET } from "../config";

/** What a NEP-413 signMessage returns. publicKey is ed25519:<base58>, signature is base64. */
export interface NearSignature {
  accountId: string;
  publicKey: string;
  signature: string;
}

export interface NearSignRequest {
  message: string;
  recipient: string;
  /** 32 bytes. */
  nonce: Uint8Array;
}

export type NearWalletId = "meteor-wallet" | "my-near-wallet" | "test-wallet";

/** End-to-end tests define this. Only read when the build sets VITE_REDLINE_TEST_WALLET=1. */
declare global {
  interface Window {
    __redlineTestWallet?: { name: string; signMessage(request: { message: string; recipient: string; nonce: string }): Promise<NearSignature> };
  }
}

export function nearWallets(): { id: NearWalletId; name: string }[] {
  const wallets: { id: NearWalletId; name: string }[] = [
    { id: "meteor-wallet", name: "Meteor" },
    { id: "my-near-wallet", name: "MyNearWallet" },
  ];
  if (TEST_WALLET && typeof window !== "undefined" && window.__redlineTestWallet) wallets.push({ id: "test-wallet", name: window.__redlineTestWallet.name });
  return wallets;
}

let selector: Promise<WalletSelector> | null = null;

/** Loaded on first use, so the wallet SDKs never weigh down the public pages. */
function loadSelector(): Promise<WalletSelector> {
  selector ??= (async () => {
    const { Buffer } = await import("buffer");
    // The wallet SDKs expect Node's `global`, `Buffer` and a `process` with env.
    const g = globalThis as { Buffer?: typeof Buffer; global?: typeof globalThis; process?: unknown };
    g.global ??= globalThis;
    g.Buffer ??= Buffer;
    g.process ??= { env: {}, browser: true, version: "", versions: {}, nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)) };
    const [{ setupWalletSelector }, { setupMeteorWallet }, { setupMyNearWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/meteor-wallet"),
      import("@near-wallet-selector/my-near-wallet"),
    ]);
    return setupWalletSelector({ network: NEAR_NETWORK as "testnet" | "mainnet", modules: [setupMeteorWallet(), setupMyNearWallet()] });
  })();
  selector.catch(() => {
    selector = null;
  });
  return selector;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Asks the chosen wallet to sign a NEP-413 message and checks it came back from the expected
 * account. The server verifies the signature and that the key is a full-access key on that account.
 */
export async function signNep413(walletId: NearWalletId, request: NearSignRequest, expectedAccount: string): Promise<NearSignature> {
  let signed: NearSignature | void;
  if (walletId === "test-wallet") {
    const test = TEST_WALLET ? window.__redlineTestWallet : undefined;
    if (!test) throw new Error("No test wallet in this build.");
    signed = await test.signMessage({ message: request.message, recipient: request.recipient, nonce: toBase64(request.nonce) });
  } else {
    const wallet = await (await loadSelector()).wallet(walletId);
    const { Buffer } = await import("buffer");
    signed = await wallet.signMessage({ message: request.message, recipient: request.recipient, nonce: Buffer.from(request.nonce) });
  }
  if (!signed || !signed.signature) throw new Error("The wallet did not return a signature.");
  if (signed.accountId && signed.accountId !== expectedAccount) {
    throw new Error(`The wallet signed as ${signed.accountId}, not ${expectedAccount}.`);
  }
  return { accountId: expectedAccount, publicKey: String(signed.publicKey), signature: signed.signature };
}
