/**
 * NEAR wallets through NEAR Connect (@hot-labs/near-connect), NEAR's recommended connector. The account
 * always comes from the wallet. Only the e2e test wallet and the local test signer take a typed account.
 *
 * NEAR Connect shows only wallets that support this network and signAndSendTransaction(s). It runs each
 * wallet's code in a sandboxed iframe from the wallet's own manifest entry.
 */
import type { NearWalletBase } from "@hot-labs/near-connect";
import { LOCAL_SIGNER, NEAR_NETWORK, TEST_WALLET } from "../config";
import { WalletError, walletError } from "../data/errors";

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

export type NearWalletId = "near-connect" | "test-wallet" | "local-signer";
export const NEAR_WALLET_IDS: readonly NearWalletId[] = ["near-connect", "test-wallet", "local-signer"];

/** The local API signs real testnet transactions for cast accounts on this machine (services/api/src/local-signer.ts). */
export const LOCAL_SIGNER_NAME = "Local test signer (testnet, this machine only)";
export const NEAR_CONNECT_NAME = "NEAR wallet";

/** Wallet ids NEAR Connect must never offer: Ethereum wallets on NEAR were not verified on testnet (see docs/status). */
export const EXCLUDED_WALLETS = ["ethereum-wallets"];

/** End-to-end tests define this. Only read when the build sets VITE_WARDLINE_TEST_WALLET=1. */
declare global {
  interface Window {
    __wardlineTestWallet?: { name: string; signMessage(request: { message: string; recipient: string; nonce: string }): Promise<NearSignature> };
  }
}

export function nearWallets(): { id: NearWalletId; name: string }[] {
  const wallets: { id: NearWalletId; name: string }[] = [{ id: "near-connect", name: NEAR_CONNECT_NAME }];
  // e2e builds only: the scripted wallet comes first, so it is the default there.
  if (TEST_WALLET && typeof window !== "undefined" && window.__wardlineTestWallet) wallets.unshift({ id: "test-wallet", name: window.__wardlineTestWallet.name });
  if (LOCAL_SIGNER) wallets.push({ id: "local-signer", name: LOCAL_SIGNER_NAME });
  return wallets;
}

/** Whether a wallet needs a typed account. NEAR Connect never does: the wallet says who it is. */
export const typesAccount = (id: NearWalletId | null | undefined): boolean => id === "test-wallet" || id === "local-signer";

/** The part of NearConnector this app uses, so tests can pass a mock. */
export interface ConnectorLike {
  connect(options?: { walletId?: string }): Promise<NearWalletBase>;
  wallet(id?: string | null): Promise<NearWalletBase>;
  disconnect(wallet?: NearWalletBase): Promise<void>;
}

let connector: Promise<ConnectorLike> | null = null;
let makeConnector: (() => ConnectorLike | Promise<ConnectorLike>) | null = null;

/** Tests only: replace NEAR Connect with a mock (null restores the real one). */
export function setConnectorFactory(factory: (() => ConnectorLike | Promise<ConnectorLike>) | null): void {
  makeConnector = factory;
  connector = null;
}

const network = (): "testnet" | "mainnet" => (NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet");

/**
 * NEAR Connect, created on first use so it never weighs down the public pages. Call it when a connect or
 * pay panel opens, so the click itself reaches the wallet with nothing slow in between.
 */
export function loadConnector(): Promise<ConnectorLike> {
  connector ??= (async () => {
    if (makeConnector) return makeConnector();
    const { NearConnector } = await import("@hot-labs/near-connect");
    return new NearConnector({
      network: network(),
      features: { signAndSendTransaction: true, signAndSendTransactions: true, [network()]: true },
      excludedWallets: EXCLUDED_WALLETS,
    }) as unknown as ConnectorLike;
  })();
  connector.catch(() => {
    connector = null;
  });
  return connector;
}

/** Whether an account id belongs to this network: name.testnet on testnet, or a 64-hex implicit account. */
export function onNetwork(accountId: string, net: string = NEAR_NETWORK): boolean {
  if (/^[0-9a-f]{64}$/.test(accountId)) return true;
  return net === "mainnet" ? accountId.endsWith(".near") : accountId.endsWith(`.${net}`);
}

async function accountOf(wallet: NearWalletBase): Promise<string> {
  const accounts = await wallet.getAccounts({ network: network() });
  const accountId = accounts[0]?.accountId;
  if (!accountId) throw new WalletError("walletMissing", "The wallet shared no account.");
  if (!onNetwork(accountId)) throw new WalletError("walletMismatch", `The wallet is signed in as ${accountId}, which is not a NEAR ${NEAR_NETWORK} account. Switch the wallet to ${NEAR_NETWORK} and connect again.`);
  return accountId;
}

/** Opens NEAR Connect's wallet list and returns the account the chosen wallet signed in with. */
export async function connectNear(): Promise<string> {
  const c = await loadConnector();
  try {
    return await accountOf(await c.connect());
  } catch (error) {
    throw error instanceof WalletError ? error : walletError(error);
  }
}

/** The account NEAR Connect is signed in with, or null. Never opens a wallet. */
export async function connectedNearAccount(): Promise<string | null> {
  try {
    return await accountOf(await (await loadConnector()).wallet());
  } catch {
    return null;
  }
}

export async function disconnectNear(): Promise<void> {
  try {
    const c = await loadConnector();
    await c.disconnect(await c.wallet());
  } catch {
    // Nothing connected.
  }
}

/** The account to sign as: from the wallet for NEAR Connect (connecting if needed), else the typed one. */
export async function accountFrom(walletId: NearWalletId, typed: string): Promise<string> {
  if (walletId !== "near-connect") return typed.trim();
  return (await connectedNearAccount()) ?? connectNear();
}

/** The connected wallet, checked to be signed in as `account`. */
async function walletFor(account: string): Promise<NearWalletBase> {
  const c = await loadConnector();
  let wallet: NearWalletBase;
  try {
    wallet = await c.wallet();
  } catch {
    throw new WalletError("walletMissing", "No NEAR wallet is connected. Connect one, then try again.");
  }
  const signedIn = await accountOf(wallet);
  if (signedIn !== account) throw new WalletError("walletMismatch", `The wallet signed as ${signedIn}, not ${account}.`);
  return wallet;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Asks the wallet to sign a NEP-413 message and checks it came back from the expected account. The
 * server verifies the signature and that the key is a full-access key on that account.
 */
export async function signNep413(walletId: NearWalletId, request: NearSignRequest, expectedAccount: string): Promise<NearSignature> {
  let signed: NearSignature | void;
  if (walletId === "local-signer") throw new Error("The local test signer sends transactions; it does not sign messages.");
  if (walletId === "test-wallet") {
    const test = TEST_WALLET ? window.__wardlineTestWallet : undefined;
    if (!test) throw new Error("No test wallet in this build.");
    signed = await test.signMessage({ message: request.message, recipient: request.recipient, nonce: toBase64(request.nonce) });
  } else {
    // Connects first when no wallet is: the owner app and Verify can sign without the header's Connect.
    await accountFrom("near-connect", "");
    const wallet = await walletFor(expectedAccount);
    if (!wallet.manifest.features?.signMessage) throw new WalletError("walletMissing", `${wallet.manifest.name} can't sign messages. Connect a wallet that can, such as Meteor.`);
    try {
      signed = await wallet.signMessage({ message: request.message, recipient: request.recipient, nonce: request.nonce, network: network(), signerId: expectedAccount });
    } catch (error) {
      throw walletError(error);
    }
  }
  if (!signed || !signed.signature) throw new Error("The wallet did not return a signature.");
  if (signed.accountId && signed.accountId !== expectedAccount) {
    throw new Error(`The wallet signed as ${signed.accountId}, not ${expectedAccount}.`);
  }
  return { accountId: expectedAccount, publicKey: String(signed.publicKey), signature: signed.signature };
}

/** One NEAR function call, in the action format every NEAR Connect wallet takes. */
export interface FunctionCall {
  receiverId: string;
  methodName: string;
  args: object;
  /** In gas units. */
  gas: string;
  /** In yoctoNEAR. */
  deposit: string;
}

export interface SentTransaction {
  hash: string;
  /** The decoded SuccessValue of the transaction's last receipt, when it returned one. */
  value: unknown;
}

/** The outcome's final value, or an error naming the failure. */
function settle(outcome: { transaction?: { hash?: string }; transaction_outcome?: { id?: string }; status?: unknown }): SentTransaction {
  const hash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? "";
  const status = (outcome.status ?? {}) as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure !== undefined) {
    const text = JSON.stringify(status.Failure);
    const panic = /"(?:ExecutionError|panic_msg)":"([^"]+)"/.exec(text)?.[1];
    throw Object.assign(new Error(panic ? `The transaction failed: ${panic}` : `The transaction failed: ${text.slice(0, 300)}`), { tx: hash });
  }
  let value: unknown = null;
  if (status.SuccessValue) {
    try {
      value = JSON.parse(new TextDecoder().decode(fromBase64(status.SuccessValue)));
    } catch {
      value = null;
    }
  }
  return { hash, value };
}

/**
 * Signs and sends transactions with the connected wallet, signed as `account`. Call it straight from a
 * click, after every check is done, so the wallet's window opens on that click and is not blocked.
 */
export async function sendTransactions(account: string, calls: FunctionCall[]): Promise<SentTransaction[]> {
  const wallet = await walletFor(account);
  const transactions = calls.map((c) => ({ receiverId: c.receiverId, actions: [{ type: "FunctionCall" as const, params: { methodName: c.methodName, args: c.args, gas: c.gas, deposit: c.deposit } }] }));
  let outcomes: unknown[];
  try {
    outcomes = transactions.length === 1
      ? [await wallet.signAndSendTransaction({ network: network(), signerId: account, ...transactions[0]! })]
      : await wallet.signAndSendTransactions({ network: network(), signerId: account, transactions });
  } catch (error) {
    throw walletError(error);
  }
  if (!Array.isArray(outcomes) || outcomes.length !== calls.length) throw new Error("The wallet did not report every transaction.");
  return outcomes.map((o) => settle(o as Parameters<typeof settle>[0]));
}
