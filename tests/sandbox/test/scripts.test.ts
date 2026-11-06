import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } from "near-sandbox";
import { Chain } from "../src/harness.js";
import { deployAndSeed } from "../../../scripts/contracts/src/deploy-and-seed.js";
import { inspectKeys } from "../../../scripts/contracts/src/inspect-keys.js";
import { runAttack, type AttackReport } from "../../../scripts/contracts/src/malicious-signer.js";
import type { DeploymentManifest, SignerFile } from "../../../scripts/contracts/src/lib.js";

/** The same deploy, attack and key-inspection scripts used on testnet, run against a sandbox. */
describe("deploy, attack and inspect scripts", () => {
  let chain: Chain;
  let dir: string;
  let manifest: DeploymentManifest;
  let signers: SignerFile;
  let report: AttackReport;
  const logs: string[] = [];

  beforeAll(async () => {
    chain = await Chain.start();
    dir = mkdtempSync(join(tmpdir(), "redline-scripts-"));
    manifest = await deployAndSeed({
      network: "sandbox",
      rpcUrl: chain.sandbox.rpcUrl,
      root: DEFAULT_ACCOUNT_ID,
      rootKey: DEFAULT_PRIVATE_KEY,
      secretsDir: dir,
      manifestFile: join(dir, "manifest.json"),
      manifestDigest: `sha256:${"d".repeat(64)}`,
      assessmentRef: "run_test",
      log: (line) => logs.push(line),
    });
    signers = JSON.parse(readFileSync(join(dir, "signers.json"), "utf8")) as SignerFile;
    report = await runAttack(manifest, signers, chain.sandbox.rpcUrl, (line) => logs.push(line));
  }, 600_000);

  afterAll(async () => {
    await chain?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
    console.log(logs.join("\n"));
  });

  const kindOf = (label: string) => report.attempts.find((attempt) => attempt.label.startsWith(label));

  it("the manifest records two vaults, code hashes and key permissions, and no private keys", () => {
    expect(manifest.vaults).toHaveLength(2);
    expect(manifest.vaults[0]?.code_hash).toBe(manifest.vaults[1]?.code_hash);
    expect(manifest.token).toMatchObject({ name: "Redline Test Dollar", symbol: "REDL", decimals: 6 });
    expect(manifest.vaults[0]?.vendors.map((v) => v.per_payment_cap_atomic)).toEqual(["5000000000", "2000000000", "1000000000"]);
    const text = readFileSync(join(dir, "manifest.json"), "utf8");
    expect(text).not.toContain(DEFAULT_PRIVATE_KEY);
    for (const entry of Object.values(signers)) {
      if (entry.agent) expect(text).not.toContain(entry.agent.private_key);
      if (entry.owner) expect(text).not.toContain(entry.owner.private_key);
    }
  });

  it("key files are private to the user", () => {
    expect(statSync(join(dir, "signers.json")).mode & 0o077).toBe(0);
    expect(statSync(join(dir, "credentials.json")).mode & 0o077).toBe(0);
  });

  it("inspect-keys proves no hidden full-access key", async () => {
    const findings = await inspectKeys(manifest, chain.sandbox.rpcUrl, (line) => logs.push(line));
    expect(findings.filter((finding) => !finding.ok)).toEqual([]);
    const agent = findings.find((finding) => finding.role === "Business A agent");
    expect(agent?.keys).toHaveLength(1);
    expect(agent?.keys[0]?.permission).toContain("only request_payment on");
    expect(findings.find((finding) => finding.role === "Business A vault")?.keys).toEqual([]);
  });

  it("inspect-keys notices a full-access key on an agent", async () => {
    const tampered = structuredClone(manifest);
    const vault = tampered.vaults[0];
    if (!vault) throw new Error("no vault");
    // The owner account does hold a full-access key, so point the check at it.
    vault.agent.account_id = vault.owner;
    const findings = await inspectKeys(tampered, chain.sandbox.rpcUrl, () => undefined);
    expect(findings.find((finding) => finding.role === "Business A agent")?.ok).toBe(false);
  });

  it("the attack: every rule failure comes back with its exact code", () => {
    expect(kindOf("Unknown payable")).toMatchObject({ kind: "REJECTED", detail: "UNKNOWN_PAYABLE" });
    expect(kindOf("Over the vendor cap")).toMatchObject({ kind: "REJECTED", detail: "OVER_VENDOR_CAP" });
    expect(kindOf("Before the payable's start date")).toMatchObject({ kind: "REJECTED", detail: "NOT_YET_PAYABLE" });
    expect(kindOf("Stale policy revision")).toMatchObject({ kind: "REJECTED", detail: "STALE_REVISION" });
    expect(kindOf("Stale vendor revision")).toMatchObject({ kind: "REJECTED", detail: "STALE_REVISION" });
    expect(kindOf("Malformed request digest")).toMatchObject({ kind: "REJECTED", detail: "BAD_CALLER" });
    expect(kindOf("Adding amount and recipient")).toMatchObject({ kind: "REJECTED", detail: "OVER_VENDOR_CAP" });
  });

  it("the attack: a replay pays once", () => {
    expect(kindOf("First request for an approved")?.kind).toBe("PAID");
    expect(kindOf("Same request again")?.kind).toBe("RETURNED_EXISTING");
    expect(kindOf("Same bill, different digest")).toMatchObject({ kind: "REJECTED", detail: "ALREADY_PAID" });
  });

  it("the attack: NEAR refuses everything past request_payment, including the other tenant", () => {
    expect(kindOf("The other tenant's vault")).toMatchObject({ kind: "KEY_NOT_PERMITTED", detail: "ReceiverMismatch" });
    expect(kindOf("Move the tokens itself")?.kind).toBe("KEY_NOT_PERMITTED");
    for (const label of ["Raise its own limits", "Add itself as a vendor", "Register its own payable", "Pause or unpause", "Withdraw the balance", "Fake a transfer result", "Credit the vault directly"]) {
      expect(kindOf(label)).toMatchObject({ kind: "KEY_NOT_PERMITTED", detail: "MethodNameMismatch" });
    }
    expect(kindOf("Attach a deposit")?.kind).toBe("KEY_NOT_PERMITTED");
    expect(kindOf("Pay it as the owner")?.kind).toBe("KEY_NOT_PERMITTED");
  });

  it("the attack moved only the approved 1 REDL bill", () => {
    expect(report.vendor_balance_change_atomic).toBe("1000000");
    expect(report.vault_available_change_atomic).toBe("-1000000");
    expect(report.attempts.filter((attempt) => attempt.kind === "PAID")).toHaveLength(1);
  });

  it("the deploy is safe to rerun: it changes nothing that exists", async () => {
    const again = await deployAndSeed({
      network: "sandbox",
      rpcUrl: chain.sandbox.rpcUrl,
      root: DEFAULT_ACCOUNT_ID,
      secretsDir: dir,
      manifestFile: join(dir, "manifest.json"),
      manifestDigest: `sha256:${"d".repeat(64)}`,
      assessmentRef: "run_test",
      log: () => undefined,
    });
    expect(again.vaults[0]?.code_hash).toBe(manifest.vaults[0]?.code_hash);
    // The manifest reports what the chain holds, not what this later run computed.
    expect(again.vaults[0]?.policy).toEqual(manifest.vaults[0]?.policy);
    expect(again.vaults[0]?.payables).toEqual(manifest.vaults[0]?.payables);
  }, 300_000);
});
