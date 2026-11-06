import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { viewCall, type SignerHandle, type VaultNetwork, type VaultSigners } from "@redline/vault-client";
import {
  CredentialStore,
  Deployer,
  KeyPair,
  MILLINEAR,
  NEAR,
  NS_PER_DAY,
  NS_PER_HOUR,
  SGUSD,
  createFromFaucet,
  defaultSecretsDir,
  listKeys,
  manifestPath,
  networkFromEnv,
  readWasm,
  sha256Digest,
  sha256Hex,
  viewAccount,
  type DeploymentManifest,
  type KeyPermissionRecord,
  type SignerFile,
  type VaultDeployment,
} from "./lib.js";

const ONE_YOCTO = 1n;
const STORAGE_DEPOSIT = 13n * (MILLINEAR / 10n); // 0.0013 NEAR: registration_only refunds the excess.
const AGENT_KEY_ALLOWANCE = 500n * MILLINEAR; // Gas budget of the restricted key.
const AGENT_BALANCE = 600n * MILLINEAR;

interface VendorSeed {
  vendor_id: string;
  display_name: string;
  name: string;
  cap: bigint;
}

interface PayableSeed {
  ref: string;
  vendor_id: string;
  whole: bigint;
  /** Relative to deploy time. */
  due: bigint;
  /** Not payable until this far from deploy time. Negative means already payable. */
  not_before?: bigint;
}

interface BusinessSeed {
  business: string;
  vault: string;
  owner: string;
  agent: string;
  guardian?: string;
  weekly: bigint;
  lifetime: bigint;
  funded: bigint;
  vendors: VendorSeed[];
  payables: PayableSeed[];
}

/** All synthetic. Vendors have different caps, because vendors charge very different amounts. */
const BUSINESSES: BusinessSeed[] = [
  {
    business: "Business A",
    vault: "vault-a",
    owner: "owner-a",
    agent: "agent.vault-a",
    guardian: "guardian-a",
    weekly: 20_000n * SGUSD,
    lifetime: 100_000n * SGUSD,
    funded: 50_000n * SGUSD,
    vendors: [
      { vendor_id: "vnd_larkspur", display_name: "Larkspur Office Supply", name: "larkspur", cap: 5_000n * SGUSD },
      { vendor_id: "vnd_fernhill", display_name: "Fernhill Cloud Hosting", name: "fernhill", cap: 2_000n * SGUSD },
      { vendor_id: "vnd_quarry", display_name: "Quarry Lane Legal", name: "quarry", cap: 1_000n * SGUSD },
    ],
    payables: [
      { ref: "pay_1001", vendor_id: "vnd_larkspur", whole: 1_250n, due: 14n * NS_PER_DAY },
      // Over Quarry's cap on purpose: the agent cannot pay this, and it goes to the owner.
      { ref: "pay_1002", vendor_id: "vnd_quarry", whole: 3_500n, due: 30n * NS_PER_HOUR },
      { ref: "pay_1003", vendor_id: "vnd_fernhill", whole: 800n, due: 10n * NS_PER_DAY },
      { ref: "pay_1005", vendor_id: "vnd_larkspur", whole: 400n, due: 6n * NS_PER_DAY },
      { ref: "pay_1006", vendor_id: "vnd_fernhill", whole: 600n, due: 8n * NS_PER_DAY },
      { ref: "pay_1007", vendor_id: "vnd_larkspur", whole: 2_400n, due: 5n * NS_PER_DAY },
      // For malicious-signer. Not payable for 30 days.
      { ref: "pay_future", vendor_id: "vnd_larkspur", whole: 100n, due: 40n * NS_PER_DAY, not_before: 30n * NS_PER_DAY },
      // For malicious-signer's replay. A real, approved 1 sgUSD bill: the key can pay what is approved.
      { ref: "pay_replay", vendor_id: "vnd_larkspur", whole: 1n, due: 20n * NS_PER_DAY },
    ],
  },
  {
    business: "Business B",
    vault: "vault-b",
    owner: "owner-b",
    agent: "agent.vault-b",
    weekly: 5_000n * SGUSD,
    lifetime: 50_000n * SGUSD,
    funded: 10_000n * SGUSD,
    vendors: [{ vendor_id: "vnd_aldergate", display_name: "Aldergate Couriers", name: "aldergate", cap: 500n * SGUSD }],
    payables: [
      { ref: "pay_2001", vendor_id: "vnd_aldergate", whole: 300n, due: 7n * NS_PER_DAY },
      { ref: "pay_2002", vendor_id: "vnd_aldergate", whole: 450n, due: 12n * NS_PER_DAY },
    ],
  },
];

const POLICY_DAYS = 60n;

export interface DeployOptions {
  network: VaultNetwork;
  rpcUrl: string;
  root: string;
  rootKey?: string;
  secretsDir: string;
  manifestFile: string;
  wasmDir?: string;
  /** Stands in until a real agent version is frozen. Rerun with the real one to re-activate. */
  manifestDigest: string;
  assessmentRef: string;
  log?: (line: string) => void;
}

async function permissionsOf(deployer: Deployer, accountId: string): Promise<KeyPermissionRecord[]> {
  const keys = await listKeys(deployer.provider, accountId);
  return keys.map((key) => ({ public_key: key.public_key, permission: key.access_key.permission }));
}

export async function deployAndSeed(options: DeployOptions): Promise<DeploymentManifest> {
  const log = options.log ?? console.log;
  const credentials = new CredentialStore(join(options.secretsDir, "credentials.json"));
  const deployer = new Deployer(options.network, options.rpcUrl, credentials, log);
  const account = (name: string) => `${name}.${options.root}`;

  if (options.rootKey) credentials.set(options.root, options.rootKey);
  if (!(await viewAccount(deployer.provider, options.root))) {
    if (options.network !== "testnet") throw new Error(`Root ${options.root} does not exist`);
    let key = credentials.get(options.root);
    if (!key) {
      key = KeyPair.fromRandom("ed25519").toString();
      credentials.set(options.root, key);
    }
    log(`Creating root ${options.root} from the testnet faucet`);
    await createFromFaucet(options.root, KeyPair.fromString(key as never).getPublicKey().toString());
    for (let i = 0; i < 30 && !(await viewAccount(deployer.provider, options.root)); i++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  const root = deployer.signer(options.root);
  const rootState = await viewAccount(deployer.provider, options.root);
  log(`Root ${options.root} holds ${BigInt(rootState?.amount ?? 0) / MILLINEAR} mN`);

  const wasm = {
    vault: readWasm("vault", options.wasmDir),
    evidence: readWasm("evidence", options.wasmDir),
    token: readWasm("mock-token", options.wasmDir),
  };

  log("Token");
  const token = await deployer.ensureAccount(account("sgusd"), root, 1_750n * MILLINEAR);
  await deployer.ensureContract(token, wasm.token, { method: "new", args: { owner: options.root } });

  log("Evidence registry");
  const issuer = await deployer.ensureAccount(account("issuer"), root, 200n * MILLINEAR);
  const evidence = await deployer.ensureAccount(account("evidence"), root, 2_100n * MILLINEAR);
  await deployer.ensureContract(evidence, wasm.evidence, {
    method: "new",
    args: { owner: options.root, issuers: [issuer.account_id] },
  });

  log("Vendors");
  const vendorParent = await deployer.ensureAccount(account("vendors"), root, 100n * MILLINEAR);
  const vendorAccounts = new Map<string, SignerHandle>();
  for (const business of BUSINESSES) {
    for (const vendor of business.vendors) {
      const id = `${vendor.name}.${vendorParent.account_id}`;
      const handle = await deployer.ensureAccount(id, vendorParent, 5n * MILLINEAR);
      vendorAccounts.set(vendor.vendor_id, handle);
      await deployer.call(root, token.account_id, "storage_deposit", { account_id: id, registration_only: true }, STORAGE_DEPOSIT);
    }
  }

  const now = BigInt((await deployer.provider.viewBlock({ finality: "final" })).header.timestamp_nanosec);
  const signers: SignerFile = {};
  const vaults: VaultDeployment[] = [];

  for (const business of BUSINESSES) {
    log(business.business);
    const owner = await deployer.ensureAccount(account(business.owner), root, 150n * MILLINEAR);
    const vault = await deployer.ensureAccount(account(business.vault), root, 3_400n * MILLINEAR);
    const expires = (now + POLICY_DAYS * NS_PER_DAY).toString();
    const policy = {
      weekly_cap_atomic: business.weekly.toString(),
      lifetime_cap_atomic: business.lifetime.toString(),
      expires_at_ns: expires,
    };
    await deployer.call(owner, token.account_id, "storage_deposit", { account_id: owner.account_id, registration_only: true }, STORAGE_DEPOSIT);
    await deployer.call(root, token.account_id, "storage_deposit", { account_id: vault.account_id, registration_only: true }, STORAGE_DEPOSIT);

    const guardian = business.guardian
      ? await deployer.ensureRestrictedAccount(account(business.guardian), root, 50n * MILLINEAR, vault.account_id, ["pause"], 30n * MILLINEAR)
      : null;

    await deployer.ensureContract(vault, wasm.vault, {
      method: "new",
      args: {
        config: {
          owner: owner.account_id,
          guardian: guardian?.account_id ?? null,
          token_contract: token.account_id,
          token_decimals: 6,
          policy,
          capacities: null,
        },
      },
    });

    // The agent has exactly one key, restricted to request_payment on its own vault.
    const agentId = `agent.${vault.account_id}`;
    const agent = await deployer.ensureRestrictedAccount(agentId, vault, AGENT_BALANCE, vault.account_id, ["request_payment"], AGENT_KEY_ALLOWANCE);

    log("  vendors and payables");
    const existingVendors = await viewCall<Array<{ vendor_id: string; revision: number }>>(deployer.provider, vault.account_id, "get_vendors", {});
    for (const vendor of business.vendors) {
      const recipient = vendorAccounts.get(vendor.vendor_id)?.account_id as string;
      if (!existingVendors.some((v) => v.vendor_id === vendor.vendor_id)) {
        await deployer.call(
          owner,
          vault.account_id,
          "set_vendor",
          {
            vendor: {
              vendor_id: vendor.vendor_id,
              display_name: vendor.display_name,
              account_id: recipient,
              per_payment_cap_atomic: vendor.cap.toString(),
              active: true,
            },
            expected_revision: 0,
          },
          ONE_YOCTO,
        );
      }
    }
    const payableRecords: VaultDeployment["payables"] = [];
    for (const seed of business.payables) {
      const expiresAt = (now + 60n * NS_PER_DAY).toString();
      const due = (now + seed.due).toString();
      const notBefore = (now + (seed.not_before ?? -NS_PER_DAY)).toString();
      const po = `PO-${seed.ref.replace("pay_", "")}`;
      const invoice = `INV-${seed.ref.replace("pay_", "")}`;
      const amount = (seed.whole * SGUSD).toString();
      if ((await viewCall<unknown>(deployer.provider, vault.account_id, "get_payable", { payable_ref: seed.ref })) === null) {
        await deployer.call(
          owner,
          vault.account_id,
          "register_payable",
          {
            payable: {
              payable_ref: seed.ref,
              vendor_id: seed.vendor_id,
              vendor_revision: 1,
              po_number: po,
              invoice_number: invoice,
              amount_atomic: amount,
              not_before_ns: notBefore,
              due_at_ns: due,
              expires_at_ns: expiresAt,
              evidence_commitment: sha256Digest(`${seed.ref}|${po}|${invoice}|${amount}`),
            },
          },
          ONE_YOCTO,
        );
      }
      payableRecords.push({ payable_ref: seed.ref, vendor_id: seed.vendor_id, amount_atomic: amount, po_number: po, due_at_ns: due });
    }

    const binding = await viewCall<{ revision: number; manifest_digest: string } | null>(deployer.provider, vault.account_id, "get_binding", {});
    if (!binding || binding.manifest_digest !== options.manifestDigest) {
      log("  activate agent");
      await deployer.call(
        owner,
        vault.account_id,
        "activate_agent",
        {
          binding: {
            agent_account_id: agentId,
            public_key: agent.public_key,
            manifest_digest: options.manifestDigest,
            assessment_ref: options.assessmentRef,
            expires_at_ns: expires,
          },
          expected_revision: binding?.revision ?? 0,
        },
        ONE_YOCTO,
      );
    }

    const usage = await viewCall<{ balance_atomic: string; lifetime_settled_atomic: string; owner_paid_atomic: string }>(deployer.provider, vault.account_id, "get_usage", {});
    if (usage.balance_atomic === "0" && usage.lifetime_settled_atomic === "0" && usage.owner_paid_atomic === "0") {
      log("  fund");
      await deployer.call(root, token.account_id, "mint", { account_id: owner.account_id, amount: business.funded.toString() });
      await deployer.call(
        owner,
        token.account_id,
        "ft_transfer_call",
        { receiver_id: vault.account_id, amount: business.funded.toString(), msg: "" },
        ONE_YOCTO,
      );
    }

    const paused = await viewCall<{ paused: boolean }>(deployer.provider, vault.account_id, "get_policy", {});
    if (paused.paused) await deployer.call(owner, vault.account_id, "unpause", {}, ONE_YOCTO);

    await deployer.lock(vault);

    const signerEntry: VaultSigners = {
      agent: { account_id: agentId, private_key: credentials.get(agentId) as string },
      owner: { account_id: owner.account_id, private_key: credentials.get(owner.account_id) as string },
    };
    if (guardian) signerEntry.guardian = { account_id: guardian.account_id, private_key: credentials.get(guardian.account_id) as string };
    signers[vault.account_id] = signerEntry;

    const vaultState = await viewAccount(deployer.provider, vault.account_id);
    vaults.push({
      business: business.business,
      vault_id: vault.account_id,
      code_hash: vaultState?.code_hash as string,
      owner: owner.account_id,
      guardian: guardian?.account_id ?? null,
      agent: { account_id: agentId, keys: await permissionsOf(deployer, agentId) },
      vault_keys: await permissionsOf(deployer, vault.account_id),
      guardian_keys: guardian ? await permissionsOf(deployer, guardian.account_id) : [],
      policy,
      vendors: business.vendors.map((vendor) => ({
        vendor_id: vendor.vendor_id,
        display_name: vendor.display_name,
        account_id: vendorAccounts.get(vendor.vendor_id)?.account_id as string,
        per_payment_cap_atomic: vendor.cap.toString(),
      })),
      payables: payableRecords,
      funded_atomic: business.funded.toString(),
    });
  }

  await deployer.lock(token);
  await deployer.lock(evidence);

  const metadata = await viewCall<{ name: string; symbol: string; decimals: number }>(deployer.provider, token.account_id, "ft_metadata", {});
  const manifest: DeploymentManifest = {
    network: options.network,
    rpc_url: options.rpcUrl,
    deployed_at: new Date().toISOString(),
    root: options.root,
    token: {
      contract_id: token.account_id,
      code_hash: (await viewAccount(deployer.provider, token.account_id))?.code_hash as string,
      name: metadata.name,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
    },
    evidence: {
      contract_id: evidence.account_id,
      code_hash: (await viewAccount(deployer.provider, evidence.account_id))?.code_hash as string,
      issuers: [issuer.account_id],
    },
    vaults,
    wasm_sha256: {
      vault: sha256Hex(wasm.vault),
      evidence: sha256Hex(wasm.evidence),
      token: sha256Hex(wasm.token),
    },
    contract_versions: { near_sdk: "5.30.1", rust: "1.95.0" },
  };
  mkdirSync(dirname(options.manifestFile), { recursive: true });
  writeFileSync(options.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(options.secretsDir, "signers.json"), `${JSON.stringify(signers, null, 2)}\n`, { mode: 0o600 });
  log(`Manifest: ${options.manifestFile}`);
  log(`Signers (keep private): ${join(options.secretsDir, "signers.json")}`);
  return manifest;
}

async function main(): Promise<void> {
  const { network, rpcUrl } = networkFromEnv();
  const root = process.env.REDLINE_ROOT_ACCOUNT;
  if (!root) throw new Error("Set REDLINE_ROOT_ACCOUNT, for example redline-demo.testnet. It is created from the faucet if it does not exist.");
  const rootKey = process.env.REDLINE_ROOT_KEY;
  await deployAndSeed({
    network,
    rpcUrl,
    root,
    ...(rootKey ? { rootKey } : {}),
    secretsDir: defaultSecretsDir(network),
    manifestFile: manifestPath(network),
    manifestDigest: process.env.REDLINE_MANIFEST_DIGEST ?? sha256Digest("redline-agent-not-yet-frozen"),
    assessmentRef: process.env.REDLINE_ASSESSMENT_REF ?? "not_yet_assessed",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

export { NEAR };
