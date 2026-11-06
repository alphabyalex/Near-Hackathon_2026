import { readFile } from "node:fs/promises";
import {
  json,
  readonlyAccount,
  requireTestnet,
  restrictedKeyViolations,
  resolveFromRoot,
  type DeploymentManifest,
  type PublicKeyPermission,
} from "./common.js";

async function inspect(
  label: "agent_a" | "agent_b",
  accountId: string,
  expectedPublicKey: string,
  expectedReceiver: string,
): Promise<readonly PublicKeyPermission[]> {
  const response = await readonlyAccount(accountId).getAccessKeyList();
  const keys = response.keys as readonly PublicKeyPermission[];
  const violations = restrictedKeyViolations(keys, expectedPublicKey, expectedReceiver);
  console.log(`${label} ${accountId}`);
  console.log(json(keys));
  if (violations.length > 0) {
    throw new Error(`${label} key audit failed: ${violations.join("; ")}`);
  }
  return keys;
}

async function main(): Promise<void> {
  requireTestnet();
  const manifestPath = process.env.SPENDGYM_DEPLOYMENT_MANIFEST
    ?? resolveFromRoot("scripts/contracts/deployments/testnet.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as DeploymentManifest;
  if (manifest.network !== "testnet") {
    throw new Error(`manifest network must be testnet, received ${manifest.network}`);
  }

  await inspect(
    "agent_a",
    manifest.accounts.agent_a,
    manifest.agent_keys.agent_a.public_key,
    manifest.agent_keys.agent_a.expected_receiver_id,
  );
  await inspect(
    "agent_b",
    manifest.accounts.agent_b,
    manifest.agent_keys.agent_b.public_key,
    manifest.agent_keys.agent_b.expected_receiver_id,
  );
  console.log("restricted-key audit passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
