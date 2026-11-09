import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir } from "./lib.js";

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId = "wardline-labs.testnet";
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error("No root key");
  const root = makeSigner(provider, rootId, rootKey);

  const meterId = `meter.${rootId}`;
  const agentId = `agent.${rootId}`;

  const leakBudgetId = `bgt_leaked_${Date.now()}`;
  console.log("=== Flow 3: Leaked-Key Cap (20 Rapid Calls) ===");
  console.log("1. Creating budget with 50,000 unit deposit cap:", leakBudgetId);

  await root.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.functionCall(
        "create_budget",
        {
          budget_id: leakBudgetId,
          name: "Leaked key test budget",
          owner: rootId,
          deposit: "50000",
          period: "week",
          members: [{ member: agentId, allowance: "50000" }],
        },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("Budget created with deposit cap = 50,000 units.");

  let capTxFirstDrain = "";
  let capTxFirstExhausted = "";
  const rapidTxHashes: string[] = [];

  console.log("2. Simulating 20 rapid calls from leaked key (10,000 units each)...");
  for (let i = 1; i <= 20; i++) {
    const rapidCallId = `call_rapid_${i}_${Date.now()}`;
    const res: any = await root.account.signAndSendTransaction({
      receiverId: meterId,
      actions: [
        actions.functionCall(
          "reserve",
          {
            budget_id: leakBudgetId,
            member: agentId,
            call_id: rapidCallId,
            model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            max_amount: "10000",
          },
          100_000_000_000_000n,
          0n,
        ),
      ],
      waitUntil: "FINAL",
    });

    const val = JSON.parse(Buffer.from(res.status.SuccessValue, "base64").toString());
    rapidTxHashes.push(res.transaction.hash);

    if (i <= 5) {
      if (!val.ok) throw new Error(`Expected call ${i} to succeed, got: ${JSON.stringify(val)}`);
      console.log(`Call ${i}/20: OK (reserved 10000) - tx: ${res.transaction.hash}`);
      if (i === 5) capTxFirstDrain = res.transaction.hash;
    } else {
      if (val.ok) throw new Error(`Expected call ${i} to be blocked by BUDGET_EXHAUSTED!`);
      console.log(`Call ${i}/20: BLOCKED with ${val.reason} - tx: ${res.transaction.hash}`);
      if (i === 6) capTxFirstExhausted = res.transaction.hash;
    }
  }

  console.log("\nSUCCESS Flow 3: Calls 1-5 drained budget; calls 6-20 refused with BUDGET_EXHAUSTED!");
  console.log("5th drain tx:", capTxFirstDrain);
  console.log("6th exhaustion refusal tx:", capTxFirstExhausted);
}

main().catch(console.error);
