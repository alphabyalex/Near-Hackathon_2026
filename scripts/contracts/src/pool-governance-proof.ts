import { join } from "node:path";
import { makeProvider, makeSigner, NearCoverPoolClient } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir } from "./lib.js";

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId = "wardline-labs.testnet";
  const poolId = `pool.${rootId}`;

  const investor1Id = `investor1.${rootId}`;
  const investor1Key = creds.get(investor1Id);
  if (!investor1Key) throw new Error("No investor1 key");
  const investor1 = makeSigner(provider, investor1Id, investor1Key);

  console.log("=== Testing WARD-Holder Governance on NEAR Testnet ===");
  console.log(`Pool: ${poolId}`);
  console.log(`Proposer: ${investor1Id}`);

  const pool = new NearCoverPoolClient({
    contractId: poolId,
    provider,
    signer: investor1,
  });

  // 1. Check weight of investor1
  const pos = await pool.getPosition(investor1Id);
  console.log(`investor1 WARD balance: ${pos.ward} atomic`);

  // 2. Submit proposal as investor1
  console.log("\n1. Submitting proposal to raise coverage multiplier to 1.25x...");
  const proposal = await pool.propose({
    description: "Raise coverage multiplier to 1.25x for all tiers",
    action: {
      type: "set_coverage_multiplier",
      multiplier_bps: 12500,
    },
  });
  console.log("Proposal created:", proposal);

  // 3. Cast a vote
  console.log("\n2. Casting vote 'for' as investor1...");
  const voted = await pool.vote({
    id: proposal.id,
    support: "for",
  });
  console.log("Proposal after vote:", voted);

  // 4. List all proposals on pool
  console.log("\n3. Listing all proposals on pool...");
  const list = await pool.listProposals();
  console.log(`Total proposals: ${list.length}`);
  for (const p of list) {
    console.log(`  #${p.id} [${p.status}] ${p.description} (votes_for: ${p.votes_for}, votes_against: ${p.votes_against})`);
  }
}

main().catch((err) => {
  console.error("Governance proof failed:", err);
  process.exit(1);
});
