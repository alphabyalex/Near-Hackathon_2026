/**
 * A claim on testnet: the pool pays it (Wardline's first-loss stake first), and the meter records it
 * against the group, which drops one tier and restarts its clean streak. Both are owner calls, signed
 * by wardline-labs.testnet. Logged through ActivityWriter like every other row.
 *
 *   pnpm tsx scripts/testnet/claim.ts --budget bgt_aurora --amount 20000 --reason "..." [--dry-run]
 */
import { join } from "node:path";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir } from "../contracts/src/lib.js";
import { ActivityWriter, DRY_RUN, RPC_URL, sendCall } from "./chain-log.js";

const ROOT = "wardline-labs.testnet";
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const budget = arg("--budget");
const amount = arg("--amount");
const reason = arg("--reason");
if (!budget || !amount || !/^\d+$/.test(amount) || !reason) throw new Error('Usage: claim.ts --budget <id> --amount <atomic USDC> --reason "<why>"');

const usd = (a: string) => (Number(a) / 1e6).toFixed(2);
console.log(`Claim of ${usd(amount)} USDC against ${budget}: ${reason}`);
if (DRY_RUN) {
  console.log("Dry run: nothing sent, nothing written.");
  process.exit(0);
}

const root = makeSigner(makeProvider(RPC_URL), ROOT, new CredentialStore(join(defaultSecretsDir("testnet"), "credentials.json")).get(ROOT)!);
const writer = new ActivityWriter({ dryRun: false });

const filed = await sendCall(root, { contract_id: "pool.wardline-labs.testnet", method: "file_claim", args: { subject: `${budget}_${Date.now()}`, claimant: ROOT, amount, reason } });
const claim = filed.value as { status: string; paid_from_junior: string; paid_from_senior: string; ward_price_before: string; ward_price_after: string };
if (claim.status !== "paid") throw new Error(`the claim is ${claim.status}, not paid`);
const unchanged = claim.paid_from_senior === "0";
const row = await writer.record(filed.tx_hash, ROOT, { actor: ROOT, community: budget, kind: "payout", amount, model: null, outcome: "paid", side: "below", reason: null, text: `${budget}: a ${usd(amount)} USDC claim paid from Wardline's first-loss stake${unchanged ? "; WARD's price unchanged" : ""}` });
console.log(`  claim paid: ${usd(claim.paid_from_junior)} from our stake, ${usd(claim.paid_from_senior)} from WARD holders  https://testnet.nearblocks.io/txns/${row.tx}`);

const recorded = await sendCall(root, { contract_id: "meter.wardline-labs.testnet", method: "record_claim", args: { budget_id: budget } });
console.log(`  recorded against ${budget} (one tier down, clean streak restarts)  https://testnet.nearblocks.io/txns/${recorded.tx_hash}`);
