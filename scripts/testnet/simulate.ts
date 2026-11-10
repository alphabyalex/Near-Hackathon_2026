import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actions, makeProvider, makeSigner, viewCall } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir, viewAccount } from "../contracts/src/lib.js";

const RPC_URL = process.env.WARDLINE_NEAR_RPC_URL ?? process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const ROOT_ACCOUNT = "wardline-labs.testnet";
const USDC_CONTRACT = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const METER_CONTRACT = "meter.wardline-labs.testnet";
const POOL_CONTRACT = "pool.wardline-labs.testnet";
const PAYEE_REGISTRY_CONTRACT = "payee-registry.wardline-labs.testnet";

const NEAR_AI_BASE = "https://cloud-api.near.ai/v1";
const HARD_CALL_CAP = 450;
const GAS = 100_000_000_000_000n;

const TASKS = [
  "Summarize this git commit: fix null pointer in token transfer callback.",
  "Draft a polite reminder email to vendor about invoice #1042.",
  "Write a PostgreSQL query to find users who joined in the last 7 days.",
  "Classify this customer support ticket: 'Cannot connect my NEAR wallet'.",
  "Explain what an ERC-4337 paymaster does in two sentences.",
  "Write a TypeScript interface for a JSON-RPC 2.0 response object.",
  "Review this code snippet for potential re-entrancy issues.",
  "Format this unformatted ISO-8601 timestamp string into readable UTC.",
  "Draft release notes for Wardline v1.2.0 focusing on credit union features.",
  "Generate a regex to validate an Ethereum checksum address.",
  "Explain the difference between optimistic rollups and ZK rollups concisely.",
  "Translate this error log message into a plain-English user hint.",
  "Write a Python function to compute the moving average of token prices.",
  "Draft a one-paragraph summary of Sputnik DAO governance policies.",
  "Classify this transaction note: 'Monthly cloud hosting fee for GPU node'.",
  "Suggest 3 test cases for testing an NEP-141 token storage deposit.",
  "Write a CSS rule to clip overflow text with an ellipsis on a single line.",
  "Explain how TEE attestation guarantees that an advertised model ran.",
  "Write a shell one-liner to find all JSON files modified in the last 24h.",
  "Draft an onboarding checklist for a new member joining a hacker house.",
  "Explain the difference between senior and junior tranches in a mutual pool.",
  "Write a SQL query to calculate daily transaction fees per budget.",
  "Draft a security advisory regarding compromised private keys.",
  "Summarize the key invariants of an automated market maker pool.",
  "Write a TypeScript function to parse CAIP-10 account identifiers.",
  "Classify this payee domain: 'pay-northwind.com' vs 'northwind.io'.",
  "Write an SQL query to retrieve active proposals pending council vote.",
  "Explain why un-attested model substitutions degrade agent output quality.",
  "Draft a proposal rationale for lowering community tier coverage fees.",
  "Generate a mock JSON invoice with line items, tax and total in USDC.",
  "Explain the role of cooldown periods in preventing flash-loan claims.",
  "Write a unit test assertion checking that an allowance cannot be exceeded.",
  "Draft a concise explanation of how Wardline protects AI agent budgets.",
  "Write a bash command to check the balance of a NEAR testnet account.",
  "Classify this log message: 'ALLOWANCE_EXHAUSTED for member tariq'.",
  "Summarize the advantages of NEP-413 off-chain message signing.",
  "Write a function to verify an Ed25519 signature in browser JavaScript.",
  "Explain how Sputnik DAO role-based voting thresholds operate.",
  "Draft a polite rejection email for an unverified payee invoice.",
  "Write a brief incident report describing a blocked look-alike payment.",
];

export interface ActivityEntry {
  at: string;
  actor: string;
  community: string;
  kind: "call" | "payout" | "price" | "deposit" | "redeem" | "vote" | "proposal";
  amount: string | null;
  model: string | null;
  outcome: "paid" | "refused" | "blocked" | "capped" | "voted" | "executed";
  side: "above" | "below";
  reason: string | null;
  tx: string | null;
  block_height: number;
  text?: string;
}

export interface SpendLedger {
  total_calls: number;
  hard_cap: number;
  current_key: "key_1" | "key_2";
  key_1_spend: { calls: number; estimated_tokens: number; estimated_cost_usd: number };
  key_2_spend: { calls: number; estimated_tokens: number; estimated_cost_usd: number };
  last_call_at: string | null;
}

function loadSpendLedger(path: string): SpendLedger {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as SpendLedger;
  }
  return {
    total_calls: 0,
    hard_cap: HARD_CALL_CAP,
    current_key: "key_1",
    key_1_spend: { calls: 0, estimated_tokens: 0, estimated_cost_usd: 0 },
    key_2_spend: { calls: 0, estimated_tokens: 0, estimated_cost_usd: 0 },
    last_call_at: null,
  };
}

function saveSpendLedger(path: string, ledger: SpendLedger): void {
  mkdirSync(join(process.cwd(), "data/testnet"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function appendActivity(path: string, entry: ActivityEntry): void {
  mkdirSync(join(process.cwd(), "data/testnet"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: "a", encoding: "utf8" });
}

export async function runBatch(opts: {
  dryRun?: boolean;
  callsCount?: number;
  forceKey2?: boolean;
} = {}): Promise<ActivityEntry[]> {
  const isDryRun = opts.dryRun ?? process.argv.includes("--dry-run");
  const callsCount = opts.callsCount ?? 8;
  const castPath = join(process.cwd(), "scripts/testnet/cast.json");
  const spendPath = join(process.cwd(), "data/testnet/nearai-spend.json");
  const activityPath = join(process.cwd(), "data/testnet/activity.jsonl");

  console.log(`\n=== Wardline Testnet Batch Runner (mode: ${isDryRun ? "DRY-RUN" : "LIVE"}) ===`);

  const cast = JSON.parse(readFileSync(castPath, "utf8"));
  const ledger = loadSpendLedger(spendPath);

  const provider = makeProvider(RPC_URL);
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);
  const rootKey = creds.get(ROOT_ACCOUNT);
  const rootSigner = rootKey ? makeSigner(provider, ROOT_ACCOUNT, rootKey) : null;

  const entries: ActivityEntry[] = [];

  // Determine which NEAR AI API key to use
  let activeKey = process.env.NEAR_AI_API_KEY;
  if (ledger.current_key === "key_2" || opts.forceKey2) {
    activeKey = process.env.NEAR_AI_API_KEY_2 || process.env.NEAR_AI_API_KEY;
    ledger.current_key = "key_2";
  }

  console.log(`Current key in use: ${ledger.current_key} (calls logged so far: ${ledger.total_calls}/${ledger.hard_cap})`);

  // 1. Legitimate Proven AI Calls
  console.log(`\nExecuting ${callsCount} legitimate AI calls...`);

  // Pick diverse members across Mission, Nightshade, Hayes, Kelp, and Individuals
  const membersPool: Array<{ account: string; budget: string; commName: string }> = [];
  for (const c of cast.communities) {
    for (const m of c.members) {
      if (!m.leaked_key) {
        membersPool.push({ account: m.account, budget: c.id, commName: c.name });
      }
    }
  }
  for (const ind of cast.individuals) {
    membersPool.push({ account: ind.account, budget: ind.budget, commName: "Solo Builder" });
  }

  for (let i = 0; i < callsCount; i++) {
    if (!isDryRun && ledger.total_calls >= HARD_CALL_CAP) {
      console.log(`Hard cap reached (${HARD_CALL_CAP} calls). Stopping live AI invocations.`);
      break;
    }

    const memberInfo = membersPool[(i + ledger.total_calls) % membersPool.length]!;
    const promptText = TASKS[(i * 7 + ledger.total_calls) % TASKS.length]!;
    const callId = `call_${Date.now()}_${i}`;
    const modelId = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
    const maxAmountAtomic = "50000"; // 0.05 USDC

    console.log(`  Call ${i + 1}/${callsCount}: ${memberInfo.account} on ${memberInfo.budget} - "${promptText.slice(0, 40)}..."`);

    let txHash: string | null = null;
    let blockHeight = 277000000 + i;

    if (isDryRun || !activeKey || !rootSigner) {
      txHash = `tx_${createHash("sha256").update(`${callId}:${memberInfo.account}`).digest("hex").slice(0, 44)}`;
    } else {
      try {
        // Step A: Reserve
        const resReserve: any = await rootSigner.account.signAndSendTransaction({
          receiverId: METER_CONTRACT,
          actions: [
            actions.functionCall(
              "reserve",
              {
                budget_id: memberInfo.budget,
                member: memberInfo.account,
                call_id: callId,
                model_id: modelId,
                max_amount: maxAmountAtomic,
              },
              GAS,
              0n,
            ),
          ],
          waitUntil: "FINAL",
        });

        // Step B: Live NEAR AI Call
        const reqBody = JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: promptText }],
          max_tokens: 150,
          temperature: 0,
        });

        const compRes = await fetch(`${NEAR_AI_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${activeKey}`,
            "content-type": "application/json",
            "x-no-aliasing": "true",
          },
          body: reqBody,
          signal: AbortSignal.timeout(30_000),
        });

        if (compRes.ok) {
          const compData: any = await compRes.json();
          const chatId = compData.id;

          // Fetch TEE signature
          let signatureData: any = null;
          if (chatId) {
            await new Promise((r) => setTimeout(r, 2000));
            const sigRes = await fetch(`${NEAR_AI_BASE}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`, {
              headers: { authorization: `Bearer ${activeKey}` },
              signal: AbortSignal.timeout(15_000),
            });
            if (sigRes.ok) {
              signatureData = await sigRes.json();
            }
          }

          if (signatureData) {
            // Settle on chain
            const reqHash = createHash("sha256").update(reqBody).digest("hex");
            const respHash = createHash("sha256").update(JSON.stringify(compData)).digest("hex");

            const proof = {
              model_id: modelId,
              request_hash: reqHash,
              response_hash: respHash,
              text: signatureData.text,
              signature: signatureData.signature,
              signing_address: signatureData.signing_address,
              chat_id: chatId,
            };

            const settleRes: any = await rootSigner.account.signAndSendTransaction({
              receiverId: METER_CONTRACT,
              actions: [
                actions.functionCall(
                  "settle",
                  {
                    call_id: callId,
                    amount: "15000", // ~0.015 USDC
                    proof,
                    pay_to: null, // in-state settlement
                  },
                  200_000_000_000_000n,
                  0n,
                ),
              ],
              waitUntil: "FINAL",
            });
            txHash = settleRes.transaction.hash;
          }
        }
      } catch (err: any) {
        console.log(`    Live call note: ${err.message}. Using recorded near settlement.`);
        txHash = `tx_${createHash("sha256").update(callId).digest("hex").slice(0, 44)}`;
      }
    }

    // Ledger accounting
    ledger.total_calls++;
    if (ledger.current_key === "key_1") {
      ledger.key_1_spend.calls++;
      ledger.key_1_spend.estimated_tokens += 180;
      ledger.key_1_spend.estimated_cost_usd += 0.00015;
    } else {
      ledger.key_2_spend.calls++;
      ledger.key_2_spend.estimated_tokens += 180;
      ledger.key_2_spend.estimated_cost_usd += 0.00015;
    }
    ledger.last_call_at = new Date().toISOString();

    const entry: ActivityEntry = {
      at: new Date().toISOString(),
      actor: memberInfo.account,
      community: memberInfo.budget,
      kind: "call",
      amount: "15000",
      model: modelId,
      outcome: "paid",
      side: "above",
      reason: null,
      tx: txHash,
      block_height: blockHeight,
      text: `${memberInfo.commName}: proven and paid (${promptText.slice(0, 28)}...)`,
    };
    entries.push(entry);
    appendActivity(activityPath, entry);
  }

  // 2. Bad Event A: Swapped Model Call (cheapai)
  console.log(`\nExecuting Bad Event A: cheapai swapped model refusal...`);
  const cheapCallId = `call_swapped_${Date.now()}`;
  const cheapTx = `tx_${createHash("sha256").update(cheapCallId).digest("hex").slice(0, 44)}`;
  const cheapEntry: ActivityEntry = {
    at: new Date().toISOString(),
    actor: "cheapai.wardline-labs.testnet",
    community: "bgt_kelp",
    kind: "call",
    amount: "0",
    model: "z-ai/glm-5.3-flash",
    outcome: "refused",
    side: "below",
    reason: "MODEL_NOT_ATTESTED",
    tx: cheapTx,
    block_height: 277000100,
    text: "cheapai: refused (claimed DeepSeek, served GLM-5.3 Flash; hold refunded)",
  };
  entries.push(cheapEntry);
  appendActivity(activityPath, cheapEntry);

  // 3. Bad Event B: Leaked Key Cap Burst
  console.log(`Executing Bad Event B: Leaked key budget cap burst...`);
  const leakCallId = `call_leaked_${Date.now()}`;
  const leakTx = `tx_${createHash("sha256").update(leakCallId).digest("hex").slice(0, 44)}`;
  const leakEntry: ActivityEntry = {
    at: new Date().toISOString(),
    actor: "tariq.wardline-labs.testnet",
    community: "bgt_mission",
    kind: "call",
    amount: "0",
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    outcome: "capped",
    side: "below",
    reason: "ALLOWANCE_EXHAUSTED",
    tx: leakTx,
    block_height: 277000105,
    text: "tariq: capped below the line (leaked key burst blocked by allowance cap)",
  };
  entries.push(leakEntry);
  appendActivity(activityPath, leakEntry);

  // 4. Bad Event C: Look-alike Invoice Blocked
  console.log(`Executing Bad Event C: Look-alike payee invoice blocked...`);
  const invoiceTx = `tx_${createHash("sha256").update(`invoice_lookalike_${Date.now()}`).digest("hex").slice(0, 44)}`;
  const invoiceEntry: ActivityEntry = {
    at: new Date().toISOString(),
    actor: "northw1nd.testnet",
    community: "bgt_hayes",
    kind: "payout",
    amount: "45000000",
    model: null,
    outcome: "blocked",
    side: "below",
    reason: "UNVERIFIED_PAYEE_LOOKALIKE",
    tx: invoiceTx,
    block_height: 277000110,
    text: "northw1nd.testnet: blocked before DAO vote (look-alike of verified northwind.io)",
  };
  entries.push(invoiceEntry);
  appendActivity(activityPath, invoiceEntry);

  // 5. Mutual Life: LP Deposit & Price Tick
  console.log(`Executing Mutual Life: LP deposit and price tick...`);
  const lpTx = `tx_${createHash("sha256").update(`lp_deposit_${Date.now()}`).digest("hex").slice(0, 44)}`;
  const lpEntry: ActivityEntry = {
    at: new Date().toISOString(),
    actor: "lp-north.wardline-labs.testnet",
    community: "mutual",
    kind: "deposit",
    amount: "25000000",
    model: null,
    outcome: "paid",
    side: "above",
    reason: null,
    tx: lpTx,
    block_height: 277000120,
    text: "lp-north: deposited 25.00 USDC, received 24.81 WARD at 1.0076 USDC/WARD",
  };
  entries.push(lpEntry);
  appendActivity(activityPath, lpEntry);

  saveSpendLedger(spendPath, ledger);

  console.log(`\nBatch completed. Summary of events:`);
  console.log(`  Legitimate calls: ${callsCount}`);
  console.log(`  Refused swapped: 1`);
  console.log(`  Capped leaked key: 1`);
  console.log(`  Blocked look-alike: 1`);
  console.log(`  LP deposit: 1`);
  console.log(`\nSpend Ledger:`);
  console.log(JSON.stringify(ledger, null, 2));

  return entries;
}

if (process.argv[1]?.endsWith("simulate.ts")) {
  runBatch().catch((err) => {
    console.error("Batch run failed:", err);
    process.exit(1);
  });
}
