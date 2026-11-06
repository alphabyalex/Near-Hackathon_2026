import { pathToFileURL } from "node:url";
import { makeProvider } from "@redline/vault-client";
import { listKeys, manifestPath, networkFromEnv, readManifest, type AccessKeyInfo, type DeploymentManifest } from "./lib.js";

export interface KeyFinding {
  account: string;
  role: string;
  expected: string;
  keys: Array<{ public_key: string; permission: string }>;
  ok: boolean;
}

function describe(key: AccessKeyInfo): string {
  const permission = key.access_key.permission;
  if (permission === "FullAccess") return "FULL ACCESS";
  const { receiver_id, method_names, allowance } = permission.FunctionCall;
  return `only ${method_names.join(",") || "(any method)"} on ${receiver_id}, gas allowance ${allowance ?? "unlimited"} yocto`;
}

function restrictedTo(keys: AccessKeyInfo[], receiver: string, method: string): boolean {
  return (
    keys.length === 1 &&
    keys.every((key) => {
      const permission = key.access_key.permission;
      return permission !== "FullAccess" && permission.FunctionCall.receiver_id === receiver && permission.FunctionCall.method_names.length === 1 && permission.FunctionCall.method_names[0] === method;
    })
  );
}

/** Reads keys from the chain, not from the manifest, and checks them against what they must be. */
export async function inspectKeys(manifest: DeploymentManifest, rpcUrl: string, log: (line: string) => void = console.log): Promise<KeyFinding[]> {
  const provider = makeProvider(rpcUrl);
  const findings: KeyFinding[] = [];

  const check = async (account: string, role: string, expected: string, isOk: (keys: AccessKeyInfo[]) => boolean): Promise<void> => {
    const keys = await listKeys(provider, account);
    const finding: KeyFinding = {
      account,
      role,
      expected,
      keys: keys.map((key) => ({ public_key: key.public_key, permission: describe(key) })),
      ok: isOk(keys),
    };
    findings.push(finding);
    log(`${finding.ok ? "OK      " : "PROBLEM "} ${role.padEnd(22)} ${account}`);
    log(`         must be: ${expected}`);
    if (keys.length === 0) log("         keys:    none");
    for (const key of finding.keys) log(`         key:     ${key.public_key}  ${key.permission}`);
  };

  log(`Network ${manifest.network}. Live key lists from ${rpcUrl}.\n`);
  for (const vault of manifest.vaults) {
    await check(vault.agent.account_id, `${vault.business} agent`, `exactly one key, only request_payment on ${vault.vault_id}, no full access`, (keys) => restrictedTo(keys, vault.vault_id, "request_payment"));
    await check(vault.vault_id, `${vault.business} vault`, "no keys, so only the contract code can act", (keys) => keys.length === 0);
    if (vault.guardian) {
      await check(vault.guardian, `${vault.business} guardian`, `exactly one key, only pause on ${vault.vault_id}`, (keys) => restrictedTo(keys, vault.vault_id, "pause"));
    }
  }
  await check(manifest.token.contract_id, "Token", "no keys, so only the contract code can act", (keys) => keys.length === 0);
  await check(manifest.evidence.contract_id, "Evidence registry", "no keys, so only the contract code can act", (keys) => keys.length === 0);

  const problems = findings.filter((finding) => !finding.ok);
  log("");
  log(problems.length === 0 ? "No hidden full-access key on any agent, vault, guardian or contract account." : `${problems.length} account(s) do not match.`);
  return findings;
}

async function main(): Promise<void> {
  const { network, rpcUrl } = networkFromEnv();
  const findings = await inspectKeys(readManifest(manifestPath(network)), rpcUrl);
  if (findings.some((finding) => !finding.ok)) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
