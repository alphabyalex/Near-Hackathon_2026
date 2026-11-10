import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actions, KeyPair, makeProvider, makeSigner, viewCall, type KeyPairString } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir, MILLINEAR, viewAccount } from "../contracts/src/lib.js";

const RPC_URL = process.env.WARDLINE_NEAR_RPC_URL ?? process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const ROOT_ACCOUNT = "wardline-labs.testnet";
const USDC_CONTRACT = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const METER_CONTRACT = "meter.wardline-labs.testnet";
const POOL_CONTRACT = "pool.wardline-labs.testnet";
const PAYEE_REGISTRY_CONTRACT = "payee-registry.wardline-labs.testnet";

const STORAGE_DEPOSIT_NEAR = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
const ACCOUNT_CREATION_NEAR = 35n * MILLINEAR; // 0.035 NEAR
const GAS = 100_000_000_000_000n;

export interface SetupOptions {
  dryRun?: boolean;
  castPath?: string;
  outputPath?: string;
}

export interface SetupResult {
  network: string;
  dryRun: boolean;
  timestamp: string;
  root_account: string;
  accounts_checked: number;
  accounts_created: string[];
  budgets_configured: string[];
  vendors_attested: string[];
  transactions: Array<{ action: string; target: string; tx?: string }>;
}

export function sha256Digest(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export async function runSetup(opts: SetupOptions = {}): Promise<SetupResult> {
  const isDryRun = opts.dryRun ?? process.argv.includes("--dry-run");
  const castPath = opts.castPath ?? join(process.cwd(), "scripts/testnet/cast.json");
  const outputPath = opts.outputPath ?? join(process.cwd(), "data/testnet/setup.json");

  console.log(`=== Wardline Testnet Setup (mode: ${isDryRun ? "DRY-RUN" : "LIVE"}) ===`);

  if (!existsSync(castPath)) {
    throw new Error(`Cast file not found at ${castPath}`);
  }

  const cast = JSON.parse(readFileSync(castPath, "utf8"));
  const provider = makeProvider(RPC_URL);
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootKey = creds.get(ROOT_ACCOUNT);
  if (!rootKey && !isDryRun) {
    throw new Error(`Missing credentials for root account ${ROOT_ACCOUNT} in ${credPath}`);
  }

  const rootSigner = rootKey ? makeSigner(provider, ROOT_ACCOUNT, rootKey) : null;

  const result: SetupResult = {
    network: "testnet",
    dryRun: isDryRun,
    timestamp: new Date().toISOString(),
    root_account: ROOT_ACCOUNT,
    accounts_checked: 0,
    accounts_created: [],
    budgets_configured: [],
    vendors_attested: [],
    transactions: [],
  };

  // Collect all unique accounts to ensure
  const accountsToEnsure = new Set<string>();

  for (const comm of cast.communities) {
    accountsToEnsure.add(comm.dao_account);
    for (const mem of comm.members) {
      accountsToEnsure.add(mem.account);
    }
  }

  for (const ind of cast.individuals) {
    accountsToEnsure.add(ind.account);
  }

  for (const lp of cast.liquidity_providers) {
    accountsToEnsure.add(lp.account);
  }

  for (const actor of cast.bad_actors) {
    if (actor.account.endsWith(".wardline-labs.testnet")) {
      accountsToEnsure.add(actor.account);
    }
  }

  console.log(`\nPhase 2.1: Checking and ensuring ${accountsToEnsure.size} subaccounts...`);

  for (const acct of accountsToEnsure) {
    result.accounts_checked++;
    if (!acct.endsWith(`.${ROOT_ACCOUNT}`)) {
      continue; // External or non-subaccount
    }

    let existingKey = creds.get(acct);
    if (!existingKey) {
      const newKey = KeyPair.fromRandom("ed25519").toString();
      creds.set(acct, newKey);
      existingKey = newKey;
    }

    if (isDryRun) {
      console.log(`  [dry-run] account ${acct} ensured in credentials`);
      result.accounts_created.push(acct);
      continue;
    }

    const onChain = await viewAccount(provider, acct);
    if (!onChain) {
      console.log(`  Creating subaccount ${acct}...`);
      const publicKey = KeyPair.fromString(existingKey as KeyPairString).getPublicKey();
      try {
        const outcome = await rootSigner!.account.signAndSendTransaction({
          receiverId: acct,
          actions: [
            actions.createAccount(),
            actions.transfer(ACCOUNT_CREATION_NEAR),
            actions.addFullAccessKey(publicKey),
          ],
          waitUntil: "FINAL",
        });
        console.log(`  Created ${acct} tx: ${outcome.transaction.hash}`);
        result.accounts_created.push(acct);
        result.transactions.push({ action: "create_account", target: acct, tx: outcome.transaction.hash });
      } catch (err: any) {
        console.log(`  Could not create ${acct}: ${err.message}`);
      }
    } else {
      console.log(`  Account ${acct} already exists on testnet.`);
    }

    // Storage deposit on USDC and WARD pool
    try {
      const acctSigner = makeSigner(provider, acct, existingKey);
      for (const tokenContract of [USDC_CONTRACT, POOL_CONTRACT]) {
        try {
          await acctSigner.account.signAndSendTransaction({
            receiverId: tokenContract,
            actions: [
              actions.functionCall(
                "storage_deposit",
                { account_id: acct, registration_only: false },
                GAS,
                STORAGE_DEPOSIT_NEAR,
              ),
            ],
            waitUntil: "FINAL",
          });
        } catch {
          // Already registered
        }
      }
    } catch (e: any) {
      // Ignored if account not ready
    }
  }

  console.log(`\nPhase 2.2: Ensuring community budgets on meter...`);

  for (const comm of cast.communities) {
    const budgetId = comm.id;
    console.log(`  Configuring community budget ${budgetId} (${comm.name})...`);

    const membersInput = comm.members.map((m: any) => ({
      member: m.account,
      allowance: (BigInt(Math.round(parseFloat(m.allowance_usdc) * 1_000_000))).toString(),
    }));

    if (isDryRun) {
      console.log(`  [dry-run] budget ${budgetId} configured with ${membersInput.length} members`);
      result.budgets_configured.push(budgetId);
      continue;
    }

    let existingBudget: any = null;
    try {
      existingBudget = await viewCall(provider, METER_CONTRACT, "get_budget", { budget_id: budgetId });
    } catch {
      existingBudget = null;
    }

    if (!existingBudget) {
      try {
        const createTx = await rootSigner!.account.signAndSendTransaction({
          receiverId: METER_CONTRACT,
          actions: [
            actions.functionCall(
              "create_budget",
              {
                budget_id: budgetId,
                name: comm.name,
                owner: comm.dao_account,
                deposit: "0",
                period: comm.period || "week",
                members: membersInput,
              },
              GAS,
              0n,
            ),
          ],
          waitUntil: "FINAL",
        });
        console.log(`  Created budget ${budgetId} tx: ${createTx.transaction.hash}`);
        result.budgets_configured.push(budgetId);
        result.transactions.push({ action: "create_budget", target: budgetId, tx: createTx.transaction.hash });
      } catch (err: any) {
        console.log(`  create_budget ${budgetId} error: ${err.message}`);
      }
    } else {
      console.log(`  Budget ${budgetId} already exists on meter.`);
      result.budgets_configured.push(budgetId);
    }
  }

  console.log(`\nPhase 2.3: Ensuring individual builder budgets on meter...`);

  for (const ind of cast.individuals) {
    const budgetId = ind.budget;
    const allowanceAtomic = (BigInt(Math.round(parseFloat(ind.allowance_usdc) * 1_000_000))).toString();

    if (isDryRun) {
      console.log(`  [dry-run] individual budget ${budgetId} for ${ind.account}`);
      result.budgets_configured.push(budgetId);
      continue;
    }

    let existingBudget: any = null;
    try {
      existingBudget = await viewCall(provider, METER_CONTRACT, "get_budget", { budget_id: budgetId });
    } catch {
      existingBudget = null;
    }

    if (!existingBudget) {
      try {
        const createTx = await rootSigner!.account.signAndSendTransaction({
          receiverId: METER_CONTRACT,
          actions: [
            actions.functionCall(
              "create_budget",
              {
                budget_id: budgetId,
                name: `${ind.name} individual budget`,
                owner: ind.account,
                deposit: "0",
                period: "week",
                members: [{ member: ind.account, allowance: allowanceAtomic }],
              },
              GAS,
              0n,
            ),
          ],
          waitUntil: "FINAL",
        });
        console.log(`  Created individual budget ${budgetId} tx: ${createTx.transaction.hash}`);
        result.budgets_configured.push(budgetId);
        result.transactions.push({ action: "create_individual_budget", target: budgetId, tx: createTx.transaction.hash });
      } catch (err: any) {
        console.log(`  create_budget individual ${budgetId} error: ${err.message}`);
      }
    } else {
      result.budgets_configured.push(budgetId);
    }
  }

  console.log(`\nPhase 2.4: Attesting verified vendor northwind in payee registry...`);

  for (const vendor of cast.vendors) {
    if (isDryRun) {
      console.log(`  [dry-run] vendor ${vendor.name} (${vendor.domain}) attested`);
      result.vendors_attested.push(vendor.domain);
      continue;
    }

    let existingVendor: any = null;
    try {
      existingVendor = await viewCall(provider, PAYEE_REGISTRY_CONTRACT, "get_vendor", { domain: vendor.domain });
    } catch {
      existingVendor = null;
    }

    if (!existingVendor) {
      try {
        const attestInput = {
          domain: vendor.domain,
          name: vendor.name,
          accounts: [vendor.account],
          evidence_hash: sha256Digest(`${vendor.domain}:${vendor.account}`),
          issued_at: new Date().toISOString(),
          legal_name: `${vendor.name} Inc.`,
          evidence_tier: "T2",
        };

        const tx = await rootSigner!.account.signAndSendTransaction({
          receiverId: PAYEE_REGISTRY_CONTRACT,
          actions: [
            actions.functionCall(
              "attest_vendor",
              { input: attestInput },
              GAS,
              0n,
            ),
          ],
          waitUntil: "FINAL",
        });
        console.log(`  Attested vendor ${vendor.domain} tx: ${tx.transaction.hash}`);
        result.vendors_attested.push(vendor.domain);
        result.transactions.push({ action: "attest_vendor", target: vendor.domain, tx: tx.transaction.hash });
      } catch (err: any) {
        console.log(`  attest_vendor error: ${err.message}`);
      }
    } else {
      console.log(`  Vendor ${vendor.domain} already attested.`);
      result.vendors_attested.push(vendor.domain);
    }
  }

  mkdirSync(join(process.cwd(), "data/testnet"), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nSetup completed successfully. Summary saved to ${outputPath}`);

  return result;
}

if (process.argv[1]?.endsWith("setup.ts")) {
  runSetup().catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
}
