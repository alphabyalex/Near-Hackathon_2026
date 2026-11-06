import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { KeyPair, Worker, captureError, parseNEAR } from "near-workspaces";

export const DAY_NS = 24n * 60n * 60n * 1_000_000_000n;
export const DEFAULT_GAS = 200_000_000_000_000n;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VAULT_WASM = resolve(ROOT, "contracts/res/spend_gym_vault.wasm");
const TOKEN_WASM = resolve(ROOT, "contracts/res/spend_gym_mock_token.wasm");
const PROXY_WASM = resolve(ROOT, "contracts/res/spend_gym_test_proxy.wasm");
const STORAGE_ALLOWANCE = "750000000000000000000000";

export function request(
  payableRef,
  digest,
  revisions = { policy: 1, vendor: 1, binding: 1 },
) {
  return {
    payable_ref: payableRef,
    request_digest: digest,
    expected_policy_revision: revisions.policy,
    expected_vendor_revision: revisions.vendor,
    expected_binding_revision: revisions.binding,
  };
}

export function rejectionCode(result) {
  return result?.rejection?.code;
}

export async function captureFailure(action) {
  return captureError(action);
}

async function storageRegister(token, signer, accountId, minimum) {
  await signer.call(
    token,
    "storage_deposit",
    { account_id: accountId, registration_only: true },
    { attachedDeposit: minimum },
  );
}

export async function registerPayable(vault, owner, input) {
  return owner.call(vault, "register_payable", { input });
}

export async function setupSandbox(options = {}) {
  const worker = await Worker.init();
  const root = worker.rootAccount;
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const weeklyCap = options.weeklyCap ?? 1_000n;
  const lifetimeCeiling = options.lifetimeCeiling ?? 3_000n;
  const vendorCap = options.vendorCap ?? 500n;
  const funding = options.funding ?? 10_000n;

  const token = await root.devDeploy(TOKEN_WASM, {
    method: "new",
    args: { owner_id: root.accountId, total_supply: "1000000000" },
    initialBalance: BigInt(parseNEAR("5")),
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
  const vaultA = await root.devDeploy(VAULT_WASM, {
    method: "new",
    args: {
      config: {
        owner_id: root.accountId,
        guardian_id: null,
        token_contract_id: token.accountId,
        token_decimals: 6,
        weekly_cap_atomic: weeklyCap.toString(),
        lifetime_ceiling_atomic: lifetimeCeiling.toString(),
        capacities,
      },
    },
    initialBalance: BigInt(parseNEAR("5")),
  });
  const vaultB = await root.devDeploy(VAULT_WASM, {
    method: "new",
    args: {
      config: {
        owner_id: root.accountId,
        guardian_id: null,
        token_contract_id: token.accountId,
        token_decimals: 6,
        weekly_cap_atomic: weeklyCap.toString(),
        lifetime_ceiling_atomic: lifetimeCeiling.toString(),
        capacities,
      },
    },
    initialBalance: BigInt(parseNEAR("5")),
  });
  const proxy = await root.devDeploy(PROXY_WASM, {
    method: "new",
    args: {},
    initialBalance: BigInt(parseNEAR("2")),
  });

  const agentAKey = KeyPair.fromRandom("ed25519");
  const agentBKey = KeyPair.fromRandom("ed25519");
  const wrongAgentKey = KeyPair.fromRandom("ed25519");
  const agentA = await root.createSubAccount("agent-a", {
    keyPair: agentAKey,
    initialBalance: BigInt(parseNEAR("2")),
  });
  const agentB = await root.createSubAccount("agent-b", {
    keyPair: agentBKey,
    initialBalance: BigInt(parseNEAR("2")),
  });
  const outsider = await root.createSubAccount("outsider", {
    initialBalance: BigInt(parseNEAR("2")),
  });
  const vendorA = await root.createSubAccount("vendor-a", {
    initialBalance: BigInt(parseNEAR("1")),
  });
  const vendorB = await root.createSubAccount("vendor-b", {
    initialBalance: BigInt(parseNEAR("1")),
  });
  const unregisteredVendor = await root.createSubAccount("unregistered-vendor", {
    initialBalance: BigInt(parseNEAR("1")),
  });

  const permissionA = {
    nonce: 0,
    permission: {
      FunctionCall: {
        allowance: STORAGE_ALLOWANCE,
        receiver_id: vaultA.accountId,
        method_names: ["request_payment"],
      },
    },
  };
  const permissionB = {
    nonce: 0,
    permission: {
      FunctionCall: {
        allowance: STORAGE_ALLOWANCE,
        receiver_id: vaultB.accountId,
        method_names: ["request_payment"],
      },
    },
  };
  await agentA.updateAccessKey(agentAKey, permissionA);
  await agentA.updateAccessKey(wrongAgentKey, permissionA);
  await agentB.updateAccessKey(agentBKey, permissionB);

  const bounds = await token.view("storage_balance_bounds", {});
  const minimum = BigInt(bounds.min);
  for (const account of [vaultA, vaultB, vendorA, vendorB]) {
    await storageRegister(token, root, account.accountId, minimum);
  }

  await root.call(vaultA, "set_vendor", {
    input: {
      vendor_id: "vendor-a",
      recipient: vendorA.accountId,
      per_payment_cap_atomic: vendorCap.toString(),
      enabled: true,
    },
    expected_revision: 0,
  });
  await root.call(vaultA, "set_vendor", {
    input: {
      vendor_id: "vendor-missing-storage",
      recipient: unregisteredVendor.accountId,
      per_payment_cap_atomic: vendorCap.toString(),
      enabled: true,
    },
    expected_revision: 0,
  });
  await root.call(vaultB, "set_vendor", {
    input: {
      vendor_id: "vendor-b",
      recipient: vendorB.accountId,
      per_payment_cap_atomic: vendorCap.toString(),
      enabled: true,
    },
    expected_revision: 0,
  });

  await root.call(vaultA, "activate_agent", {
    input: {
      account_id: agentA.accountId,
      public_key: agentAKey.getPublicKey().toString(),
      manifest_digest: "sha256:sandbox-agent-a-v1",
      valid_from_ns: (nowNs - DAY_NS).toString(),
      expires_at_ns: (nowNs + 30n * DAY_NS).toString(),
    },
    expected_revision: 0,
  });
  await root.call(vaultB, "activate_agent", {
    input: {
      account_id: agentB.accountId,
      public_key: agentBKey.getPublicKey().toString(),
      manifest_digest: "sha256:sandbox-agent-b-v1",
      valid_from_ns: (nowNs - DAY_NS).toString(),
      expires_at_ns: (nowNs + 30n * DAY_NS).toString(),
    },
    expected_revision: 0,
  });

  for (const vault of [vaultA, vaultB]) {
    await root.call(
      token,
      "ft_transfer_call",
      { receiver_id: vault.accountId, amount: funding.toString(), memo: null, msg: "" },
      { attachedDeposit: 1n, gas: DEFAULT_GAS },
    );
    await root.call(vault, "unpause", {});
  }

  const fixture = {
    worker,
    root,
    token,
    vaultA,
    vaultB,
    proxy,
    agentA,
    agentB,
    outsider,
    vendorA,
    vendorB,
    unregisteredVendor,
    agentAKey,
    agentBKey,
    wrongAgentKey,
    nowNs,
    weeklyCap,
    lifetimeCeiling,
    vendorCap,
    capacities,
    async registerDefaultPayable({
      vault = vaultA,
      owner = root,
      payableRef = "payable-1",
      vendorId = vault === vaultA ? "vendor-a" : "vendor-b",
      vendorRevision = 1,
      amount = 400n,
      notBefore = nowNs - DAY_NS,
      dueAt = nowNs + 10n * DAY_NS,
      expiresAt = nowNs + 20n * DAY_NS,
    } = {}) {
      return registerPayable(vault, owner, {
        payable_ref: payableRef,
        vendor_id: vendorId,
        vendor_revision: vendorRevision,
        amount_atomic: amount.toString(),
        po_number: `PO-${payableRef}`,
        not_before_ns: notBefore.toString(),
        due_at_ns: dueAt.toString(),
        expires_at_ns: expiresAt.toString(),
      });
    },
    async requestA(payableRef, digest, revisions) {
      return agentA.call(
        vaultA,
        "request_payment",
        { request: request(payableRef, digest, revisions) },
        { signWithKey: agentAKey, gas: DEFAULT_GAS },
      );
    },
    async tearDown() {
      await worker.tearDown();
    },
  };
  return fixture;
}
