import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  KeyPair,
  type KeyPairString,
  nearToYocto,
  teraToGas,
} from "near-api-js";

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const TESTNET_RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
export const DEFAULT_GAS = teraToGas("100");
export const ONE_YOCTO = 1n;

export interface PublicKeyPermission {
  readonly public_key: string;
  readonly access_key: {
    readonly nonce: number;
    readonly permission:
      | "FullAccess"
      | {
          readonly FunctionCall: {
            readonly allowance: string | null;
            readonly receiver_id: string;
            readonly method_names: readonly string[];
          };
        };
  };
}

export function restrictedKeyViolations(
  keys: readonly PublicKeyPermission[],
  expectedPublicKey: string,
  expectedReceiver: string,
): readonly string[] {
  const violations: string[] = [];
  if (keys.length !== 1) {
    violations.push(`expected exactly one installed key, found ${keys.length}`);
  }
  for (const key of keys) {
    if (key.public_key !== expectedPublicKey) {
      violations.push(`unexpected public key ${key.public_key}`);
      continue;
    }
    if (key.access_key.permission === "FullAccess") {
      violations.push(`full access key installed: ${key.public_key}`);
      continue;
    }
    const permission = key.access_key.permission.FunctionCall;
    if (permission.receiver_id !== expectedReceiver) {
      violations.push(`receiver ${permission.receiver_id} is not ${expectedReceiver}`);
    }
    const methods = [...permission.method_names].sort();
    if (methods.length !== 1 || methods[0] !== "request_payment") {
      violations.push(`method permissions are ${methods.join(",") || "unrestricted"}`);
    }
    if (permission.allowance === null) {
      violations.push("function-call allowance is unlimited");
    } else {
      try {
        if (BigInt(permission.allowance) <= 0n) {
          violations.push("function-call allowance is not positive");
        }
      } catch {
        violations.push(`invalid function-call allowance ${permission.allowance}`);
      }
    }
  }
  return violations;
}

export interface DeploymentManifest {
  readonly schema_version: 1;
  readonly network: "testnet";
  readonly created_at: string;
  readonly owner_account_id: string;
  readonly accounts: {
    readonly token: string;
    readonly evidence: string;
    readonly vault_a: string;
    readonly vault_b: string;
    readonly agent_a: string;
    readonly agent_b: string;
    readonly vendor_a: string;
    readonly vendor_b: string;
  };
  readonly code_sha256: {
    readonly token: string;
    readonly evidence: string;
    readonly vault: string;
  };
  readonly agent_keys: {
    readonly agent_a: {
      readonly public_key: string;
      readonly expected_receiver_id: string;
      readonly expected_method_names: readonly ["request_payment"];
    };
    readonly agent_b: {
      readonly public_key: string;
      readonly expected_receiver_id: string;
      readonly expected_method_names: readonly ["request_payment"];
    };
  };
  readonly installed_key_permissions: {
    readonly agent_a: readonly PublicKeyPermission[];
    readonly agent_b: readonly PublicKeyPermission[];
  };
  readonly seed: {
    readonly vault_a_payables: readonly string[];
    readonly vault_b_payables: readonly string[];
    readonly token_decimals: 6;
  };
}

export function normalizeDeploymentPrefix(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])$/.test(normalized)) {
    throw new Error(
      "SPENDGYM_DEPLOYMENT_PREFIX must contain 2 to 20 lowercase letters, digits, or internal hyphens",
    );
  }
  return normalized;
}

export function requireTestnet(): void {
  const network = process.env.NEAR_NETWORK ?? "testnet";
  if (network !== "testnet") {
    throw new Error(`NEAR_NETWORK must be testnet, received ${network}`);
  }
  const normalized = TESTNET_RPC_URL.toLowerCase();
  if (normalized.includes("mainnet")) {
    throw new Error("mainnet RPC URLs are prohibited");
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function parseSecretKey(value: string, name: string): KeyPair {
  if (!value.startsWith("ed25519:") && !value.startsWith("secp256k1:")) {
    throw new Error(`${name} must be an encoded NEAR private key`);
  }
  return KeyPair.fromString(value as KeyPairString);
}

export function accountFromSecret(accountId: string, secretKey: string): Account {
  return new Account(accountId, TESTNET_RPC_URL, secretKey as KeyPairString);
}

export function readonlyAccount(accountId: string): Account {
  return new Account(accountId, TESTNET_RPC_URL);
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await readonlyAccount(accountId).getState();
    return true;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/unknown account|does not exist|UNKNOWN_ACCOUNT/i.test(text)) {
      return false;
    }
    throw error;
  }
}

export function subaccount(prefix: string, parent: string): string {
  const accountId = `${prefix}.${parent}`;
  if (accountId.length > 64) {
    throw new Error(`subaccount exceeds 64 characters: ${accountId}`);
  }
  return accountId;
}

export async function createSubaccount(
  parent: Account,
  prefix: string,
  bootstrap: KeyPair,
  nearAmount = "4",
): Promise<{ readonly accountId: string; readonly account: Account }> {
  const accountId = subaccount(prefix, parent.accountId);
  if (await accountExists(accountId)) {
    throw new Error(
      `${accountId} already exists. Use new prefixes so deployment remains deterministic and does not overwrite state.`,
    );
  }
  await parent.createSubAccount({
    accountOrPrefix: prefix,
    publicKey: bootstrap.getPublicKey(),
    nearToTransfer: nearToYocto(nearAmount),
  });
  return { accountId, account: accountFromSecret(accountId, bootstrap.toString()) };
}

export async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function deployWasm(account: Account, path: string): Promise<void> {
  const bytes = await readFile(path);
  await account.deployContract(bytes);
}

export async function call<T>(
  account: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  options: { readonly deposit?: bigint; readonly gas?: bigint } = {},
): Promise<T> {
  return (await account.callFunction({
    contractId,
    methodName,
    args,
    deposit: options.deposit ?? 0n,
    gas: options.gas ?? DEFAULT_GAS,
    waitUntil: "FINAL",
  })) as T;
}

export async function view<T>(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await readonlyAccount(contractId).provider.callFunction({
    contractId,
    method: methodName,
    args,
    blockQuery: { finality: "final" },
  });
  if (result === undefined) {
    throw new Error(`view ${contractId}.${methodName} returned no value`);
  }
  return result as T;
}

export function resolveFromRoot(path: string): string {
  return resolve(ROOT_DIR, path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
  await writeFile(path, `${encoded}\n`, { mode: 0o600 });
}

export function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

export function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}
