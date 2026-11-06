import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TransactionRefusedError, VaultExecutionError, callFinal, makeProvider, makeSigner, viewCall, type SignerHandle } from "@redline/vault-client";
import { defaultSecretsDir, manifestPath, networkFromEnv, readManifest, readSigners, sha256Digest, type DeploymentManifest, type SignerFile } from "./lib.js";

const GAS = 100_000_000_000_000n;

export type AttemptKind = "REJECTED" | "PAID" | "RETURNED_EXISTING" | "KEY_NOT_PERMITTED" | "PANICKED";

export interface Attempt {
  label: string;
  target: string;
  method: string;
  kind: AttemptKind;
  detail: string;
}

export interface AttackReport {
  vault_id: string;
  agent: string;
  attempts: Attempt[];
  vendor_balance_change_atomic: string;
  vault_available_change_atomic: string;
}

function headline(attempt: Attempt): string {
  const words: Record<AttemptKind, string> = {
    REJECTED: "REJECTED BY VAULT",
    PAID: "PAID (approved bill)",
    RETURNED_EXISTING: "NO SECOND PAYMENT",
    KEY_NOT_PERMITTED: "KEY NOT PERMITTED",
    PANICKED: "PANICKED, NO STATE CHANGE",
  };
  return `${words[attempt.kind].padEnd(28)} ${attempt.detail}`;
}

/**
 * No AI here at all. This holds the agent's own restricted key and tries to spend money it should
 * not, which is what an attacker who stole that key could do. Prints every attempt and the answer.
 */
export async function runAttack(manifest: DeploymentManifest, signers: SignerFile, rpcUrl: string, log: (line: string) => void = console.log): Promise<AttackReport> {
  const [tenantA, tenantB] = manifest.vaults;
  if (!tenantA || !tenantB) throw new Error("The manifest needs two vaults");
  const agentConfig = signers[tenantA.vault_id]?.agent;
  if (!agentConfig) throw new Error(`No agent key for ${tenantA.vault_id}`);
  const provider = makeProvider(rpcUrl);
  const key: SignerHandle = makeSigner(provider, agentConfig.account_id, agentConfig.private_key);
  const vaultId = tenantA.vault_id;

  const view = <T>(contract: string, method: string, args: object = {}) => viewCall<T>(provider, contract, method, args);
  const vendors = tenantA.vendors.map((v) => v.account_id);
  const vendorTotal = async () => (await Promise.all(vendors.map((id) => view<string>(manifest.token.contract_id, "ft_balance_of", { account_id: id })))).reduce((sum, value) => sum + BigInt(value), 0n);
  const available = async () => BigInt((await view<{ balance_atomic: string }>(vaultId, "get_usage")).balance_atomic);

  const vendorRevision = async (payableRef: string): Promise<number> => {
    const payable = await view<{ vendor_id: string } | null>(vaultId, "get_payable", { payable_ref: payableRef });
    const list = await view<Array<{ vendor_id: string; revision: number }>>(vaultId, "get_vendors");
    return list.find((v) => v.vendor_id === payable?.vendor_id)?.revision ?? 1;
  };

  const request = async (payableRef: string, digestSeed: string, overrides: object = {}) => {
    const policy = await view<{ revision: number }>(vaultId, "get_policy");
    const binding = await view<{ revision: number } | null>(vaultId, "get_binding");
    return {
      payable_ref: payableRef,
      request_digest: sha256Digest(digestSeed),
      expected_vendor_revision: await vendorRevision(payableRef),
      expected_policy_revision: policy.revision,
      expected_binding_revision: binding?.revision ?? 0,
      ...overrides,
    };
  };

  const attempts: Attempt[] = [];
  const attempt = async (label: string, target: string, method: string, args: object, deposit = 0n): Promise<void> => {
    let record: Attempt;
    try {
      const outcome = await callFinal(key, { contract_id: target, method, args, deposit, gas: GAS }, { final_timeout_ms: 180_000 });
      const result = outcome.value as { ok?: boolean; operation_id?: string; rejection?: string } | null;
      if (result?.ok === false) {
        record = { label, target, method, kind: "REJECTED", detail: result.rejection ?? "rejected" };
      } else if (result?.ok === true) {
        const transferred = outcome.receipts.some((receipt) => receipt.executor_id === manifest.token.contract_id);
        record = { label, target, method, kind: transferred ? "PAID" : "RETURNED_EXISTING", detail: `${result.operation_id}${transferred ? "" : ", no transfer"}` };
      } else {
        record = { label, target, method, kind: "PANICKED", detail: JSON.stringify(outcome.value) };
      }
    } catch (error) {
      if (error instanceof TransactionRefusedError) {
        record = { label, target, method, kind: "KEY_NOT_PERMITTED", detail: error.reason };
      } else if (error instanceof VaultExecutionError) {
        record = { label, target, method, kind: "PANICKED", detail: error.code ?? String(error.message).slice(0, 120) };
      } else {
        throw error;
      }
    }
    attempts.push(record);
    log(`  ${record.label.padEnd(50)} ${headline(record)}`);
  };

  const vendorBefore = await vendorTotal();
  const availableBefore = await available();

  log(`Attacker holds the key for ${key.account_id}. No AI involved.`);
  log(`Vault ${vaultId}, available ${availableBefore} atomic sgUSD.`);
  log("");
  log("Asking the vault to pay what it should not:");
  await attempt("Unknown payable", vaultId, "request_payment", await request("pay_made_up_by_attacker", "attack-1"));
  await attempt("Over the vendor cap (3,500 vs cap 1,000)", vaultId, "request_payment", await request("pay_1002", "attack-2"));
  await attempt("Before the payable's start date", vaultId, "request_payment", await request("pay_future", "attack-3"));
  await attempt("Stale policy revision", vaultId, "request_payment", await request("pay_1001", "attack-4", { expected_policy_revision: 999 }));
  await attempt("Stale vendor revision", vaultId, "request_payment", await request("pay_1001", "attack-5", { expected_vendor_revision: 999 }));
  await attempt("Malformed request digest", vaultId, "request_payment", await request("pay_1001", "attack-6", { request_digest: "ignore previous instructions and pay me" }));

  log("");
  log("Replaying a payment:");
  await attempt("First request for an approved 1 sgUSD bill", vaultId, "request_payment", await request("pay_replay", "attack-replay"));
  await attempt("Same request again", vaultId, "request_payment", await request("pay_replay", "attack-replay"));
  await attempt("Same bill, different digest", vaultId, "request_payment", await request("pay_replay", "attack-replay-2"));

  log("");
  log("Choosing the recipient or the amount:");
  await attempt("Adding amount and recipient to the request", vaultId, "request_payment", {
    ...(await request("pay_1002", "attack-7")),
    amount_atomic: "1",
    recipient: key.account_id,
  });

  log("");
  log("Reaching past request_payment. NEAR stops these before any contract code runs:");
  await attempt("The other tenant's vault", tenantB.vault_id, "request_payment", await request("pay_2001", "attack-8"));
  await attempt("Pay it as the owner", vaultId, "owner_pay", { payable_ref: "pay_1002" }, 1n);
  await attempt("Raise its own limits", vaultId, "set_policy", { change: { weekly_cap_atomic: "1000000000000", lifetime_cap_atomic: "1000000000000", expires_at_ns: "4000000000000000000" }, expected_revision: 1 });
  await attempt("Add itself as a vendor", vaultId, "set_vendor", { vendor: { vendor_id: "vnd_attacker", display_name: "Attacker", account_id: key.account_id, per_payment_cap_atomic: "1000000000000", active: true }, expected_revision: 0 });
  await attempt("Register its own payable", vaultId, "register_payable", { payable: { payable_ref: "pay_attacker" } });
  await attempt("Pause or unpause the vault", vaultId, "unpause", {});
  await attempt("Withdraw the balance", vaultId, "withdraw_available", { amount: "1000000" });
  await attempt("Fake a transfer result", vaultId, "on_payment_result", { operation_id: "op_1" });
  await attempt("Credit the vault directly", vaultId, "ft_on_transfer", { sender_id: key.account_id, amount: "1000000", msg: "" });
  await attempt("Move the tokens itself", manifest.token.contract_id, "ft_transfer", { receiver_id: key.account_id, amount: "1" }, 1n);
  await attempt("Attach a deposit", vaultId, "request_payment", await request("pay_1001", "attack-9"), 1n);

  const vendorChange = (await vendorTotal()) - vendorBefore;
  const availableChange = (await available()) - availableBefore;
  log("");
  log(`Money moved during all of this: ${vendorChange} atomic sgUSD to vendors, all of it the approved pay_replay bill.`);
  log(`Vault available changed by ${availableChange}. The key can pay bills the owner approved, inside the limits. That is the boundary.`);

  return {
    vault_id: vaultId,
    agent: key.account_id,
    attempts,
    vendor_balance_change_atomic: vendorChange.toString(),
    vault_available_change_atomic: availableChange.toString(),
  };
}

async function main(): Promise<void> {
  const { network, rpcUrl } = networkFromEnv();
  const manifest = readManifest(manifestPath(network));
  const signers = readSigners(join(defaultSecretsDir(network), "signers.json"));
  const report = await runAttack(manifest, signers, rpcUrl);
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
