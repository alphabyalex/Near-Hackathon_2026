/**
 * pnpm testnet:preflight: every key on this machine against NEAR testnet. Prints public keys only.
 *
 * Reads the credential store (defaultSecretsDir("testnet")/credentials.json) and .env's gateway key,
 * derives each public key, and checks it with view_access_key_list. Exits 1 if the root key does not
 * match or the gateway key is missing or not a reserve/settle/release key on the meter.
 */
import { join } from "node:path";
import { KeyPair, type KeyPairString } from "@wardline/vault-client";
import { makeRpc } from "../../services/api/src/activity/log.js";
import { CredentialStore, defaultSecretsDir } from "../contracts/src/lib.js";
import { loadDotEnv, RPC_URLS } from "./chain-log.js";

export const ROOT = "wardline-labs.testnet";
export const ROOT_KEY_PREFIX = "ed25519:FGUWrt4Y";
const rpc = makeRpc(RPC_URLS);

type Permission = "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[] } };

export async function keysOnChain(account: string): Promise<Map<string, Permission> | null> {
  // view_access_key_list answers an empty list for an account that does not exist, so check it first.
  if ((await nearBalance(account)) === "-") return null;
  try {
    const r = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: account });
    return new Map((r.keys as Array<{ public_key: string; access_key: { permission: Permission } }>).map((k) => [k.public_key, k.access_key.permission]));
  } catch {
    return null;
  }
}

export async function nearBalance(account: string): Promise<string> {
  try {
    const r = await rpc("query", { request_type: "view_account", finality: "final", account_id: account });
    return (Number(BigInt(r.amount) / 10n ** 21n) / 1000).toFixed(3);
  } catch {
    return "-";
  }
}

export const publicKeyOf = (secret: string) => KeyPair.fromString(secret as KeyPairString).getPublicKey().toString();

async function main(): Promise<void> {
  loadDotEnv();
  const store = new CredentialStore(join(defaultSecretsDir("testnet"), "credentials.json"));
  const accounts = Object.keys((store as unknown as { data: { accounts: Record<string, string> } }).data.accounts);
  const rows: string[][] = [];
  let rootOk = false;
  let missing = 0;
  for (const account of accounts) {
    const pub = publicKeyOf(store.get(account)!);
    const keys = await keysOnChain(account);
    const perm = keys?.get(pub);
    const status = !keys ? "NOT ON CHAIN (no account)" : perm ? "MATCHES" : "NOT ON CHAIN (key)";
    if (!keys) missing++;
    if (account === ROOT && perm === "FullAccess" && pub.startsWith(ROOT_KEY_PREFIX)) rootOk = true;
    if (keys || process.argv.includes("--all")) rows.push([account, perm ? (perm === "FullAccess" ? "FullAccess" : "FunctionCall") : "-", `${pub.slice(0, 16)}...`, status, keys ? await nearBalance(account) : "-"]);
  }
  // The meter gateway key from .env.
  let gatewayOk = false;
  const gAccount = process.env.WARDLINE_GATEWAY_ACCOUNT;
  const gKey = process.env.WARDLINE_GATEWAY_KEY;
  if (gAccount && gKey) {
    const pub = publicKeyOf(gKey);
    const perm = (await keysOnChain(gAccount))?.get(pub);
    const fc = perm && perm !== "FullAccess" ? perm.FunctionCall : null;
    gatewayOk = Boolean(fc && fc.receiver_id === "meter.wardline-labs.testnet" && ["reserve", "settle", "release"].every((m) => fc.method_names.includes(m)));
    rows.push([`${gAccount} (gateway, .env)`, fc ? `FunctionCall [${fc.method_names.join(", ")}]` : perm ? "FullAccess" : "-", `${pub.slice(0, 16)}...`, gatewayOk ? "MATCHES" : "NOT ON CHAIN", "-"]);
  } else {
    rows.push(["WARDLINE_GATEWAY_ACCOUNT/KEY", "-", "-", "MISSING in .env", "-"]);
  }

  const widths = [0, 1, 2, 3, 4].map((i) => Math.max(...rows.map((r) => r[i]!.length), ["Account", "Key type", "Public key", "Status", "NEAR"][i]!.length));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;
  console.log(line(["Account", "Key type", "Public key", "Status", "NEAR"]));
  console.log(`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`);
  for (const r of rows) console.log(line(r));
  console.log(`\n${accounts.length} keys in the credential store; ${missing} for accounts that do not exist yet${process.argv.includes("--all") ? "" : " (hidden; --all lists them)"}.`);
  console.log(`Root ${ROOT}: ${rootOk ? `MATCHES ${ROOT_KEY_PREFIX}` : "DOES NOT MATCH"}. Gateway key: ${gatewayOk ? "MATCHES" : "missing or wrong"}.`);
  process.exit(rootOk && gatewayOk ? 0 : 1);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/testnet/preflight.ts")) {
  main().catch((err: Error) => {
    console.error(`Preflight failed: ${err.message}`);
    process.exit(1);
  });
}
