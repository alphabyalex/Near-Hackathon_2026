import { readFileSync } from "node:fs";

export type VaultNetwork = "sandbox" | "testnet";

export interface SignerConfig {
  account_id: string;
  /** `ed25519:...`. Never commit this. */
  private_key: string;
}

export interface VaultSigners {
  /** Holds the function-call key restricted to `request_payment` on this vault. */
  agent?: SignerConfig;
  /** Needed for `ownerPay` and the admin methods. */
  owner?: SignerConfig;
  /** Needed for `pause` when the deployment uses a guardian instead of the owner. */
  guardian?: SignerConfig;
}

export interface VaultClientConfig {
  network: VaultNetwork;
  rpc_url: string;
  /** Vault account id to the keys this process may use for it. */
  signers: Record<string, VaultSigners>;
  /** How long to keep asking for a final outcome before giving up with `VaultOutcomeUnknownError`. */
  final_timeout_ms?: number;
  poll_interval_ms?: number;
}

export const DEFAULT_RPC_URLS: Record<VaultNetwork, string | null> = {
  sandbox: null,
  testnet: "https://test.rpc.fastnear.com",
};

/** The repo's hard rule, enforced in code: sandbox and testnet only. */
export function assertAllowedNetwork(network: string): asserts network is VaultNetwork {
  if (network !== "sandbox" && network !== "testnet") {
    throw new Error(`NEAR_NETWORK must be sandbox or testnet, got "${network}". Mainnet is out of scope.`);
  }
}

/**
 * Reads config from the environment:
 * - `NEAR_NETWORK`: sandbox or testnet. Required.
 * - `NEAR_RPC_URL`: required for sandbox. Defaults to a public RPC on testnet.
 * - `REDLINE_VAULT_SIGNERS_FILE`: path to a JSON file holding `signers`. Keep it outside the repo.
 * - `REDLINE_VAULT_SIGNERS`: the same JSON inline, for hosts that only offer env vars.
 *
 * With no signers set, views still work, and signing methods throw before sending anything.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): VaultClientConfig {
  const network = env.NEAR_NETWORK ?? "";
  assertAllowedNetwork(network);
  const rpc_url = env.NEAR_RPC_URL ?? DEFAULT_RPC_URLS[network];
  if (!rpc_url) throw new Error("NEAR_RPC_URL is required on sandbox");

  let signers: Record<string, VaultSigners> = {};
  if (env.REDLINE_VAULT_SIGNERS_FILE) {
    signers = JSON.parse(readFileSync(env.REDLINE_VAULT_SIGNERS_FILE, "utf8")) as Record<string, VaultSigners>;
  } else if (env.REDLINE_VAULT_SIGNERS) {
    signers = JSON.parse(env.REDLINE_VAULT_SIGNERS) as Record<string, VaultSigners>;
  }
  return { network, rpc_url, signers };
}
