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
import { currentConnected, NEAR_WALLET_IDS, setConnected, type NearWalletId } from "./connected";

export { NEAR_WALLET_IDS, type NearWalletId };

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
  on?(event: "wallet:signIn" | "wallet:signOut", callback: (payload: { wallet?: NearWalletBase; accounts?: Array<{ accountId: string }> }) => void): void;
}

/** Waiters for the next sign-in, from connectNear. */
const signInWaiters = new Set<(account: string, walletId: string | undefined) => void>();

/**
 * NEAR Connect announces every sign-in. Recording it here, not only where connectNear awaits, makes
 * the first connect stick: if the wallet window took long, the page lost focus, the panel closed, or
 * the connect promise never settled, the account is still saved and the header shows it.
 */
function listen(c: ConnectorLike): ConnectorLike {
  c.on?.("wallet:signIn", (payload) => {
    const accountId = payload.accounts?.[0]?.accountId;
    if (!accountId || !onNetwork(accountId)) return;
    const via = payload.wallet?.manifest?.id;
    setConnected({ account: accountId, wallet: "near-connect", ...(via ? { via } : {}) });
    for (const done of signInWaiters) done(accountId, via);
  });
  return c;
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
    if (makeConnector) return listen(await makeConnector());
    const { NearConnector } = await import("@hot-labs/near-connect");
    return listen(
      new NearConnector({
        network: network(),
        features: { signAndSendTransaction: true, signAndSendTransactions: true, [network()]: true },
        excludedWallets: EXCLUDED_WALLETS,
        footerBranding: null,
      }) as unknown as ConnectorLike,
    );
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

/** getAccounts right after a sign-in can come back empty while the wallet saves it: ask again briefly. */
async function accountAfterSignIn(wallet: NearWalletBase): Promise<string> {
  let last: unknown = null;
  for (let i = 0; i < 4; i++) {
    try {
      return await accountOf(wallet);
    } catch (error) {
      if (error instanceof WalletError && error.kind === "walletMismatch") throw error;
      last = error;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

/**
 * Connects one wallet, by its NEAR Connect id, with no selection modal: the wallet itself opens. With
 * no id, NEAR Connect's own list opens (the owner app and Verify fall back to it). Resolves with the
 * account from whichever comes first, the sign-in event or the wallet's answer; never times out, so a
 * slow wallet window still lands.
 */
export async function connectNear(walletId?: string): Promise<string> {
  const c = await loadConnector();
  let waiter: ((account: string) => void) | null = null;
  const fromEvent = new Promise<string>((resolve) => {
    waiter = (account) => resolve(account);
    signInWaiters.add(waiter);
  });
  try {
    const fromWallet = c.connect(walletId ? { walletId } : undefined).then(async (wallet) => {
      const account = await accountAfterSignIn(wallet);
      setConnected({ account, wallet: "near-connect", ...(wallet.manifest?.id ? { via: wallet.manifest.id } : {}) });
      return account;
    });
    return await Promise.race([fromEvent, fromWallet]);
  } catch (error) {
    throw error instanceof WalletError ? error : walletError(error);
  } finally {
    if (waiter) signInWaiters.delete(waiter);
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

/** NEAR Connect's own record of the wallet it last connected (its LocalStorage key). */
const NEAR_CONNECT_SELECTED = "selected-wallet";

/**
 * On load: restore the wallet NEAR Connect already remembers, with no reconnect. Runs only when NEAR
 * Connect has a wallet on record, so public pages never load it otherwise. Shows the remembered account
 * at once, then asks the wallet; if it no longer has an account on this network, the connection is
 * cleared. A typed-account wallet (test wallet, local signer) is left as it is.
 */
export async function restoreNearConnection(): Promise<void> {
  if (typeof window === "undefined") return;
  let selected: string | null = null;
  try {
    selected = window.localStorage.getItem(NEAR_CONNECT_SELECTED);
  } catch {
    return;
  }
  const now = currentConnected();
  if (now && now.wallet !== "near-connect") return;
  // A connection made in this tab (sessionStorage) is the tab's own; only a remembered one is re-checked.
  const remembered = (): boolean => {
    try {
      return !window.sessionStorage.getItem("wardline.connected");
    } catch {
      return true;
    }
  };
  if (!selected) {
    if (now && remembered()) setConnected(null);
    return;
  }
  const account = await connectedNearAccount();
  const still = currentConnected();
  if (still && still.wallet !== "near-connect") return;
  if (!account) {
    if (still && remembered()) setConnected(null);
    return;
  }
  if (still?.account !== account) setConnected({ account, wallet: "near-connect", via: selected });
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
