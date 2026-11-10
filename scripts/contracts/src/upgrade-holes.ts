import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
  const meterSigner = makeSigner(provider, meterId, meterKey);

  const poolId = `pool.${rootId}`;
  const poolKey = creds.get(poolId);
  if (!poolKey) throw new Error("No pool key");
  const poolSigner = makeSigner(provider, poolId, poolKey);

  const preStatePath = join(homedir(), "wardline-pre-upgrade-state.json");
  if (!existsSync(preStatePath)) {
    throw new Error(`Pre-upgrade state snapshot missing at ${preStatePath}`);
  }
  const preState = JSON.parse(readFileSync(preStatePath, "utf8"));
  console.log("Loaded pre-upgrade state snapshot from:", preStatePath);
  console.log(`Pre-upgrade TVL: ${preState.pool.tvl}, WARD supply: ${preState.pool.ward_supply}, Proposals: ${preState.proposals.length}`);

  console.log("\n--- STEP 1: Deploying & Migrating Meter Contract ---");
  const meterWasm = readWasm("meter");
  console.log(`Meter wasm size: ${meterWasm.length} bytes`);
  const meterTx = await meterSigner.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.deployContract(meterWasm),
      actions.functionCall("migrate", {}, 60_000_000_000_000n, 0n),
    ],
    waitUntil: "FINAL",
  });
  const meterTxHash = meterTx.transaction.hash;
  console.log("Meter upgraded and migrated successfully! Tx hash:", meterTxHash);

  console.log("\n--- STEP 2: Deploying & Migrating Cover Pool Contract ---");
  const poolWasm = readWasm("cover-pool");
  console.log(`Cover pool wasm size: ${poolWasm.length} bytes`);
  const poolTx = await poolSigner.account.signAndSendTransaction({
    receiverId: poolId,
    actions: [
      actions.deployContract(poolWasm),
      actions.functionCall("migrate", {}, 60_000_000_000_000n, 0n),
    ],
    waitUntil: "FINAL",
  });
  const poolTxHash = poolTx.transaction.hash;
  console.log("Cover pool upgraded and migrated successfully! Tx hash:", poolTxHash);

  console.log("\n--- STEP 3: Verifying Post-Upgrade Views & State ---");
  const meterClient = new NearMeterClient({ contractId: meterId, provider });
  const poolClient = new NearCoverPoolClient({ contractId: poolId, provider });

  const postPool = await poolClient.getPool();
  console.log("Post-upgrade Pool:", {
    tvl: postPool.tvl,
    junior: postPool.junior,
    senior: postPool.senior,
    ward_supply: postPool.ward_supply,
    ward_price: postPool.ward_price,
    withdraw_delay_days: postPool.withdraw_delay_days,
  });

  const postReps = await meterClient.listReputations();
  console.log(`Post-upgrade Reputations count: ${postReps.length}`);

  const postProps = await poolClient.listProposals();
  console.log(`Post-upgrade Proposals count: ${postProps.length}`);

  const sampleAccounts = [
    "wardline-labs.testnet",
    "lp-north.wardline-labs.testnet",
    "lp-harbor.wardline-labs.testnet",
    "lp-solano.wardline-labs.testnet",
    "dana.wardline-labs.testnet",
    "eli.wardline-labs.testnet",
    "ruth.wardline-labs.testnet",
    "priya.wardline-labs.testnet",
    "sam.wardline-labs.testnet",
    "alice.wardline-labs.testnet",
  ];
  const postBalances: Record<string, string> = {};
  for (const acc of sampleAccounts) {
    postBalances[acc] = await poolClient.ftBalanceOf(acc);
  }

  // Verification checks against preState
  console.log("\n--- STEP 4: Verifying State Invariants ---");
  if (postPool.tvl !== preState.pool.tvl) {
    throw new Error(`TVL mismatch: pre ${preState.pool.tvl} != post ${postPool.tvl}`);
  }
  if (postPool.junior !== preState.pool.junior) {
    throw new Error(`Junior equity mismatch: pre ${preState.pool.junior} != post ${postPool.junior}`);
  }
  if (postPool.senior !== preState.pool.senior) {
    throw new Error(`Senior equity mismatch: pre ${preState.pool.senior} != post ${postPool.senior}`);
  }
  if (postPool.ward_supply !== preState.pool.ward_supply) {
    throw new Error(`WARD supply mismatch: pre ${preState.pool.ward_supply} != post ${postPool.ward_supply}`);
  }
  if (postPool.withdraw_delay_days !== 7) {
    throw new Error(`Expected withdraw_delay_days to be 7, got ${postPool.withdraw_delay_days}`);
  }
  console.log("Pool state invariants confirmed!");

  for (const acc of sampleAccounts) {
    if (postBalances[acc] !== preState.ward_balances[acc]) {
      throw new Error(`Balance mismatch for ${acc}: pre ${preState.ward_balances[acc]} != post ${postBalances[acc]}`);
    }
  }
  console.log("WARD balances confirmed identical!");

  if (postProps.length !== preState.proposals.length) {
    throw new Error(`Proposal count mismatch: pre ${preState.proposals.length} != post ${postProps.length}`);
  }
  console.log("All proposals confirmed preserved!");

  if (postReps.length !== preState.reputations.length) {
    throw new Error(`Reputations count mismatch: pre ${preState.reputations.length} != post ${postReps.length}`);
  }
  for (const preRep of preState.reputations) {
    const postRep = postReps.find((r) => r.budget_id === preRep.budget_id);
    if (!postRep) throw new Error(`Missing reputation for budget ${preRep.budget_id}`);
    if (postRep.proven_calls !== preRep.proven_calls) {
      throw new Error(`Proven calls mismatch for ${preRep.budget_id}: pre ${preRep.proven_calls} != post ${postRep.proven_calls}`);
    }
    if (postRep.refused_calls !== preRep.refused_calls) {
      throw new Error(`Refused calls mismatch for ${preRep.budget_id}: pre ${preRep.refused_calls} != post ${postRep.refused_calls}`);
    }
    if (postRep.spent !== preRep.spent) {
      throw new Error(`Spent mismatch for ${preRep.budget_id}: pre ${preRep.spent} != post ${postRep.spent}`);
    }
  }
  console.log("All reputation and budget metrics confirmed preserved!");

  const postState = {
    timestamp: new Date().toISOString(),
    network: "testnet",
    deploy_tx_hashes: {
      meter: meterTxHash,
      cover_pool: poolTxHash,
    },
    pool: postPool,
    proposals: postProps,
    reputations: postReps,
    ward_balances: postBalances,
  };
  const postStatePath = join(homedir(), "wardline-post-upgrade-state.json");
  writeFileSync(postStatePath, `${JSON.stringify(postState, null, 2)}\n`, "utf8");
  console.log("Saved post-upgrade state to:", postStatePath);
  console.log("\nALL UPGRADE CHECKS PASSED WITH ZERO LOSS OF STATE!");
}

main().catch((err) => {
  console.error("Upgrade failed:", err);
  process.exit(1);
});
