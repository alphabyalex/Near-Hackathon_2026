import { readFile } from "node:fs/promises";
import {
  accountFromSecret,
  call,
  json,
  requireTestnet,
  requiredEnv,
  resolveFromRoot,
  type DeploymentManifest,
} from "./common.js";

interface RequestResult {
  readonly accepted: boolean;
  readonly existing: boolean;
  readonly operation_id?: string;
  readonly status?: string;
  readonly rejection?: {
    readonly code: string;
  };
}

async function attempt(
  label: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await action();
    console.log(`${label}: RESULT ${json(result)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${label}: TRANSACTION_REJECTED ${message}`);
  }
}

async function request(
  agent: ReturnType<typeof accountFromSecret>,
  vaultId: string,
  payableRef: string,
  digest: string,
): Promise<RequestResult> {
  return call<RequestResult>(agent, vaultId, "request_payment", {
    request: {
      payable_ref: payableRef,
      request_digest: digest,
      expected_policy_revision: 1,
      expected_vendor_revision: 1,
      expected_binding_revision: 1,
    },
  });
}

async function main(): Promise<void> {
  requireTestnet();
  const manifestPath = process.env.SPENDGYM_DEPLOYMENT_MANIFEST
    ?? resolveFromRoot("scripts/contracts/deployments/testnet.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as DeploymentManifest;
  if (manifest.network !== "testnet") {
    throw new Error(`manifest network must be testnet, received ${manifest.network}`);
  }

  const agent = accountFromSecret(
    manifest.accounts.agent_a,
    requiredEnv("SPENDGYM_AGENT_A_PRIVATE_KEY"),
  );
  const replayDigest = `sha256:malicious-replay-${Date.now()}`;

  await attempt("unknown payable", () =>
    request(agent, manifest.accounts.vault_a, "A-UNKNOWN-999", "sha256:unknown"));
  await attempt("over vendor cap", () =>
    request(agent, manifest.accounts.vault_a, "A-OVER-CAP-001", "sha256:over-cap"));
  await attempt("early payable", () =>
    request(agent, manifest.accounts.vault_a, "A-EARLY-001", "sha256:early"));
  await attempt("legitimate routine payable", () =>
    request(agent, manifest.accounts.vault_a, "A-ROUTINE-001", replayDigest));
  await attempt("same-digest replay", () =>
    request(agent, manifest.accounts.vault_a, "A-ROUTINE-001", replayDigest));
  await attempt("conflicting replay", () =>
    request(agent, manifest.accounts.vault_a, "A-ROUTINE-001", "sha256:conflicting-replay"));

  await attempt("other tenant vault", () =>
    request(agent, manifest.accounts.vault_b, "B-ROUTINE-001", "sha256:cross-tenant"));
  await attempt("owner pause method", () =>
    call(agent, manifest.accounts.vault_a, "pause", {}));
  await attempt("owner policy method", () =>
    call(agent, manifest.accounts.vault_a, "set_policy", {
      change: {
        weekly_cap_atomic: "999999999",
        lifetime_ceiling_atomic: "999999999",
      },
      expected_revision: 1,
    }));
  await attempt("owner direct-pay method", () =>
    call(agent, manifest.accounts.vault_a, "owner_pay", {
      payable_ref: "A-OVER-CAP-001",
    }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
