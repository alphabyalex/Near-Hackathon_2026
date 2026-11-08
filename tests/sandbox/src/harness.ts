import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair, actions, type KeyPairString } from "near-api-js";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import {
  applyLegacyEnv,
  GAS_ADMIN,
  GAS_PAYMENT,
  ONE_YOCTO,
  TransactionRefusedError,
  VaultAdmin,
  VaultExecutionError,
  callFinal,
  makeProvider,
  makeSigner,
  viewCall,
  type FinalOutcome,
  type SignerHandle,
} from "@wardline/vault-client";
import type { Operation, Payable, PaymentRequest, Policy, RequestResult, VaultUsage } from "@wardline/schemas";

applyLegacyEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = process.env.WARDLINE_WASM_DIR ?? resolve(HERE, "../../../contracts/out");

export const NEAR = 10n ** 24n;
export const DIGEST_A = `sha256:${"a".repeat(64)}`;
export const DIGEST_B = `sha256:${"b".repeat(64)}`;
export const NS_PER_DAY = 86_400_000_000_000n;
export const WEEK_NS = 7n * NS_PER_DAY;
/** Far enough ahead to never matter during a test. */
export const FAR_FUTURE_NS = 4_000_000_000_000_000_000n;

export type WasmName = "vault" | "evidence" | "mock-token" | "test-proxy" | "payee-registry";

export function wasm(name: WasmName): Uint8Array {
  try {
    return readFileSync(resolve(WASM_DIR, `${name}.wasm`));
  } catch {
    throw new Error(`Missing ${name}.wasm in ${WASM_DIR}. Run scripts/contracts/build.sh first.`);
  }
}

/** A running sandbox node with a funded root account. */
export class Chain {
  private counter = 0;

  private constructor(
    readonly sandbox: Sandbox,
    readonly root: SignerHandle,
  ) {}

  static async start(): Promise<Chain> {
    // near-sandbox downloads to the temp dir and renames into node_modules, which fails with EXDEV
    // when /tmp is another filesystem (common on Linux and WSL). Keep temp on the home filesystem.
    const tmp = process.env.WARDLINE_SANDBOX_TMP ?? join(homedir(), ".cache", "wardline-sandbox");
    mkdirSync(tmp, { recursive: true });
    process.env.TMPDIR = tmp;
    const sandbox = await Sandbox.start({});
    const provider = makeProvider(sandbox.rpcUrl);
    return new Chain(sandbox, makeSigner(provider, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY));
  }

  /** A node can linger on teardown when a test failed with transfers still held, so bound the wait. */
  async stop(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), 20_000);
    });
    const result = await Promise.race([this.sandbox.tearDown().then(() => "done" as const), timeout]);
    clearTimeout(timer);
    if (result === "timeout") {
      (this.sandbox as unknown as { childProcess?: { kill(signal: string): void } }).childProcess?.kill("SIGKILL");
    }
  }

  get provider() {
    return this.root.account.provider;
  }

  /** Creates `<name>-<n>.sandbox` holding a fresh full-access key. */
  async account(name: string, near = 30n): Promise<SignerHandle & { private_key: string }> {
    const accountId = `${name}-${++this.counter}.${DEFAULT_ACCOUNT_ID}`;
    const keyPair = KeyPair.fromRandom("ed25519");
    await this.root.account.createSubAccount({
      accountOrPrefix: accountId,
      publicKey: keyPair.getPublicKey(),
      nearToTransfer: near * NEAR,
    });
    const privateKey = keyPair.toString();
    return { ...makeSigner(this.provider, accountId, privateKey), private_key: privateKey };
  }

  async deploy(account: SignerHandle, code: Uint8Array, init?: { method: string; args: object }): Promise<void> {
    const list = [actions.deployContract(code)];
    if (init) list.push(actions.functionCall(init.method, init.args, GAS_ADMIN, 0n));
    await account.account.signAndSendTransaction({ receiverId: account.account_id, actions: list, waitUntil: "FINAL" });
  }

  /** Adds a function-call key that can only call `methods` on `contractId`, and returns a signer using it. */
  async restrictedKey(account: SignerHandle, contractId: string, methods: string[]): Promise<SignerHandle & { private_key: string }> {
    const keyPair = KeyPair.fromRandom("ed25519");
    await account.account.addFunctionCallAccessKey({
      publicKey: keyPair.getPublicKey(),
      contractId,
      methodNames: methods,
      allowance: NEAR,
    });
    const privateKey = keyPair.toString();
    return { ...makeSigner(this.provider, account.account_id, privateKey), private_key: privateKey };
  }

  /** Adds another full-access key to the account, and returns a signer using it. */
  async extraFullKey(account: SignerHandle): Promise<SignerHandle> {
    const keyPair = KeyPair.fromRandom("ed25519");
    await account.account.addFullAccessKey(keyPair.getPublicKey());
    return makeSigner(this.provider, account.account_id, keyPair.toString() as KeyPairString);
  }

  async blockTimestampNs(): Promise<bigint> {
    const block = await this.provider.viewBlock({ finality: "final" });
    return BigInt(block.header.timestamp_nanosec);
  }

  /**
   * Back-dates every settled entry in a vault's rolling window by `deltaNs`, by editing the real
   * contract's state. Sandbox only. This is how tests reach a 7-day boundary: fast-forward only moves
   * about 0.3 chain seconds per block, which would take hours, and a special short-window build
   * would not be the wasm we deploy. See "Things a sandbox cannot do" in the README.
   *
   * The root state is borsh, and `rolling` is its third-from-last field:
   *   ... [u32 len][len * (u128 amount, u64 settled_at_ns)][u32 pending_count][u32 agent_pending_count]
   * The offsets are checked against what the entry must contain, so a layout change fails loudly.
   */
  async ageRolling(vaultId: string, deltaNs: bigint): Promise<number> {
    const stateKey = Buffer.from("STATE").toString("base64");
    const view = await this.provider.query<{ values: Array<{ key: string; value: string }> }>({
      request_type: "view_state",
      account_id: vaultId,
      prefix_base64: stateKey,
      finality: "final",
    } as never);
    const entry = view.values.find((item) => item.key === stateKey);
    if (!entry) throw new Error(`No STATE on ${vaultId}`);
    const state = Buffer.from(entry.value, "base64");

    const counterBytes = 8;
    const entryBytes = 24;
    let count = -1;
    for (let n = 0; n <= 512; n++) {
      const lengthAt = state.length - counterBytes - n * entryBytes - 4;
      if (lengthAt < 0) break;
      if (state.readUInt32LE(lengthAt) !== n) continue;
      let plausible = true;
      for (let i = 0; i < n; i++) {
        const settledAt = state.readBigUInt64LE(lengthAt + 4 + i * entryBytes + 16);
        if (settledAt < 1_000_000_000_000_000_000n || settledAt > FAR_FUTURE_NS) plausible = false;
      }
      if (plausible && n > count) count = n;
    }
    if (count < 0) throw new Error("Could not find the rolling window in the vault state. Did the Vault struct's field order change?");

    const firstEntry = state.length - counterBytes - count * entryBytes;
    for (let i = 0; i < count; i++) {
      const at = firstEntry + i * entryBytes + 16;
      state.writeBigUInt64LE(state.readBigUInt64LE(at) - deltaNs, at);
    }

    const response = await fetch(this.sandbox.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "patch",
        method: "sandbox_patch_state",
        params: { records: [{ Data: { account_id: vaultId, data_key: stateKey, value: state.toString("base64") } }] },
      }),
    });
    const body = (await response.json()) as { error?: unknown };
    if (body.error) throw new Error(`sandbox_patch_state failed: ${JSON.stringify(body.error)}`);

    // The patch applies in a coming block. Wait until a view sees it.
    const newest = state.readBigUInt64LE(firstEntry + (count - 1) * entryBytes + 16);
    for (let attempt = 0; attempt < 40 && count > 0; attempt++) {
      const check = await this.provider.query<{ values: Array<{ key: string; value: string }> }>({
        request_type: "view_state",
        account_id: vaultId,
        prefix_base64: stateKey,
        finality: "final",
      } as never);
      const current = Buffer.from(check.values.find((item) => item.key === stateKey)?.value ?? "", "base64");
      if (current.length === state.length && current.readBigUInt64LE(firstEntry + (count - 1) * entryBytes + 16) === newest) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return count;
  }
}

export interface WorldOptions {
  weekly_cap?: bigint;
  lifetime_cap?: bigint;
  vendor_cap?: bigint;
  funded?: bigint;
  policy_expires_at_ns?: bigint;
  capacities?: { max_vendors: number; max_payables: number; max_pending: number; max_rolling: number; max_operations: number };
  /** Use the scriptable fake token instead of real WUSD. */
  fake_token?: boolean;
  /** Register the vendor with the token. Default true. */
  register_vendor?: boolean;
  unpaused?: boolean;
  guardian?: boolean;
  approver?: boolean | SignerHandle;
  attestor?: boolean | SignerHandle;
  cooldown_policy?: { tier2_under_cap_ns: string; default_ns: string } | null;
  conservative_caps?: { weekly_cap_atomic: string; lifetime_cap_atomic: string; expires_at_ns: string } | null;
}

/** One complete tenant: real token (or fake), vault, owner, enrolled agent with a restricted key, one vendor. */
export class World {
  private payableCounter = 0;

  constructor(
    readonly chain: Chain,
    readonly token: SignerHandle,
    readonly vault: SignerHandle,
    readonly owner: SignerHandle,
    readonly agent: SignerHandle,
    /** The agent's restricted function-call key, and the key enrolled in the binding. */
    readonly agentKey: SignerHandle & { private_key: string },
    readonly vendor: SignerHandle,
    readonly guardian: SignerHandle | null,
    readonly admin: VaultAdmin,
    readonly fake: boolean,
    readonly approver: SignerHandle | null = null,
    readonly attestor: SignerHandle | null = null,
  ) {}

  get vaultId(): string {
    return this.vault.account_id;
  }

  async addPayable(amount: bigint, overrides: { not_before_ns?: bigint; expires_at_ns?: bigint; vendor_revision?: number; vendor_id?: string; payable_ref?: string } = {}): Promise<string> {
    const payable_ref = overrides.payable_ref ?? `pay_${++this.payableCounter}`;
    const now = await this.chain.blockTimestampNs();
    const notBefore = overrides.not_before_ns ?? now - 1_000_000_000n;
    const expires = overrides.expires_at_ns ?? FAR_FUTURE_NS;
    await this.admin.registerPayable({
      payable_ref,
      vendor_id: overrides.vendor_id ?? "vnd",
      vendor_revision: overrides.vendor_revision ?? 1,
      po_number: `PO-${payable_ref}`,
      invoice_number: `INV-${payable_ref}`,
      amount_atomic: amount.toString(),
      not_before_ns: notBefore.toString(),
      due_at_ns: expires.toString(),
      expires_at_ns: expires.toString(),
      evidence_commitment: DIGEST_A,
    });
    return payable_ref;
  }

  async revisions(): Promise<{ vendor: number; policy: number; binding: number }> {
    const vendors = await this.view<Array<{ vendor_id: string; revision: number }>>("get_vendors", {});
    const policy = await this.view<Policy>("get_policy");
    const binding = await this.view<{ revision: number } | null>("get_binding");
    return { vendor: vendors.find((v) => v.vendor_id === "vnd")?.revision ?? 0, policy: policy.revision, binding: binding?.revision ?? 0 };
  }

  async requestFor(payableRef: string, overrides: Partial<PaymentRequest> = {}): Promise<PaymentRequest> {
    const revisions = await this.revisions();
    return {
      payable_ref: payableRef,
      request_digest: DIGEST_A,
      expected_vendor_revision: revisions.vendor,
      expected_policy_revision: revisions.policy,
      expected_binding_revision: revisions.binding,
      ...overrides,
    };
  }

  /** Signs `request_payment` with `signer` (the enrolled restricted key by default) and returns its result. */
  async request(payableRef: string, overrides: Partial<PaymentRequest> = {}, signer: SignerHandle = this.agentKey): Promise<RequestResult> {
    const outcome = await callFinal(signer, {
      contract_id: this.vaultId,
      method: "request_payment",
      args: await this.requestFor(payableRef, overrides),
      gas: GAS_PAYMENT,
    });
    return outcome.value as RequestResult;
  }

  ownerPay(payableRef: string, signer: SignerHandle = this.owner): Promise<RequestResult> {
    return callFinal(signer, { contract_id: this.vaultId, method: "owner_pay", args: { payable_ref: payableRef }, deposit: ONE_YOCTO, gas: GAS_PAYMENT }).then((outcome) => outcome.value as RequestResult);
  }

  view<T>(method: string, args: object = {}): Promise<T> {
    return viewCall<T>(this.chain.provider, this.vaultId, method, args);
  }

  usage(): Promise<VaultUsage & { owner_paid_atomic: string; owner_reserved_atomic: string; withdrawn_atomic: string; withdrawal_in_flight_atomic: string; pending_count: number }> {
    return this.view("get_usage");
  }

  payable(payableRef: string): Promise<(Payable & { recipient: string; operation_id: string | null }) | null> {
    return this.view("get_payable", { payable_ref: payableRef });
  }

  operation(operationId: string): Promise<(Operation & { origin: string; request_digest: string | null }) | null> {
    return this.view("get_operation", { operation_id: operationId });
  }

  tokenBalance(accountId: string): Promise<bigint> {
    if (this.fake) return Promise.resolve(0n);
    return viewCall<string>(this.chain.provider, this.token.account_id, "ft_balance_of", { account_id: accountId }).then(BigInt);
  }

  /** Fake token only. */
  setTokenMode(mode: "ok" | "fail" | "weird" | "hold"): Promise<FinalOutcome> {
    return callFinal(this.token, { contract_id: this.token.account_id, method: "set_mode", args: { mode } });
  }

  /** Fake token only. Waits until the transfer is actually held. */
  async releaseHeld(outcome: "ok" | "fail"): Promise<void> {
    await callFinal(this.token, { contract_id: this.token.account_id, method: "release_held", args: { outcome } });
  }

  /** Fake token only. */
  transferCount(): Promise<number> {
    return viewCall<number>(this.chain.provider, this.token.account_id, "get_transfer_count");
  }

  /** Waits for a condition on chain state. */
  async waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }
}

/** Registers `account` with the token (storage deposit paid by `payer`). */
export async function registerWithToken(token: SignerHandle, payer: SignerHandle, account: string): Promise<void> {
  await callFinal(payer, { contract_id: token.account_id, method: "storage_deposit", args: { account_id: account, registration_only: true }, deposit: NEAR / 100n, gas: GAS_ADMIN });
}

export async function deployMockToken(chain: Chain, owner: SignerHandle): Promise<SignerHandle> {
  const token = await chain.account("wusd");
  await chain.deploy(token, wasm("mock-token"), { method: "new", args: { owner: owner.account_id } });
  return token;
}

/** Mints to `owner` and funds the vault through `ft_transfer_call`, the only route that credits it. */
export async function fundVault(token: SignerHandle, owner: SignerHandle, vaultId: string, amount: bigint): Promise<void> {
  await callFinal(owner, { contract_id: token.account_id, method: "mint", args: { account_id: owner.account_id, amount: amount.toString() } });
  await callFinal(owner, {
    contract_id: token.account_id,
    method: "ft_transfer_call",
    args: { receiver_id: vaultId, amount: amount.toString(), msg: "" },
    deposit: ONE_YOCTO,
    gas: GAS_PAYMENT,
  });
}

/** Builds a whole tenant. Pass an existing `token` and `owner` to share them across vaults. */
export async function makeWorld(chain: Chain, options: WorldOptions = {}, shared: { token?: SignerHandle; tokenOwner?: SignerHandle } = {}): Promise<World> {
  const owner = shared.tokenOwner ?? (await chain.account("owner"));
  const agent = await chain.account("agent");
  const vendor = await chain.account("vendor");
  const guardian = options.guardian ? await chain.account("guardian") : null;
  const approver = options.approver ? (typeof options.approver === "object" ? options.approver : await chain.account("approver")) : null;
  const attestor = options.attestor ? (typeof options.attestor === "object" ? options.attestor : await chain.account("attestor")) : null;
  const vault = await chain.account("vault", 30n);

  let token: SignerHandle;
  if (options.fake_token) {
    token = await chain.account("faketoken");
    await chain.deploy(token, wasm("test-proxy"));
  } else {
    token = shared.token ?? (await deployMockToken(chain, owner));
    await registerWithToken(token, owner, vault.account_id);
    if (options.register_vendor !== false) await registerWithToken(token, owner, vendor.account_id);
  }

  await chain.deploy(vault, wasm("vault"), {
    method: "new",
    args: {
      config: {
        owner: owner.account_id,
        guardian: guardian?.account_id ?? null,
        token_contract: token.account_id,
        token_decimals: 6,
        policy: {
          weekly_cap_atomic: (options.weekly_cap ?? 100_000n).toString(),
          lifetime_cap_atomic: (options.lifetime_cap ?? 1_000_000n).toString(),
          expires_at_ns: (options.policy_expires_at_ns ?? FAR_FUTURE_NS).toString(),
        },
        capacities: options.capacities ?? null,
        approver: approver?.account_id ?? null,
        attestor: attestor?.account_id ?? null,
        cooldown_policy: options.cooldown_policy ?? null,
        conservative_caps: options.conservative_caps ?? null,
      },
    },
  });

  const admin = new VaultAdmin(owner, vault.account_id);
  await admin.setVendor(
    {
      vendor_id: "vnd",
      display_name: "Larkspur Office Supply",
      account_id: vendor.account_id,
      per_payment_cap_atomic: (options.vendor_cap ?? 50_000n).toString(),
      active: true,
    },
    0,
  );

  const agentKey = await chain.restrictedKey(agent, vault.account_id, ["request_payment"]);
  await admin.activateAgent(
    {
      agent_account_id: agent.account_id,
      public_key: agentKey.public_key,
      manifest_digest: DIGEST_A,
      assessment_ref: "run_test",
      expires_at_ns: FAR_FUTURE_NS.toString(),
    },
    0,
  );

  const funded = options.funded ?? 10_000_000n;
  if (funded > 0n) {
    if (options.fake_token) {
      await callFinal(owner, { contract_id: token.account_id, method: "fund", args: { vault: vault.account_id, amount: funded.toString() } });
    } else {
      await fundVault(token, owner, vault.account_id, funded);
    }
  }
  if (options.unpaused !== false) await admin.unpause();
  return new World(chain, token, vault, owner, agent, agentKey, vendor, guardian, admin, options.fake_token === true, approver, attestor);
}

/** Runs a call that should panic, and returns the panic's stable code or message. */
export async function panicOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (error instanceof VaultExecutionError) return error.code ?? JSON.stringify(error.failure);
    throw error;
  }
  throw new Error("expected the call to panic");
}

/** Runs a call that NEAR should refuse before execution, and returns the reason. */
export async function refusalOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (error instanceof TransactionRefusedError) return error.reason;
    throw error;
  }
  throw new Error("expected NEAR to refuse the transaction");
}

/** funded = A + R + owner_reserved + S + owner_paid + withdrawn + withdrawal_in_flight */
export function accountedTotal(u: Awaited<ReturnType<World["usage"]>>): bigint {
  return (
    BigInt(u.balance_atomic) +
    BigInt(u.lifetime_reserved_atomic) +
    BigInt(u.owner_reserved_atomic) +
    BigInt(u.lifetime_settled_atomic) +
    BigInt(u.owner_paid_atomic) +
    BigInt(u.withdrawn_atomic) +
    BigInt(u.withdrawal_in_flight_atomic)
  );
}
