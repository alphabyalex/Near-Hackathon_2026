import type {
  AgentBinding,
  Operation,
  Payable,
  PaymentRequest,
  Policy,
  RequestResult,
  VaultGateway,
  VaultRejection,
  VaultUsage,
} from "@spendgym/schemas";
import type { MockVault, MockWorld } from "../mock/seed.js";
import { NS_PER_DAY, type Clock } from "../time.js";

const WEEK_NS = 7n * NS_PER_DAY;

const reject = (rejection: VaultRejection): RequestResult => ({ ok: false, operation_id: null, rejection });

/**
 * In-memory stand-in for the vault contract so the API flow can run end to end.
 * It is not a model of the contract: Tharun's vault-sim and contracts are the source of truth.
 * Only agent payments count against caps; owner payments do not.
 */
export class MockVaultGateway implements VaultGateway {
  private nextOperation = 1;

  constructor(
    private readonly world: MockWorld,
    private readonly now: Clock,
  ) {}

  async requestPayment(vaultId: string, request: PaymentRequest): Promise<RequestResult> {
    const vault = this.world.vaults.get(vaultId);
    if (!vault) return reject("BAD_CALLER");
    if (vault.policy.paused) return reject("PAUSED");
    if (!vault.binding.enabled) return reject("BINDING_INACTIVE");

    const payable = vault.payables.get(request.payable_ref);
    if (!payable) return reject("UNKNOWN_PAYABLE");
    const lifecycle = this.lifecycleRejection(payable);
    if (lifecycle) return reject(lifecycle);

    const vendor = this.world.vendors.get(payable.vendor_id);
    if (
      !vendor ||
      request.expected_vendor_revision !== vendor.revision ||
      request.expected_policy_revision !== vault.policy.revision ||
      request.expected_binding_revision !== vault.binding.revision
    ) {
      return reject("STALE_REVISION");
    }

    const amount = BigInt(payable.amount_atomic);
    const usage = this.usageOf(vault);
    if (amount > BigInt(vendor.per_payment_cap_atomic)) return reject("OVER_VENDOR_CAP");
    const weeklyUsed = BigInt(usage.weekly_settled_atomic) + BigInt(usage.weekly_reserved_atomic);
    if (weeklyUsed + amount > BigInt(vault.policy.weekly_cap_atomic)) return reject("OVER_WEEKLY_CAP");
    const lifetimeUsed = BigInt(usage.lifetime_settled_atomic) + BigInt(usage.lifetime_reserved_atomic);
    if (lifetimeUsed + amount > BigInt(vault.policy.lifetime_cap_atomic)) return reject("OVER_LIFETIME_CAP");
    if (amount > vault.balance_atomic) return reject("INSUFFICIENT_BALANCE");

    return this.settle(vault, payable, vendor.account_id, "AGENT");
  }

  async ownerPay(vaultId: string, payableRef: string): Promise<RequestResult> {
    const vault = this.world.vaults.get(vaultId);
    if (!vault) return reject("BAD_CALLER");
    const payable = vault.payables.get(payableRef);
    if (!payable) return reject("UNKNOWN_PAYABLE");
    const lifecycle = this.lifecycleRejection(payable);
    if (lifecycle) return reject(lifecycle);
    if (BigInt(payable.amount_atomic) > vault.balance_atomic) return reject("INSUFFICIENT_BALANCE");
    const vendor = this.world.vendors.get(payable.vendor_id);
    if (!vendor) return reject("UNKNOWN_PAYABLE");
    return this.settle(vault, payable, vendor.account_id, "OWNER");
  }

  async getPayable(vaultId: string, payableRef: string): Promise<Payable | null> {
    return this.world.vaults.get(vaultId)?.payables.get(payableRef) ?? null;
  }

  async getOperation(vaultId: string, operationId: string): Promise<Operation | null> {
    return this.world.vaults.get(vaultId)?.operations.get(operationId)?.operation ?? null;
  }

  async getUsage(vaultId: string): Promise<VaultUsage> {
    return this.usageOf(this.vault(vaultId));
  }

  async getPolicy(vaultId: string): Promise<Policy> {
    return this.vault(vaultId).policy;
  }

  async getBinding(vaultId: string): Promise<AgentBinding | null> {
    return this.world.vaults.get(vaultId)?.binding ?? null;
  }

  async pause(vaultId: string): Promise<void> {
    const vault = this.vault(vaultId);
    vault.policy = { ...vault.policy, paused: true };
  }

  async revokeAgent(vaultId: string, agentAccountId: string): Promise<void> {
    const vault = this.vault(vaultId);
    if (vault.binding.agent_account_id !== agentAccountId) return;
    vault.binding = { ...vault.binding, enabled: false };
  }

  private vault(vaultId: string): MockVault {
    const vault = this.world.vaults.get(vaultId);
    if (!vault) throw new Error(`unknown vault ${vaultId}`);
    return vault;
  }

  private lifecycleRejection(payable: Payable): VaultRejection | null {
    if (payable.status === "SETTLED") return "ALREADY_PAID";
    if (payable.status === "PENDING") return "ALREADY_PENDING";
    if (payable.status !== "OPEN") return "PAYABLE_EXPIRED";
    const now = this.now();
    if (now < BigInt(payable.not_before_ns)) return "NOT_YET_PAYABLE";
    if (now > BigInt(payable.expires_at_ns)) return "PAYABLE_EXPIRED";
    return null;
  }

  private usageOf(vault: MockVault): VaultUsage {
    const weekStart = this.now() - WEEK_NS;
    const sums = { weeklySettled: 0n, weeklyReserved: 0n, lifetimeSettled: 0n, lifetimeReserved: 0n };
    for (const { operation, payer } of vault.operations.values()) {
      if (payer !== "AGENT") continue;
      const amount = BigInt(operation.amount_atomic);
      const inWeek = BigInt(operation.reserved_at_ns) >= weekStart;
      if (operation.status === "SETTLED") {
        sums.lifetimeSettled += amount;
        if (inWeek) sums.weeklySettled += amount;
      } else if (operation.status === "RESERVED" || operation.status === "OUTCOME_UNCERTAIN") {
        sums.lifetimeReserved += amount;
        if (inWeek) sums.weeklyReserved += amount;
      }
    }
    return {
      weekly_settled_atomic: sums.weeklySettled.toString(),
      weekly_reserved_atomic: sums.weeklyReserved.toString(),
      lifetime_settled_atomic: sums.lifetimeSettled.toString(),
      lifetime_reserved_atomic: sums.lifetimeReserved.toString(),
      balance_atomic: vault.balance_atomic.toString(),
    };
  }

  private settle(vault: MockVault, payable: Payable, recipient: string, payer: "AGENT" | "OWNER"): RequestResult {
    const now = this.now().toString();
    const operationId = `op_mock_${this.nextOperation++}`;
    vault.operations.set(operationId, {
      payer,
      operation: {
        operation_id: operationId,
        payable_ref: payable.payable_ref,
        amount_atomic: payable.amount_atomic,
        recipient,
        status: "SETTLED",
        attempt: 1,
        reserved_at_ns: now,
        resolved_at_ns: now,
        tx_hash: `mock-tx-${operationId}`,
      },
    });
    vault.balance_atomic -= BigInt(payable.amount_atomic);
    vault.payables.set(payable.payable_ref, { ...payable, status: "SETTLED" });
    return { ok: true, operation_id: operationId, rejection: null };
  }
}
