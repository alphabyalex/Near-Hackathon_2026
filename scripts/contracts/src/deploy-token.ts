import { join } from "node:path";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, Deployer, defaultSecretsDir, readWasm } from "./lib.js";

const NEAR = 1_000_000_000_000_000_000_000_000n;

async function main() {
  const rootId = "wardline-labs.testnet";
  const rpcUrl = "https://test.rpc.fastnear.com";
  const provider = makeProvider(rpcUrl);

  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error(`No credentials found for ${rootId} in ${credPath}`);

  const root = makeSigner(provider, rootId, rootKey);
  const deployer = new Deployer("testnet", rpcUrl, creds, console.log);

  console.log("=== Deploying token.wardline-labs.testnet ===");
  const tokenId = `token.${rootId}`;
  const tokenAccount = await deployer.ensureAccount(tokenId, root, 2500n * (NEAR / 1000n));

  const wasmBytes = readWasm("mock-token");

  await deployer.ensureContract(tokenAccount, wasmBytes, {
    method: "new",
    args: { owner: rootId },
  });

  console.log(`Successfully deployed and initialized ${tokenId}!`);
}

main().catch(console.error);
