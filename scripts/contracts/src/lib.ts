import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair, PublicKey, actions, baseEncode, type KeyPairString, type Provider } from "near-api-js";
import { assertAllowedNetwork, callFinal, makeProvider, makeSigner, type SignerHandle, type VaultNetwork, type VaultSigners } from "@redline/vault-client";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const NEAR = 10n ** 24n;
export const MILLINEAR = NEAR / 1000n;
export const NS_PER_HOUR = 3_600_000_000_000n;
export const NS_PER_DAY = 24n * NS_PER_HOUR;
export const REDL = 1_000_000n;

export function repoPath(...parts: string[]): string {
  return resolve(HERE, "../../..", ...parts);
}

export function readWasm(name: string, dir = process.env.REDLINE_WASM_DIR ?? repoPath("contracts", "out")): Uint8Array {
  const path = join(dir, `${name}.wasm`);
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run scripts/contracts/build.sh first.`);
  return readFileSync(path);
}

export function sha256Digest(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Keys live here, outside the repo, readable only by you. Never commit this file. */
export interface Credentials {
  accounts: Record<string, string>;
}

export class CredentialStore {
  private data: Credentials;

  constructor(readonly path: string) {
    if (existsSync(path)) {
      this.data = JSON.parse(readFileSync(path, "utf8")) as Credentials;
    } else {
      this.data = { accounts: {} };
    }
  }

  get(accountId: string): string | undefined {
    return this.data.accounts[accountId];
  }

  /** Written before the account exists, so a crash never loses a key that controls something. */
  set(accountId: string, privateKey: string): void {
    this.data.accounts[accountId] = privateKey;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}

export function defaultSecretsDir(network: VaultNetwork): string {
  return process.env.REDLINE_SECRETS_DIR ?? join(homedir(), ".redline", network);
}

export interface AccessKeyInfo {
  public_key: string;
  access_key: {
    nonce: number;
    permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
  };
}

export async function viewAccount(provider: Provider, accountId: string): Promise<{ amount: string; code_hash: string; storage_usage: number } | null> {
  try {
    return await provider.query<{ amount: string; code_hash: string; storage_usage: number }>({
      request_type: "view_account",
      account_id: accountId,
      finality: "final",
    } as never);
  } catch (error) {
    if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(`${(error as Error).name} ${(error as Error).message}`)) return null;
    throw error;
  }
}

export async function listKeys(provider: Provider, accountId: string): Promise<AccessKeyInfo[]> {
  const result = await provider.query<{ keys: AccessKeyInfo[] }>({
    request_type: "view_access_key_list",
    account_id: accountId,
    finality: "final",
  } as never);
  return result.keys;
}

export const NO_CODE_HASH = "11111111111111111111111111111111";

export class Deployer {
  readonly provider: Provider;

  constructor(
    readonly network: VaultNetwork,
    readonly rpcUrl: string,
    readonly credentials: CredentialStore,
    readonly log: (line: string) => void = console.log,
  ) {
    assertAllowedNetwork(network);
    this.provider = makeProvider(rpcUrl);
  }

  signer(accountId: string): SignerHandle {
    const key = this.credentials.get(accountId);
    if (!key) throw new Error(`No key for ${accountId} in ${this.credentials.path}`);
    return makeSigner(this.provider, accountId, key);
  }

  /** Creates `accountId` under `parent` with a new full-access key, unless it already exists. */
  async ensureAccount(accountId: string, parent: SignerHandle, near: bigint): Promise<SignerHandle> {
    const existing = await viewAccount(this.provider, accountId);
    let key = this.credentials.get(accountId);
    if (existing) {
      if (!key) throw new Error(`${accountId} exists but its key is not in ${this.credentials.path}`);
      return makeSigner(this.provider, accountId, key);
    }
    if (!key) {
      key = KeyPair.fromRandom("ed25519").toString();
      this.credentials.set(accountId, key);
    }
    const publicKey = KeyPair.fromString(key as KeyPairString).getPublicKey();
    this.log(`  create ${accountId} with ${near / MILLINEAR} mN`);
    await parent.account.signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.createAccount(), actions.transfer(near), actions.addFullAccessKey(publicKey)],
      waitUntil: "FINAL",
    });
    return makeSigner(this.provider, accountId, key);
  }

  /**
   * Creates `accountId` under `parent` holding only a function-call key, so the account can never
   * do anything else, including add itself another key.
   */
  async ensureRestrictedAccount(
    accountId: string,
    parent: SignerHandle,
    near: bigint,
    contractId: string,
    methods: string[],
    allowance: bigint,
  ): Promise<SignerHandle> {
    const existing = await viewAccount(this.provider, accountId);
    let key = this.credentials.get(accountId);
    if (existing) {
      if (!key) throw new Error(`${accountId} exists but its key is not in ${this.credentials.path}`);
      return makeSigner(this.provider, accountId, key);
    }
    if (!key) {
      key = KeyPair.fromRandom("ed25519").toString();
      this.credentials.set(accountId, key);
    }
    const publicKey = KeyPair.fromString(key as KeyPairString).getPublicKey();
    this.log(`  create ${accountId} with one key restricted to ${methods.join(",")} on ${contractId}`);
    await parent.account.signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.createAccount(), actions.transfer(near), actions.addFunctionCallAccessKey(publicKey, contractId, methods, allowance)],
      waitUntil: "FINAL",
    });
    return makeSigner(this.provider, accountId, key);
  }

  /** Deploys and runs `new` in one transaction, so nobody can get in between. Skips if code is present. */
  async ensureContract(account: SignerHandle, code: Uint8Array, init: { method: string; args: object }): Promise<void> {
    const expected = baseEncode(createHash("sha256").update(code).digest());
    const state = await viewAccount(this.provider, account.account_id);
    if (state && state.code_hash !== NO_CODE_HASH) {
      if (state.code_hash !== expected) {
        throw new Error(`${account.account_id} runs code ${state.code_hash}, but the local wasm is ${expected}. A locked contract cannot change: use a new root account.`);
      }
      this.log(`  ${account.account_id} already runs this code (${expected})`);
      return;
    }
    this.log(`  deploy ${account.account_id} (${code.length} bytes, ${expected})`);
    await account.account.signAndSendTransaction({
      receiverId: account.account_id,
      actions: [actions.deployContract(code), actions.functionCall(init.method, init.args, 100_000_000_000_000n, 0n)],
      waitUntil: "FINAL",
    });
    const deployed = await viewAccount(this.provider, account.account_id);
    if (deployed?.code_hash !== expected) throw new Error(`${account.account_id} reports code ${deployed?.code_hash} after deploying ${expected}`);
  }

  /**
   * Removes every key from a contract account. Whoever holds a contract account's key can sign as the
   * contract, which would pass `#[private]` on its callbacks. With no keys, only the code can act.
   * This cannot be undone: fixing a locked vault means deploying a new one.
   */
  async lock(account: SignerHandle): Promise<void> {
    const keys = await listKeys(this.provider, account.account_id);
    if (keys.length === 0) {
      this.log(`  ${account.account_id} is already locked`);
      return;
    }
    this.log(`  lock ${account.account_id}: removing ${keys.length} key(s)`);
    await account.account.signAndSendTransaction({
      receiverId: account.account_id,
      actions: keys.map((key) => actions.deleteKey(PublicKey.fromString(key.public_key))),
      waitUntil: "FINAL",
    });
  }

  call(signer: SignerHandle, contractId: string, method: string, args: object, deposit = 0n, gas = 100_000_000_000_000n) {
    return callFinal(signer, { contract_id: contractId, method, args, deposit, gas }, { final_timeout_ms: 180_000 });
  }
}

/**
 * Testnet only. Asks the public faucet to create `accountId` and fund it. Used for the deploy root
 * when nobody supplies one.
 */
export async function createFromFaucet(accountId: string, publicKey: string): Promise<void> {
  const url = process.env.REDLINE_FAUCET_URL ?? "https://helper.nearprotocol.com/account";
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  if (!response.ok) throw new Error(`Faucet refused ${accountId}: ${response.status} ${await response.text()}`);
}

/**
 * Testnet only. One faucet account may hold less than a deployment needs, so this creates throwaway
 * faucet accounts and deletes them into `root`, until it holds `minimum`. Their keys are never stored:
 * the accounts are gone at the end of each round.
 */
export async function topUpFromFaucet(provider: Provider, root: string, minimum: bigint, log: (line: string) => void): Promise<void> {
  const base = root.replace(/\.testnet$/, "");
  for (let round = 1; round <= 5; round++) {
    const balance = BigInt((await viewAccount(provider, root))?.amount ?? 0);
    if (balance >= minimum) return;
    const id = `${base}-fund-${Date.now().toString(36)}.testnet`;
    const keyPair = KeyPair.fromRandom("ed25519");
    log(`Root holds ${balance / MILLINEAR} mN, needs ${minimum / MILLINEAR} mN. Topping up from the faucet with ${id}.`);
    await createFromFaucet(id, keyPair.getPublicKey().toString());
    for (let i = 0; i < 30 && !(await viewAccount(provider, id)); i++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    const account = makeSigner(provider, id, keyPair.toString());
    await account.account.signAndSendTransaction({ receiverId: id, actions: [actions.deleteAccount(root)], waitUntil: "FINAL" });
  }
  const balance = BigInt((await viewAccount(provider, root))?.amount ?? 0);
  if (balance < minimum) throw new Error(`Root ${root} holds ${balance / MILLINEAR} mN and needs ${minimum / MILLINEAR} mN. Fund it, then rerun.`);
}

export interface SignerFile {
  [vaultId: string]: VaultSigners;
}

export interface KeyPermissionRecord {
  public_key: string;
  permission: AccessKeyInfo["access_key"]["permission"];
}

export interface VaultDeployment {
  business: string;
  vault_id: string;
  code_hash: string;
  owner: string;
  guardian: string | null;
  agent: { account_id: string; keys: KeyPermissionRecord[] };
  vault_keys: KeyPermissionRecord[];
  guardian_keys: KeyPermissionRecord[];
  policy: { weekly_cap_atomic: string; lifetime_cap_atomic: string; expires_at_ns: string };
  vendors: Array<{ vendor_id: string; display_name: string; account_id: string; per_payment_cap_atomic: string }>;
  payables: Array<{ payable_ref: string; vendor_id: string; amount_atomic: string; po_number: string; due_at_ns: string }>;
  funded_atomic: string;
}

/** Everything public about a deployment. Accounts, code hashes and key permissions. Never private keys. */
export interface DeploymentManifest {
  network: VaultNetwork;
  rpc_url: string;
  deployed_at: string;
  root: string;
  token: { contract_id: string; code_hash: string; name: string; symbol: string; decimals: number };
  evidence: { contract_id: string; code_hash: string; issuers: string[] };
  vaults: VaultDeployment[];
  wasm_sha256: Record<string, string>;
  contract_versions: { near_sdk: string; rust: string };
}

export function manifestPath(network: VaultNetwork): string {
  return repoPath("scripts", "contracts", "deployments", `${network}.json`);
}

export function readManifest(path: string): DeploymentManifest {
  if (!existsSync(path)) throw new Error(`No deployment manifest at ${path}. Run deploy-and-seed first.`);
  return JSON.parse(readFileSync(path, "utf8")) as DeploymentManifest;
}

export function readSigners(path: string): SignerFile {
  if (!existsSync(path)) throw new Error(`No signers file at ${path}. Run deploy-and-seed first.`);
  return JSON.parse(readFileSync(path, "utf8")) as SignerFile;
}

export function networkFromEnv(): { network: VaultNetwork; rpcUrl: string } {
  const network = process.env.NEAR_NETWORK ?? "testnet";
  assertAllowedNetwork(network);
  const rpcUrl = process.env.NEAR_RPC_URL ?? (network === "testnet" ? "https://test.rpc.fastnear.com" : undefined);
  if (!rpcUrl) throw new Error("NEAR_RPC_URL is required on sandbox");
  return { network, rpcUrl };
}

export { KeyPair };
