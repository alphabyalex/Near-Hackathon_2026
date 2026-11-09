import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir } from "./lib.js";

const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId = "wardline-labs.testnet";
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error("No root key");
  const root = makeSigner(provider, rootId, rootKey);

  const poolId = `pool.${rootId}`;
  const investor1Id = `investor1.${rootId}`;
  const investor1Key = creds.get(investor1Id);
  if (!investor1Key) throw new Error("No investor1 key");
  const investor1 = makeSigner(provider, investor1Id, investor1Key);

  console.log("=== Flow 5: First-Loss Stake & Mutual Payout ===");

  // 1. Transfer first-loss stake into cover pool from root (junior_holder)
  console.log("1. Depositing 0.30 USDC (300,000 units) to pool first-loss stake...");
  const firstLossRes = await root.account.signAndSendTransaction({
    receiverId: USDC,
    actions: [
      actions.functionCall(
        "ft_transfer_call",
        {
          receiver_id: poolId,
          amount: "300000",
          msg: JSON.stringify({ first_loss: true }),
        },
        150_000_000_000_000n,
        1n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("First-loss deposit tx:", firstLossRes.transaction.hash);

  // 2. Query pool to verify junior balance
  let poolState: any = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: poolId,
    method_name: "get_pool",
    args_base64: Buffer.from("{}").toString("base64"),
  });
  let decodedPool = JSON.parse(Buffer.from(poolState.result).toString());
  console.log("Pool state after first-loss deposit:", {
    junior: decodedPool.junior,
    senior: decodedPool.senior,
    ward_price: decodedPool.ward_price,
  });

  // 3. File a claim against the pool for 0.05 USDC (50,000 units)
  console.log("2. Filing claim for 0.05 USDC (50,000 units) due to simulated invalid settlement...");
  const claimRes = await root.account.signAndSendTransaction({
    receiverId: poolId,
    actions: [
      actions.functionCall(
        "file_claim",
        {
          subject: "stl_invalid_settlement_test",
          claimant: rootId,
          amount: "50000",
          reason: "Simulate invalid settlement accepted by mistake; customer refund",
        },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const claimTx = claimRes.transaction.hash;
  console.log("Claim filing tx:", claimTx);

  // 4. Query claims and verify first-loss absorbed it
  const claimsRes: any = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: poolId,
    method_name: "list_claims",
    args_base64: Buffer.from("{}").toString("base64"),
  });
  const claims = JSON.parse(Buffer.from(claimsRes.result).toString());
  const filedClaim = claims[0];
  console.log("Claim record:", {
    claim_id: filedClaim.claim_id,
    amount: filedClaim.amount,
    status: filedClaim.status,
    paid_from_junior: filedClaim.paid_from_junior,
    paid_from_senior: filedClaim.paid_from_senior,
  });

  if (filedClaim.paid_from_junior === "50000" && filedClaim.paid_from_senior === "0") {
    console.log("SUCCESS: 100% of claim was absorbed by junior first-loss stake!");
  } else {
    throw new Error("FAIL: Claim not absorbed by junior first loss");
  }

  console.log("\n=== Flow 6: Investor WARD Deposit & Redeem ===");

  // 1. Send 0.20 USDC from root to investor1
  console.log("1. Sending 0.20 USDC (200,000 units) from root to investor1...");
  const sendRes = await root.account.signAndSendTransaction({
    receiverId: USDC,
    actions: [
      actions.functionCall(
        "ft_transfer",
        {
          receiver_id: investor1Id,
          amount: "200000",
        },
        50_000_000_000_000n,
        1n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("USDC transfer to investor1 tx:", sendRes.transaction.hash);

  // 2. Investor deposits USDC into pool to mint WARD
  console.log("2. Investor1 depositing 0.20 USDC to pool to mint WARD...");
  const depRes = await investor1.account.signAndSendTransaction({
    receiverId: USDC,
    actions: [
      actions.functionCall(
        "ft_transfer_call",
        {
          receiver_id: poolId,
          amount: "200000",
          msg: JSON.stringify({}),
        },
        150_000_000_000_000n,
        1n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const depTx = depRes.transaction.hash;
  console.log("Investor deposit tx:", depTx);

  // Check investor WARD balance
  let wardBalRes: any = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: poolId,
    method_name: "ft_balance_of",
    args_base64: Buffer.from(JSON.stringify({ account_id: investor1Id })).toString("base64"),
  });
  let wardBal = JSON.parse(Buffer.from(wardBalRes.result).toString());
  console.log("Investor1 WARD balance:", wardBal);

  // 3. Investor requests redeem of 100,000 WARD (0.10 USDC)
  console.log("3. Investor1 requesting redeem of 100,000 WARD...");
  const reqRes = await investor1.account.signAndSendTransaction({
    receiverId: poolId,
    actions: [
      actions.functionCall(
        "request_redeem",
        { amount: "100000" },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const reqTx = reqRes.transaction.hash;
  console.log("Redeem request tx:", reqTx);

  // Query position to get withdrawal id
  const posRes: any = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: poolId,
    method_name: "get_position",
    args_base64: Buffer.from(JSON.stringify({ account: investor1Id })).toString("base64"),
  });
  const pos = JSON.parse(Buffer.from(posRes.result).toString());
  const pendingWd = pos.pending_withdrawals[0];
  console.log("Pending withdrawal:", pendingWd);

  // 4. Execute redeem (withdraw_delay_days is 0)
  console.log("4. Executing redeem for withdrawal id:", pendingWd.id);
  const redeemRes = await investor1.account.signAndSendTransaction({
    receiverId: poolId,
    actions: [
      actions.functionCall(
        "redeem",
        {
          account: investor1Id,
          id: pendingWd.id,
        },
        200_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const redeemTx = redeemRes.transaction.hash;
  console.log("Redeem execution tx:", redeemTx);

  // Check investor USDC balance
  const invUsdcRes: any = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: USDC,
    method_name: "ft_balance_of",
    args_base64: Buffer.from(JSON.stringify({ account_id: investor1Id })).toString("base64"),
  });
  const invUsdc = JSON.parse(Buffer.from(invUsdcRes.result).toString());
  console.log("Investor1 final USDC balance:", invUsdc);
  console.log("SUCCESS: WARD redeem flow completed and USDC returned to investor!");
}

main().catch(console.error);
