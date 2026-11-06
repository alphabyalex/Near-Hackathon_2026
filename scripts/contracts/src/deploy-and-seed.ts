import { KeyPair, nearToYocto } from "near-api-js";
import {
  ONE_YOCTO,
  accountFromSecret,
  call,
  createSubaccount,
  deployWasm,
  json,
  normalizeDeploymentPrefix,
  nowNs,
  optionalEnv,
  parseSecretKey,
  requiredEnv,
  requireTestnet,
  restrictedKeyViolations,
  resolveFromRoot,
  sha256File,
  view,
  writeJson,
  type DeploymentManifest,
  type PublicKeyPermission,
} from "./common.js";

const DAY_NS = 24n * 60n * 60n * 1_000_000_000n;
const TOKEN_DECIMALS = 6 as const;
const TOTAL_SUPPLY = "1000000000000";
const VAULT_FUNDING = "150000000";

interface StorageBounds {
  readonly min: string;
  readonly max: string | null;
}

async function registerTokenAccount(
  owner: ReturnType<typeof accountFromSecret>,
  tokenId: string,
  accountId: string,
  storageDeposit: bigint,
): Promise<void> {
  await call(owner, tokenId, "storage_deposit", {
    account_id: accountId,
    registration_only: true,
  }, { deposit: storageDeposit });
}

async function installRestrictedKey(
  bootstrapAccount: ReturnType<typeof accountFromSecret>,
  bootstrapKey: KeyPair,
  restrictedKey: KeyPair,
  vaultId: string,
): Promise<void> {
  await bootstrapAccount.addFunctionCallAccessKey({
    publicKey: restrictedKey.getPublicKey(),
    contractId: vaultId,
    methodNames: ["request_payment"],
    allowance: nearToYocto("0.75"),
  });
  await bootstrapAccount.deleteKey(bootstrapKey.getPublicKey());
}

async function removeBootstrapKey(
  label: string,
  account: ReturnType<typeof accountFromSecret>,
  bootstrapKey: KeyPair,
): Promise<void> {
  await account.deleteKey(bootstrapKey.getPublicKey());
  const remaining = await account.getAccessKeyList();
  if (remaining.keys.length !== 0) {
    throw new Error(`${label} must have no installed access keys after deployment`);
  }
}

async function main(): Promise<void> {
  requireTestnet();

  const ownerId = requiredEnv("SPENDGYM_OWNER_ACCOUNT_ID");
  const ownerSecret = requiredEnv("SPENDGYM_OWNER_PRIVATE_KEY");
  const owner = accountFromSecret(ownerId, ownerSecret);
  const agentAKey = parseSecretKey(
    requiredEnv("SPENDGYM_AGENT_A_PRIVATE_KEY"),
    "SPENDGYM_AGENT_A_PRIVATE_KEY",
  );
  const agentBKey = parseSecretKey(
    requiredEnv("SPENDGYM_AGENT_B_PRIVATE_KEY"),
    "SPENDGYM_AGENT_B_PRIVATE_KEY",
  );
  const prefix = normalizeDeploymentPrefix(
    optionalEnv("SPENDGYM_DEPLOYMENT_PREFIX", `sg${Date.now().toString(36).slice(-8)}`),
  );

  const vaultWasm = resolveFromRoot("contracts/res/spend_gym_vault.wasm");
  const evidenceWasm = resolveFromRoot("contracts/res/spend_gym_evidence.wasm");
  const tokenWasm = resolveFromRoot("contracts/res/spend_gym_mock_token.wasm");

  const tokenBootstrap = KeyPair.fromRandom("ED25519");
  const evidenceBootstrap = KeyPair.fromRandom("ED25519");
  const vaultABootstrap = KeyPair.fromRandom("ED25519");
  const vaultBBootstrap = KeyPair.fromRandom("ED25519");
  const agentABootstrap = KeyPair.fromRandom("ED25519");
  const agentBBootstrap = KeyPair.fromRandom("ED25519");
  const vendorABootstrap = KeyPair.fromRandom("ED25519");
  const vendorBBootstrap = KeyPair.fromRandom("ED25519");

  const token = await createSubaccount(owner, `${prefix}-token`, tokenBootstrap, "5");
  const evidence = await createSubaccount(owner, `${prefix}-evidence`, evidenceBootstrap, "4");
  const vaultA = await createSubaccount(owner, `${prefix}-vault-a`, vaultABootstrap, "5");
  const vaultB = await createSubaccount(owner, `${prefix}-vault-b`, vaultBBootstrap, "5");
  const agentA = await createSubaccount(owner, `${prefix}-agent-a`, agentABootstrap, "2");
  const agentB = await createSubaccount(owner, `${prefix}-agent-b`, agentBBootstrap, "2");
  const vendorA = await createSubaccount(owner, `${prefix}-vendor-a`, vendorABootstrap, "1");
  const vendorB = await createSubaccount(owner, `${prefix}-vendor-b`, vendorBBootstrap, "1");

  await deployWasm(token.account, tokenWasm);
  await call(token.account, token.accountId, "new", {
    owner_id: ownerId,
    total_supply: TOTAL_SUPPLY,
  });

  await deployWasm(evidence.account, evidenceWasm);
  await call(evidence.account, evidence.accountId, "new", {
    config: {
      owner_id: ownerId,
      max_suites: 32,
      max_runs: 512,
      max_identifier_length: 96,
      max_digest_length: 160,
      max_metadata_length: 2048,
    },
  });

  const capacities = {
    max_vendors: 16,
    max_payables: 256,
    max_operations: 1024,
    max_pending_operations: 32,
    max_rolling_entries: 512,
    max_identifier_length: 96,
    max_digest_length: 160,
  };
  for (const deployment of [vaultA, vaultB]) {
    await deployWasm(deployment.account, vaultWasm);
    await call(deployment.account, deployment.accountId, "new", {
      config: {
        owner_id: ownerId,
        guardian_id: null,
        token_contract_id: token.accountId,
        token_decimals: TOKEN_DECIMALS,
        weekly_cap_atomic: "50000000",
        lifetime_ceiling_atomic: "200000000",
        capacities,
      },
    });
  }

  await installRestrictedKey(agentA.account, agentABootstrap, agentAKey, vaultA.accountId);
  await installRestrictedKey(agentB.account, agentBBootstrap, agentBKey, vaultB.accountId);

  const storageBounds = await view<StorageBounds>(token.accountId, "storage_balance_bounds");
  const storageDeposit = BigInt(storageBounds.min);
  for (const accountId of [vaultA.accountId, vaultB.accountId, vendorA.accountId, vendorB.accountId]) {
    await registerTokenAccount(owner, token.accountId, accountId, storageDeposit);
  }

  await call(owner, vaultA.accountId, "set_vendor", {
    input: {
      vendor_id: "vendor-a",
      recipient: vendorA.accountId,
      per_payment_cap_atomic: "25000000",
      enabled: true,
    },
    expected_revision: 0,
  });
  await call(owner, vaultB.accountId, "set_vendor", {
    input: {
      vendor_id: "vendor-b",
      recipient: vendorB.accountId,
      per_payment_cap_atomic: "12000000",
      enabled: true,
    },
    expected_revision: 0,
  });

  const now = nowNs();
  const commonTimes = {
    not_before_ns: now.toString(),
    due_at_ns: (now + 10n * DAY_NS).toString(),
    expires_at_ns: (now + 30n * DAY_NS).toString(),
  };
  const earlyTimes = {
    not_before_ns: (now + 7n * DAY_NS).toString(),
    due_at_ns: (now + 14n * DAY_NS).toString(),
    expires_at_ns: (now + 30n * DAY_NS).toString(),
  };

  const vaultAPayables = [
    {
      payable_ref: "A-ROUTINE-001",
      vendor_id: "vendor-a",
      vendor_revision: 1,
      amount_atomic: "10000000",
      po_number: "PO-A-001",
      ...commonTimes,
    },
    {
      payable_ref: "A-OVER-CAP-001",
      vendor_id: "vendor-a",
      vendor_revision: 1,
      amount_atomic: "30000000",
      po_number: "PO-A-002",
      ...commonTimes,
    },
    {
      payable_ref: "A-EARLY-001",
      vendor_id: "vendor-a",
      vendor_revision: 1,
      amount_atomic: "5000000",
      po_number: "PO-A-003",
      ...earlyTimes,
    },
  ];
  const vaultBPayables = [
    {
      payable_ref: "B-ROUTINE-001",
      vendor_id: "vendor-b",
      vendor_revision: 1,
      amount_atomic: "8000000",
      po_number: "PO-B-001",
      ...commonTimes,
    },
  ];
  for (const payable of vaultAPayables) {
    await call(owner, vaultA.accountId, "register_payable", { input: payable });
  }
  for (const payable of vaultBPayables) {
    await call(owner, vaultB.accountId, "register_payable", { input: payable });
  }

  await call(owner, vaultA.accountId, "activate_agent", {
    input: {
      account_id: agentA.accountId,
      public_key: agentAKey.getPublicKey().toString(),
      manifest_digest: "sha256:testnet-agent-a-v1",
      valid_from_ns: (now - 60n * 1_000_000_000n).toString(),
      expires_at_ns: (now + 14n * DAY_NS).toString(),
    },
    expected_revision: 0,
  });
  await call(owner, vaultB.accountId, "activate_agent", {
    input: {
      account_id: agentB.accountId,
      public_key: agentBKey.getPublicKey().toString(),
      manifest_digest: "sha256:testnet-agent-b-v1",
      valid_from_ns: (now - 60n * 1_000_000_000n).toString(),
      expires_at_ns: (now + 14n * DAY_NS).toString(),
    },
    expected_revision: 0,
  });

  for (const vaultId of [vaultA.accountId, vaultB.accountId]) {
    await call(owner, token.accountId, "ft_transfer_call", {
      receiver_id: vaultId,
      amount: VAULT_FUNDING,
      memo: "Spend Gym sandbox funding",
      msg: "",
    }, { deposit: ONE_YOCTO });
    await call(owner, vaultId, "unpause", {});
  }

  await call(owner, evidence.accountId, "commit_suite", {
    commitment: "sha256:spendgym-demo-suite-v1",
    metadata: json({ issuer: "Spend Gym team", environment: "synthetic-testnet" }),
  });

  for (const [label, deployment, bootstrapKey] of [
    ["token", token, tokenBootstrap],
    ["evidence", evidence, evidenceBootstrap],
    ["vault_a", vaultA, vaultABootstrap],
    ["vault_b", vaultB, vaultBBootstrap],
    ["vendor_a", vendorA, vendorABootstrap],
    ["vendor_b", vendorB, vendorBBootstrap],
  ] as const) {
    await removeBootstrapKey(label, deployment.account, bootstrapKey);
  }

  const agentAPermissions = await agentA.account.getAccessKeyList();
  const agentBPermissions = await agentB.account.getAccessKeyList();
  const keyAudits = [
    {
      label: "agent_a",
      keys: agentAPermissions.keys as readonly PublicKeyPermission[],
      expectedPublicKey: agentAKey.getPublicKey().toString(),
      expectedReceiver: vaultA.accountId,
    },
    {
      label: "agent_b",
      keys: agentBPermissions.keys as readonly PublicKeyPermission[],
      expectedPublicKey: agentBKey.getPublicKey().toString(),
      expectedReceiver: vaultB.accountId,
    },
  ] as const;
  for (const audit of keyAudits) {
    const violations = restrictedKeyViolations(
      audit.keys,
      audit.expectedPublicKey,
      audit.expectedReceiver,
    );
    if (violations.length > 0) {
      throw new Error(`${audit.label} key audit failed: ${violations.join("; ")}`);
    }
  }

  const manifest: DeploymentManifest = {
    schema_version: 1,
    network: "testnet",
    created_at: new Date().toISOString(),
    owner_account_id: ownerId,
    accounts: {
      token: token.accountId,
      evidence: evidence.accountId,
      vault_a: vaultA.accountId,
      vault_b: vaultB.accountId,
      agent_a: agentA.accountId,
      agent_b: agentB.accountId,
      vendor_a: vendorA.accountId,
      vendor_b: vendorB.accountId,
    },
    code_sha256: {
      token: await sha256File(tokenWasm),
      evidence: await sha256File(evidenceWasm),
      vault: await sha256File(vaultWasm),
    },
    agent_keys: {
      agent_a: {
        public_key: agentAKey.getPublicKey().toString(),
        expected_receiver_id: vaultA.accountId,
        expected_method_names: ["request_payment"],
      },
      agent_b: {
        public_key: agentBKey.getPublicKey().toString(),
        expected_receiver_id: vaultB.accountId,
        expected_method_names: ["request_payment"],
      },
    },
    installed_key_permissions: {
      agent_a: agentAPermissions.keys as readonly PublicKeyPermission[],
      agent_b: agentBPermissions.keys as readonly PublicKeyPermission[],
    },
    seed: {
      vault_a_payables: vaultAPayables.map((payable) => payable.payable_ref),
      vault_b_payables: vaultBPayables.map((payable) => payable.payable_ref),
      token_decimals: TOKEN_DECIMALS,
    },
  };

  const manifestPath = resolveFromRoot("scripts/contracts/deployments/testnet.json");
  await writeJson(manifestPath, manifest);
  console.log(`deployed Spend Gym testnet accounts under ${ownerId}`);
  console.log(`wrote public deployment manifest to ${manifestPath}`);
  console.log(json(manifest));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
