import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner, NearMeterClient, NearCoverPoolClient } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir, readWasm } from "./lib.js";

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId = "wardline-labs.testnet";
  const meterId = `meter.${rootId}`;
  const meterKey = creds.get(meterId);
  if (!meterKey) throw new Error("No meter key");
  const meter = makeSigner(provider, meterId, meterKey);

  const poolId = `pool.${rootId}`;
  const poolKey = creds.get(poolId);
  if (!poolKey) throw new Error("No pool key");
  const pool = makeSigner(provider, poolId, poolKey);

  console.log("Upgrading meter contract...");
  const meterWasm = readWasm("meter");
  console.log(`Meter wasm size: ${meterWasm.length} bytes`);
  const meterTx = await meter.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.deployContract(meterWasm),
      actions.functionCall("migrate", {}, 60_000_000_000_000n, 0n),
    ],
    waitUntil: "FINAL",
  });
  console.log("Meter upgraded! Tx:", meterTx.transaction.hash);

  console.log("\nUpgrading cover-pool contract...");
  const poolWasm = readWasm("cover-pool");
  console.log(`Pool wasm size: ${poolWasm.length} bytes`);
  const poolTx = await pool.account.signAndSendTransaction({
    receiverId: poolId,
    actions: [
      actions.deployContract(poolWasm),
      actions.functionCall("migrate", {}, 60_000_000_000_000n, 0n),
    ],
    waitUntil: "FINAL",
  });
  console.log("Pool upgraded! Tx:", poolTx.transaction.hash);

  console.log("\nVerifying on-chain methods via view calls...");
  const meterClient = new NearMeterClient({ contractId: meterId, provider });
  const poolClient = new NearCoverPoolClient({ contractId: poolId, provider });

  const reputations = await meterClient.listReputations();
  console.log("Meter listReputations():", reputations);

  const proposals = await poolClient.listProposals();
  console.log("Pool listProposals():", proposals);

  const govParams = await poolClient.governanceParams();
  console.log("Pool governanceParams():", govParams);
}

main().catch((err) => {
  console.error("Upgrade failed:", err);
  process.exit(1);
});
