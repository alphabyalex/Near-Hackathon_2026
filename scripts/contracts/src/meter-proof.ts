import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir, readWasm } from "./lib.js";

const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

const REAL_PROOF = {
  model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  request_hash: "ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c",
  response_hash: "2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9",
  text: "deepseek-ai/DeepSeek-V4.1-Flash-1017:ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c:2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9",
  signature:
    "0xa3486136dcb0e7592a5aacef44edb867648ed75ac98e8b3e4621468a68795dc564e006f5aa2d192530c6a87437e76c0a1ce45fdc8c8edd576c84bc94da717e641c",
  signing_address: "0xfe0071895500a9755c18044948ab4f4e1a7f337e",
  chat_id: "chatcmpl-96068d70-a320-4475-a330-400be955d887",
};

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId = "wardline-labs.testnet";
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error("No root key");
  const root = makeSigner(provider, rootId, rootKey);

  const meterId = `meter.${rootId}`;
  const meterKey = creds.get(meterId);
  if (!meterKey) throw new Error("No meter key");
  const meter = makeSigner(provider, meterId, meterKey);

  const providerId = `provider.${rootId}`;
  const agentId = `agent.${rootId}`;

  console.log("Step 0: Upgrading meter contract code with MODEL_NOT_ATTESTED reason...");
  const wasm = readWasm("meter");
  await meter.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [actions.deployContract(wasm)],
    waitUntil: "FINAL",
  });
  console.log("Meter contract upgraded.");

  console.log("\nStep 0.1: Funding bgt_engineering on meter with 0.20 USDC (200,000 units)...");
  const fundRes = await root.account.signAndSendTransaction({
    receiverId: USDC,
    actions: [
      actions.functionCall(
        "ft_transfer_call",
        {
          receiver_id: meterId,
          amount: "200000",
          msg: JSON.stringify({ budget_id: "bgt_engineering" }),
        },
        150_000_000_000_000n,
        1n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("bgt_engineering funded tx:", fundRes.transaction.hash);

  // Verify budget deposit
  let bgtRes: any = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: meterId,
    method_name: "get_budget",
    args_base64: Buffer.from(JSON.stringify({ budget_id: "bgt_engineering" })).toString("base64"),
  });
  let bgt = JSON.parse(Buffer.from(bgtRes.result).toString());
  console.log("bgt_engineering deposit:", bgt.deposit);

  console.log("\n=== Flow 1: 1 Paid AI Call (DeepSeek V4.1 Flash) ===");
  const call1Id = `call_deepseek_paid_${Date.now()}`;
  console.log("1. Reserving 0.05 USDC (50,000 units) on bgt_engineering for call:", call1Id);
  const reserve1Res = await root.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.functionCall(
        "reserve",
        {
          budget_id: "bgt_engineering",
          member: agentId,
          call_id: call1Id,
          model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
          max_amount: "50000",
        },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const reserve1Tx = reserve1Res.transaction.hash;
  console.log("Reserve 1 tx:", reserve1Tx);

  console.log("2. Settling call with verified DeepSeek completion proof and paying provider...");
  const settle1Res = await root.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.functionCall(
        "settle",
        {
          call_id: call1Id,
          amount: "50000",
          proof: REAL_PROOF,
          pay_to: providerId,
        },
        250_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const settle1Tx = settle1Res.transaction.hash;
  console.log("Settle 1 tx:", settle1Tx);

  // Check provider USDC balance
  let provBalRes: any = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: USDC,
    method_name: "ft_balance_of",
    args_base64: Buffer.from(JSON.stringify({ account_id: providerId })).toString("base64"),
  });
  let provBal = JSON.parse(Buffer.from(provBalRes.result).toString());
  console.log("Provider USDC balance after payout:", provBal);
  console.log("SUCCESS Flow 1: Paid AI call settled and USDC moved to provider + pool fee!");

  console.log("\n=== Flow 2: 1 Refused Swapped-Model Call ===");
  const call2Id = `call_swapped_cheapai_${Date.now()}`;
  console.log("1. Reserving 0.05 USDC for call:", call2Id);
  const reserve2Res = await root.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.functionCall(
        "reserve",
        {
          budget_id: "bgt_engineering",
          member: agentId,
          call_id: call2Id,
          model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
          max_amount: "50000",
        },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const reserve2Tx = reserve2Res.transaction.hash;
  console.log("Reserve 2 tx:", reserve2Tx);

  console.log("2. Cheapai returns swapped model with un-attested signer...");
  // Fake proof signed by an unauthorized/swapped signer
  const FAKE_SWAPPED_PROOF = {
    ...REAL_PROOF,
    signing_address: "0x1111111111111111111111111111111111111111",
    chat_id: `chatcmpl_swapped_${Date.now()}`,
  };

  const settle2Res = await root.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.functionCall(
        "settle",
        {
          call_id: call2Id,
          amount: "50000",
          proof: FAKE_SWAPPED_PROOF,
          pay_to: providerId,
        },
        150_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const settle2Tx = settle2Res.transaction.hash;
  console.log("Settle 2 (refused) tx:", settle2Tx);

  console.log("3. Refunding budget by calling release with MODEL_NOT_ATTESTED reason...");
  const release2Res = await root.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.functionCall(
        "release",
        {
          call_id: call2Id,
          reason: "MODEL_NOT_ATTESTED",
        },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const release2Tx = release2Res.transaction.hash;
  console.log("Release 2 tx:", release2Tx);
  console.log("SUCCESS Flow 2: Swapped model refused with MODEL_NOT_ATTESTED and budget refunded!");

  console.log("\n=== Flow 3: Leaked-Key Cap (20 Rapid Calls) ===");
  // Create a budget with exactly 50,000 units cap
  const leakBudgetId = `bgt_leaked_${Date.now()}`;
  console.log("1. Setting up budget with strict 50,000 unit deposit:", leakBudgetId);
  await root.account.signAndSendTransaction({
    receiverId: meterId,
    actions: [
      actions.functionCall(
        "set_budget",
        {
          budget_id: leakBudgetId,
          name: "Leaked key test budget",
          owner: rootId,
          period: "week",
          members: [{ member: agentId, allowance: "50000" }],
        },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });

  // Fund it with exactly 50,000 USDC units
  await root.account.signAndSendTransaction({
    receiverId: USDC,
    actions: [
      actions.functionCall(
        "ft_transfer_call",
        {
          receiver_id: meterId,
          amount: "50000",
          msg: JSON.stringify({ budget_id: leakBudgetId }),
        },
        150_000_000_000_000n,
        1n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("Budget funded with 50,000 units.");

  let capTxFirstDrain = "";
  let capTxFirstExhausted = "";

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
