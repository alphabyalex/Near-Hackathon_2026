import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir } from "./lib.js";

const NEAR = 1_000_000_000_000_000_000_000_000n;
const WRAP = "wrap.testnet";
const REF = "ref-finance-101.testnet";
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);
  const rootId = "wardline-labs.testnet";
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error("No root key");
  const root = makeSigner(provider, rootId, rootKey);

  console.log("Checking storage deposits...");
  // 1. Storage deposit on wrap.testnet
  try {
    await root.account.signAndSendTransaction({
      receiverId: WRAP,
      actions: [
        actions.functionCall(
          "storage_deposit",
          { account_id: rootId, registration_only: false },
          50_000_000_000_000n,
          10_000_000_000_000_000_000_000n, // 0.01 NEAR
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log("wrap storage deposited");
  } catch (e: any) {
    console.log("wrap storage already ok or err:", e.message);
  }

  // 2. Storage deposit on ref-finance
  try {
    await root.account.signAndSendTransaction({
      receiverId: REF,
      actions: [
        actions.functionCall(
          "storage_deposit",
          { account_id: rootId, registration_only: false },
          50_000_000_000_000n,
          100_000_000_000_000_000_000_000n, // 0.1 NEAR
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log("ref storage deposited");
  } catch (e: any) {
    console.log("ref storage already ok or err:", e.message);
  }

  // 3. Deposit NEAR into wrap.testnet (3 NEAR)
  console.log("Wrapping 3 NEAR...");
  await root.account.signAndSendTransaction({
    receiverId: WRAP,
    actions: [
      actions.functionCall(
        "near_deposit",
        {},
        50_000_000_000_000n,
        3n * NEAR,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("3 NEAR wrapped into wNEAR");

  // 4. Swap wNEAR for USDC on pool 1845
  console.log("Swapping wNEAR -> USDC on Ref pool 1845...");
  const swapMsg = JSON.stringify({
    actions: [
      {
        pool_id: 1845,
        token_in: WRAP,
        token_out: USDC,
        amount_in: (3n * NEAR).toString(),
        min_amount_out: "1000000", // at least 1 USDC (6 decimals)
      },
    ],
  });

  const swapRes = await root.account.signAndSendTransaction({
    receiverId: WRAP,
    actions: [
      actions.functionCall(
        "ft_transfer_call",
        {
          receiver_id: REF,
          amount: (3n * NEAR).toString(),
          msg: swapMsg,
        },
        180_000_000_000_000n,
        1n, // 1 yoctoNEAR
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("Swap tx:", swapRes.transaction.hash);

  // 5. Withdraw USDC from Ref to rootId
  console.log("Withdrawing USDC from Ref to wardline-labs.testnet...");
  try {
    const withdrawRes = await root.account.signAndSendTransaction({
      receiverId: REF,
      actions: [
        actions.functionCall(
          "withdraw",
          {
            token_id: USDC,
            amount: "0", // 0 means withdraw all available balance in Ref
            unregister: false,
          },
          150_000_000_000_000n,
          1n, // 1 yoctoNEAR
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log("Withdraw tx:", withdrawRes.transaction.hash);
  } catch (e: any) {
    console.log("Withdraw error (check Ref balance):", e.message);
  }

  // 6. Check final USDC balance
  const balRes = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: USDC,
    method_name: "ft_balance_of",
    args_base64: Buffer.from(JSON.stringify({ account_id: rootId })).toString("base64"),
  });
  const bal = JSON.parse(Buffer.from((balRes as any).result).toString());
  console.log("Final Circle USDC balance on wardline-labs.testnet:", bal);
}

main().catch(console.error);
