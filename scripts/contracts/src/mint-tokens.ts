import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner, viewCall } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir } from "./lib.js";

const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const TOKEN_ID = "token.wardline-labs.testnet";
const POOL_ID = "pool.wardline-labs.testnet";

const STORAGE_DEPOSIT_NEAR = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
const GAS = 100_000_000_000_000n;

interface MintOptions {
  recipient: string;
  amountAtomic: string;
  kind: "token" | "usdc" | "ward";
}

async function ensureStorage(
  signer: ReturnType<typeof makeSigner>,
  contractId: string,
  accountId: string,
) {
  try {
    await signer.account.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.functionCall(
          "storage_deposit",
          { account_id: accountId, registration_only: false },
          GAS,
          STORAGE_DEPOSIT_NEAR,
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log(`  storage registered on ${contractId} for ${accountId}`);
  } catch (e: any) {
    // Already registered or ok
  }
}

export async function mintOrTransferTokens(options: MintOptions) {
  const rootId = "wardline-labs.testnet";
  const rpcUrl = "https://test.rpc.fastnear.com";
  const provider = makeProvider(rpcUrl);

  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error(`Missing credentials for ${rootId}`);

  const root = makeSigner(provider, rootId, rootKey);

  console.log(`\n--- Minting/Funding ${options.kind.toUpperCase()} to ${options.recipient} (${options.amountAtomic} units) ---`);

  if (options.kind === "token") {
    // 1. Storage deposit on token contract
    await ensureStorage(root, TOKEN_ID, options.recipient);

    // 2. Mint tokens directly to recipient
    const outcome = await root.account.signAndSendTransaction({
      receiverId: TOKEN_ID,
      actions: [
        actions.functionCall(
          "mint",
          { account_id: options.recipient, amount: options.amountAtomic },
          GAS,
          0n,
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log(`  Minted ${options.amountAtomic} units of ${TOKEN_ID}! Tx: ${outcome.transaction.hash}`);

    const bal = await viewCall(provider, TOKEN_ID, "ft_balance_of", { account_id: options.recipient });
    console.log(`  New ${TOKEN_ID} balance of ${options.recipient}: ${bal}`);
    return outcome.transaction.hash;
  }

  if (options.kind === "usdc") {
    // 1. Storage deposit on USDC contract
    await ensureStorage(root, USDC, options.recipient);

    // 2. Transfer USDC from root
    const outcome = await root.account.signAndSendTransaction({
      receiverId: USDC,
      actions: [
        actions.functionCall(
          "ft_transfer",
          { receiver_id: options.recipient, amount: options.amountAtomic, memo: "Wardline testnet fund" },
          GAS,
          1n,
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log(`  Transferred ${options.amountAtomic} units of USDC! Tx: ${outcome.transaction.hash}`);

    const bal = await viewCall(provider, USDC, "ft_balance_of", { account_id: options.recipient });
    console.log(`  New Circle USDC balance of ${options.recipient}: ${bal}`);
    return outcome.transaction.hash;
  }

  if (options.kind === "ward") {
    // 1. Storage deposit on WARD pool for recipient
    await ensureStorage(root, POOL_ID, options.recipient);

    // 2. Deposit USDC into pool on behalf of recipient
    const outcome = await root.account.signAndSendTransaction({
      receiverId: USDC,
      actions: [
        actions.functionCall(
          "ft_transfer_call",
          {
            receiver_id: POOL_ID,
            amount: options.amountAtomic,
            memo: "Wardline Mutual share deposit",
            msg: JSON.stringify({ recipient: options.recipient }),
          },
          150_000_000_000_000n,
          1n,
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log(`  Deposited USDC to mint WARD! Tx: ${outcome.transaction.hash}`);

    const bal = await viewCall(provider, POOL_ID, "ft_balance_of", { account_id: options.recipient });
    console.log(`  New WARD balance of ${options.recipient}: ${bal}`);
    return outcome.transaction.hash;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const targetAccount = args[0] || "agent.wardline-labs.testnet";
  const amount = args[1] || "10000000"; // 10 tokens (6 decimals)

  console.log("=== Minting Standard Test Tokens for Wardline Accounts ===");
  console.log(`Target: ${targetAccount}, Amount: ${amount}`);

  // Mint mock tokens to target
  await mintOrTransferTokens({ recipient: targetAccount, amountAtomic: amount, kind: "token" });

  // If specific accounts, also ensure investor1 and investor2 have tokens
  if (targetAccount === "agent.wardline-labs.testnet") {
    await mintOrTransferTokens({ recipient: "investor1.wardline-labs.testnet", amountAtomic: "50000000", kind: "token" });
    await mintOrTransferTokens({ recipient: "investor2.wardline-labs.testnet", amountAtomic: "50000000", kind: "token" });
    await mintOrTransferTokens({ recipient: "wardline-labs.testnet", amountAtomic: "100000000", kind: "token" });
  }

  console.log("\nAll accounts successfully minted uniform testnet tokens!");
}

if (process.argv[1]?.endsWith("mint-tokens.ts")) {
  main().catch(console.error);
}
