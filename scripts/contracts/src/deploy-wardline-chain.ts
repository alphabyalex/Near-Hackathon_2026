import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CredentialStore,
  Deployer,
  MILLINEAR,
  NEAR,
  defaultSecretsDir,
  networkFromEnv,
  readWasm,
  sha256Hex,
  viewAccount,
  type VaultNetwork,
} from "./lib.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface WardlineDeploymentManifest {
  network: VaultNetwork;
  rpc_url: string;
  deployed_at: string;
  root: string;
  contracts: {
    model_registry: {
      account_id: string;
      code_hash: string;
    };
    cover_pool: {
      account_id: string;
      code_hash: string;
      junior: string;
      large_claim_threshold: string;
    };
    meter: {
      account_id: string;
      code_hash: string;
      cover_fee_bps: number;
    };
    payee_registry?: {
      account_id: string;
      code_hash: string;
    };
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
    console.log(
      `[Wardline Deploy] Root account ${rootId} not found in ${credPath}.`,
    );
    console.log(
      `Set WARDLINE_TESTNET_ROOT or add credentials to ${credPath} before running live on testnet.`,
    );
    console.log(
      `Generating simulated manifest preview for deployment reference...`,
    );

    const wasmModelReg = readWasm("model-registry");
    const wasmCoverPool = readWasm("cover-pool");
    const wasmMeter = readWasm("meter");
    const wasmPayeeReg = readWasm("payee-registry");

    const previewManifest: WardlineDeploymentManifest = {
      network,
      rpc_url:
        network === "mainnet"
          ? "https://rpc.mainnet.near.org"
          : "https://test.rpc.fastnear.com",
      deployed_at: new Date().toISOString(),
      root: rootId,
      contracts: {
        model_registry: {
          account_id: `model-reg.${rootId}`,
          code_hash: sha256Hex(wasmModelReg),
        },
        cover_pool: {
          account_id: `cover-pool.${rootId}`,
          code_hash: sha256Hex(wasmCoverPool),
          junior: "5000000",
          large_claim_threshold: "1000000",
        },
        meter: {
          account_id: `ai-meter.${rootId}`,
          code_hash: sha256Hex(wasmMeter),
          cover_fee_bps: 200,
        },
        payee_registry: {
          account_id: `payee-reg.${rootId}`,
          code_hash: sha256Hex(wasmPayeeReg),
        },
      },
    };

    const outPath = join(HERE, "../deployments/testnet-wardline.json");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(previewManifest, null, 2)}\n`);
    console.log(`[Wardline Deploy] Written deployment spec to ${outPath}`);
    return;
  }

  const deployer = new Deployer(network, creds, console.log);
  const root = await deployer.loadSigner(rootId);

  console.log(`[Wardline Deploy] Connected to root: ${rootId}`);

  // Deploy subaccounts and contracts
  const modelRegAccount = await deployer.ensureAccount(
    root,
    `model-reg.${rootId}`,
    5n * NEAR,
  );
  const wasmModelReg = readWasm("model-registry");
  await deployer.ensureContract(modelRegAccount, wasmModelReg, {
    method: "new",
    args: { owner: rootId },
  });

  const payeeRegAccount = await deployer.ensureAccount(
    root,
    `payee-reg.${rootId}`,
    5n * NEAR,
  );
  const wasmPayeeReg = readWasm("payee-registry");
  await deployer.ensureContract(payeeRegAccount, wasmPayeeReg, {
    method: "new",
    args: {
      owner: rootId,
      conservative_caps: {
        weekly_cap_atomic: "5000000000",
        lifetime_cap_atomic: "20000000000",
        expires_at_ns: "4000000000000000000",
      },
    },
  });

  const poolAccount = await deployer.ensureAccount(
    root,
    `cover-pool.${rootId}`,
    5n * NEAR,
  );
  const wasmCoverPool = readWasm("cover-pool");
  await deployer.ensureContract(poolAccount, wasmCoverPool, {
    method: "new",
    args: {
      owner: rootId,
      token_contract: `mock-usdc.${rootId}`,
      junior_holder: rootId,
      junior: "5000000",
      withdraw_delay_days: 7,
      large_claim_threshold: "1000000",
      max_claim_bps: 1000,
    },
  });

  const meterAccount = await deployer.ensureAccount(
    root,
    `ai-meter.${rootId}`,
    5n * NEAR,
  );
  const wasmMeter = readWasm("meter");
  await deployer.ensureContract(meterAccount, wasmMeter, {
    method: "new",
    args: {
      owner: rootId,
      token_contract: `mock-usdc.${rootId}`,
      registry_contract: modelRegAccount.account_id,
      pool_contract: poolAccount.account_id,
      cover_fee_bps: 200,
    },
  });

  const manifest: WardlineDeploymentManifest = {
    network,
    rpc_url:
      network === "mainnet"
        ? "https://rpc.mainnet.near.org"
        : "https://test.rpc.fastnear.com",
    deployed_at: new Date().toISOString(),
    root: rootId,
    contracts: {
      model_registry: {
        account_id: modelRegAccount.account_id,
        code_hash: sha256Hex(wasmModelReg),
      },
      cover_pool: {
        account_id: poolAccount.account_id,
        code_hash: sha256Hex(wasmCoverPool),
        junior: "5000000",
        large_claim_threshold: "1000000",
      },
      meter: {
        account_id: meterAccount.account_id,
        code_hash: sha256Hex(wasmMeter),
        cover_fee_bps: 200,
      },
      payee_registry: {
        account_id: payeeRegAccount.account_id,
        code_hash: sha256Hex(wasmPayeeReg),
      },
    },
  };

  const outPath = join(HERE, "../deployments/testnet-wardline.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[Wardline Deploy] Deployment successfully written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
