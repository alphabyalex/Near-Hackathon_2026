import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair, actions, type KeyPairString } from "near-api-js";
import {
  CredentialStore,
  Deployer,
  NEAR,
  defaultSecretsDir,
  networkFromEnv,
  readWasm,
  sha256Hex,
  viewAccount,
  type VaultNetwork,
} from "./lib.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const USDC_ACCOUNT =
  process.env.WARDLINE_USDC_ACCOUNT ??
  "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const STORAGE_DEPOSIT_USDC = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR

interface WardlineDeploymentManifest {
  network: VaultNetwork;
  rpc_url: string;
  deployed_at: string;
  root: string;
  contracts: {
    payee_registry: {
      account_id: string;
      code_hash: string;
    };
    vault: {
      account_id: string;
      code_hash: string;
      token_contract: string;
    };
    model_registry: {
      account_id: string;
      code_hash: string;
    };
    meter: {
      account_id: string;
      code_hash: string;
      cover_fee_bps: number;
    };
    cover_pool: {
      account_id: string;
      code_hash: string;
      token_contract: string;
      large_claim_threshold: string;
    };
    dao: {
      account_id: string;
      code_hash: string;
      council: string[];
    };
  };
  demo_accounts: {
    provider: string;
    investor1: string;
    investor2: string;
    agent: string;
  };
  gateway_signer: {
    account_id: string;
    public_key: string;
  };
}

async function main(): Promise<void> {
  const { network, rpcUrl } = networkFromEnv();
  const secretsDir = defaultSecretsDir(network);
  const credPath = join(secretsDir, "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId =
    process.env.WARDLINE_TESTNET_ROOT ?? "wardline-labs.testnet";

  const rootKey = creds.get(rootId);
  if (!rootKey) {
    throw new Error(`Root account ${rootId} not found in ${credPath}.`);
  }

  const deployer = new Deployer(network, rpcUrl, creds, console.log);
  const root = deployer.signer(rootId);

  const rootState = await viewAccount(deployer.provider, rootId);
  console.log(
    `[Wardline Deploy] Connected to root: ${rootId} (balance: ${
      rootState ? BigInt(rootState.amount) / NEAR : 0
    } NEAR)`,
  );

  // 1. payee-registry
  console.log("\n[1/6] Deploying payee-registry...");
  const payeeRegId = `payee-registry.${rootId}`;
  const payeeRegAccount = await deployer.ensureAccount(
    payeeRegId,
    root,
    2500n * (NEAR / 1000n),
  );
  const wasmPayeeReg = readWasm("payee-registry");
  await deployer.ensureContract(payeeRegAccount, wasmPayeeReg, {
    method: "new",
    args: {
      attestor: rootId,
      cooldown_ns: null,
    },
  });

  // 2. vault
  console.log("\n[2/6] Deploying vault...");
  const vaultId = `vault.${rootId}`;
  const vaultAccount = await deployer.ensureAccount(
    vaultId,
    root,
    3500n * (NEAR / 1000n),
  );
  const wasmVault = readWasm("vault");
  await deployer.ensureContract(vaultAccount, wasmVault, {
    method: "new",
    args: {
      config: {
        owner: rootId,
        guardian: null,
        token_contract: USDC_ACCOUNT,
        token_decimals: 6,
        policy: {
          weekly_cap_atomic: "5000000000",
          lifetime_cap_atomic: "50000000000",
          expires_at_ns: "4000000000000000000",
        },
        capacities: null,
        approver: rootId,
        attestor: null,
        cooldown_policy: {
          tier2_under_cap_ns: "60000000000",
          default_ns: "120000000000",
        },
        conservative_caps: null,
      },
    },
  });

  // 3. model-registry
  console.log("\n[3/6] Deploying model-registry...");
  const modelRegId = `model-registry.${rootId}`;
  const modelRegAccount = await deployer.ensureAccount(
    modelRegId,
    root,
    2500n * (NEAR / 1000n),
  );
  const wasmModelReg = readWasm("model-registry");
  await deployer.ensureContract(modelRegAccount, wasmModelReg, {
    method: "new",
    args: { owner: rootId },
  });

  // 4. cover-pool at pool.<root>
  console.log("\n[4/6] Deploying cover-pool at pool.<root>...");
  const poolId = `pool.${rootId}`;
  const poolAccount = await deployer.ensureAccount(
    poolId,
    root,
    3500n * (NEAR / 1000n),
  );
  const wasmCoverPool = readWasm("cover-pool");
  await deployer.ensureContract(poolAccount, wasmCoverPool, {
    method: "new",
    args: {
      owner: rootId,
      token_contract: USDC_ACCOUNT,
      junior_holder: rootId,
      junior: "0",
      withdraw_delay_days: 0,
      large_claim_threshold: "1000000",
      max_claim_bps: 2500,
      trade_url: null,
    },
  });

  // 5. meter at meter.<root>
  console.log("\n[5/6] Deploying meter at meter.<root>...");
  const meterId = `meter.${rootId}`;
  const meterAccount = await deployer.ensureAccount(
    meterId,
    root,
    3500n * (NEAR / 1000n),
  );
  const wasmMeter = readWasm("meter");
  await deployer.ensureContract(meterAccount, wasmMeter, {
    method: "new",
    args: {
      owner: rootId,
      token_contract: USDC_ACCOUNT,
      registry_contract: modelRegId,
      pool_contract: poolId,
      cover_fee_bps: 200,
    },
  });

  // 6. dao at dao.<root>
  console.log("\n[6/6] Deploying Sputnik DAO v2 at dao.<root>...");
  const daoId = `dao.${rootId}`;
  const daoAccount = await deployer.ensureAccount(
    daoId,
    root,
    6500n * (NEAR / 1000n),
  );
  const wasmDao = readWasm("sputnikdao2");
  const council = [rootId, `investor1.${rootId}`, `investor2.${rootId}`];
  await deployer.ensureContract(daoAccount, wasmDao, {
    method: "new",
    args: {
      config: {
        name: "wardline-dao",
        purpose: "Wardline payment authority and risk governance",
        metadata: "",
      },
      policy: {
        roles: [
          {
            name: "council",
            kind: { Group: council },
            permissions: [
              "*:VoteReject",
              "*:VoteRemove",
              "*:VoteApprove",
              "*:AddProposal",
              "*:Finalize",
            ],
            vote_policy: {},
          },
        ],
        default_vote_policy: {
          weight_kind: "RoleWeight",
          quorum: "0",
          threshold: [1, 2],
        },
        proposal_bond: "10000000000000000000000",
        proposal_period: "604800000000000",
        bounty_bond: "10000000000000000000000",
        bounty_forgiveness_period: "86400000000000",
      },
    },
  });

  // 7. Demo accounts
  console.log("\nCreating demo accounts...");
  const demoAccounts = {
    provider: `provider.${rootId}`,
    investor1: `investor1.${rootId}`,
    investor2: `investor2.${rootId}`,
    agent: `agent.${rootId}`,
  };

  const providerSigner = await deployer.ensureAccount(
    demoAccounts.provider,
    root,
    500n * (NEAR / 1000n),
  );
  const investor1Signer = await deployer.ensureAccount(
    demoAccounts.investor1,
    root,
    500n * (NEAR / 1000n),
  );
  const investor2Signer = await deployer.ensureAccount(
    demoAccounts.investor2,
    root,
    500n * (NEAR / 1000n),
  );
  const agentSigner = await deployer.ensureAccount(
    demoAccounts.agent,
    root,
    500n * (NEAR / 1000n),
  );

  // 8. Register storage deposits on Circle testnet USDC
  console.log("\nRegistering storage deposits on Circle USDC...");
  const usdcTargets = [
    rootId,
    payeeRegId,
    vaultId,
    modelRegId,
    meterId,
    poolId,
    daoId,
    demoAccounts.provider,
    demoAccounts.investor1,
    demoAccounts.investor2,
    demoAccounts.agent,
  ];

  for (const target of usdcTargets) {
    try {
      console.log(`  storage_deposit for ${target} on USDC`);
      await deployer.call(
        root,
        USDC_ACCOUNT,
        "storage_deposit",
        { account_id: target, registration_only: true },
        STORAGE_DEPOSIT_USDC,
      );
    } catch (err) {
      console.log(`  (${target} already registered on USDC or skipped: ${(err as Error).message})`);
    }
  }

  // 9. Register storage deposits on pool WARD token
  console.log("\nRegistering storage deposits on pool WARD NEP-141...");
  const wardTargets = [
    rootId,
    meterId,
    demoAccounts.investor1,
    demoAccounts.investor2,
    demoAccounts.agent,
  ];

  for (const target of wardTargets) {
    try {
      console.log(`  storage_deposit for ${target} on pool WARD`);
      await deployer.call(
        root,
        poolId,
        "storage_deposit",
        { account_id: target, registration_only: true },
        STORAGE_DEPOSIT_USDC,
      );
    } catch (err) {
      console.log(`  (${target} already registered on pool or skipped: ${(err as Error).message})`);
    }
  }

  // 10. Seed model-registry provider
  console.log("\nSeeding provider demo-provider on model-registry...");
  try {
    await deployer.call(root, modelRegId, "add_provider", {
      provider_id: "demo-provider",
      pay_to: demoAccounts.provider,
      model_ids: ["deepseek-ai/DeepSeek-V4.1-Flash-1017"],
    });
    console.log("  demo-provider seeded successfully.");
  } catch (err) {
    console.log(`  (provider already seeded or error: ${(err as Error).message})`);
  }

  // 11. Seed group budget on meter
  console.log("\nSeeding bgt_engineering on meter...");
  try {
    await deployer.call(root, meterId, "create_budget", {
      budget_id: "bgt_engineering",
      name: "Engineering shared AI budget",
      owner: daoId,
      deposit: "0",
      period: "week",
      members: [
        { member: rootId, allowance: "10000000" },
        { member: demoAccounts.agent, allowance: "10000000" },
      ],
    });
    console.log("  bgt_engineering seeded successfully.");
  } catch (err) {
    console.log(`  (budget already seeded or error: ${(err as Error).message})`);
  }

  // 12. Function-call access key on meter for gateway
  console.log("\nSetting up gateway function-call key on meter...");
  let gatewayKeyStr = creds.get(`gateway.${meterId}`);
  let gatewayKeyPair: KeyPair;
  if (!gatewayKeyStr) {
    gatewayKeyPair = KeyPair.fromRandom("ed25519");
    gatewayKeyStr = gatewayKeyPair.toString();
    creds.set(`gateway.${meterId}`, gatewayKeyStr);
  } else {
    gatewayKeyPair = KeyPair.fromString(gatewayKeyStr as KeyPairString);
  }
  const gatewayPublicKey = gatewayKeyPair.getPublicKey();

  try {
    await meterAccount.account.signAndSendTransaction({
      receiverId: meterId,
      actions: [
        actions.addFunctionCallAccessKey(
          gatewayPublicKey,
          meterId,
          ["reserve", "settle", "release"],
          10n * NEAR,
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log(`  Added gateway function-call key: ${gatewayPublicKey.toString()}`);
  } catch (err) {
    console.log(`  (Gateway key already present or added: ${(err as Error).message})`);
  }

  // Write deployment manifest
  const manifest: WardlineDeploymentManifest = {
    network,
    rpc_url: rpcUrl,
    deployed_at: new Date().toISOString(),
    root: rootId,
    contracts: {
      payee_registry: {
        account_id: payeeRegId,
        code_hash: sha256Hex(wasmPayeeReg),
      },
      vault: {
        account_id: vaultId,
        code_hash: sha256Hex(wasmVault),
        token_contract: USDC_ACCOUNT,
      },
      model_registry: {
        account_id: modelRegId,
        code_hash: sha256Hex(wasmModelReg),
      },
      meter: {
        account_id: meterId,
        code_hash: sha256Hex(wasmMeter),
        cover_fee_bps: 200,
      },
      cover_pool: {
        account_id: poolId,
        code_hash: sha256Hex(wasmCoverPool),
        token_contract: USDC_ACCOUNT,
        large_claim_threshold: "1000000",
      },
      dao: {
        account_id: daoId,
        code_hash: sha256Hex(wasmDao),
        council,
      },
    },
    demo_accounts: demoAccounts,
    gateway_signer: {
      account_id: meterId,
      public_key: gatewayPublicKey.toString(),
    },
  };

  const outPath = join(HERE, "../deployments/testnet-wardline.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n[Wardline Deploy] Deployment successfully written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
