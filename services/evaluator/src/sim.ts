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
  Vendor,
} from "@redline/schemas";

/**
 * What the Gym needs from a vault simulator: the VaultGateway every other caller uses, plus a
 * transfer log and a clock. Tharun's packages/vault-sim is the real implementation; until it
 * lands, createStubVaultSim below mirrors the rules as we understand them from CONTEXT.md.
 * The oracle never trusts this object: it re-checks every transfer against the fixture.
 */
export interface VaultSim extends VaultGateway {
  transfers(): readonly SimTransfer[];
  setNow(ns: bigint): void;
}

export interface SimTransfer {
  operation_id: string;
  vault_id: string;
  payable_ref: string;
  recipient: string;
  amount_atomic: string;
  at_ns: string;
  payer: "AGENT" | "OWNER";
}

export interface VaultSimInit {
  vault_id: string;
  policy: Policy;
  binding_revision: number;
  binding_enabled: boolean;
  vendors: Vendor[];
  payables: Payable[];
  balance_atomic: string;
  weekly_settled_atomic: string;
  lifetime_settled_atomic: string;
}

export type VaultSimFactory = (vaults: VaultSimInit[], nowNs: bigint) => VaultSim;

interface VaultState {
  policy: Policy;
  binding: AgentBinding;
  vendors: Map<string, Vendor>;
  payables: Map<string, Payable>;
  operations: Map<string, Operation>;
  balance: bigint;
  weekly: bigint;
  lifetime: bigint;
}

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Stub with the same interface as the planned vault-sim. Simplifications, all listed in
 * docs/LIMITATIONS.md: settlement is instant (no RESERVED step), the 7 day window never ages
 * out during a run, and an inactive vendor is reported as STALE_REVISION.
 */
export const createStubVaultSim: VaultSimFactory = (inits, nowNs) => {
  let now = nowNs;
  let opSeq = 0;
  const log: SimTransfer[] = [];
  const vaults = new Map<string, VaultState>();
  for (const i of inits) {
    vaults.set(i.vault_id, {
      policy: clone(i.policy),
      binding: {
        agent_account_id: `agent.${i.vault_id}`,
        public_key: "ed25519:SimulatedKeyNotReal",
        manifest_digest: `sha256:${"0".repeat(64)}`,
        assessment_ref: "sim",
        revision: i.binding_revision,
        expires_at_ns: i.policy.expires_at_ns,
        enabled: i.binding_enabled,
      },
      vendors: new Map(i.vendors.map((v) => [v.vendor_id, clone(v)])),
      payables: new Map(i.payables.map((p) => [p.payable_ref, clone(p)])),
      operations: new Map(),
      balance: BigInt(i.balance_atomic),
      weekly: BigInt(i.weekly_settled_atomic),
      lifetime: BigInt(i.lifetime_settled_atomic),
    });
  }

  const vault = (id: string): VaultState => {
    const v = vaults.get(id);
    if (!v) throw new Error(`sim: unknown vault ${id}`);
    return v;
  };
  const reject = (r: VaultRejection): RequestResult => ({ ok: false, operation_id: null, rejection: r });

  const settle = (vaultId: string, v: VaultState, p: Payable, vendor: Vendor, payer: SimTransfer["payer"]): RequestResult => {
    const amount = BigInt(p.amount_atomic);
    opSeq += 1;
    const operation_id = `simop_${opSeq}`;
    p.status = "SETTLED";
    v.balance -= amount;
    if (payer === "AGENT") {
      v.weekly += amount;
      v.lifetime += amount;
    }
    v.operations.set(operation_id, {
      operation_id,
      payable_ref: p.payable_ref,
      amount_atomic: p.amount_atomic,
      recipient: vendor.account_id,
      status: "SETTLED",
      attempt: 1,
      reserved_at_ns: now.toString(),
      resolved_at_ns: now.toString(),
      tx_hash: `sim-tx-${operation_id}`,
    });
    log.push({ operation_id, vault_id: vaultId, payable_ref: p.payable_ref, recipient: vendor.account_id, amount_atomic: p.amount_atomic, at_ns: now.toString(), payer });
    return { ok: true, operation_id, rejection: null };
  };

  /** Checks shared by agent and owner paths: the payable must exist and be payable now. */
  const payableChecks = (v: VaultState, ref: string): { p: Payable; vendor: Vendor } | VaultRejection => {
    const p = v.payables.get(ref);
    if (!p || p.status === "CANCELLED") return "UNKNOWN_PAYABLE";
    if (p.status === "SETTLED") return "ALREADY_PAID";
    if (p.status === "PENDING") return "ALREADY_PENDING";
    if (p.status === "EXPIRED" || now > BigInt(p.expires_at_ns)) return "PAYABLE_EXPIRED";
    if (now < BigInt(p.not_before_ns)) return "NOT_YET_PAYABLE";
    const vendor = v.vendors.get(p.vendor_id);
    if (!vendor || !vendor.active || vendor.revision !== p.vendor_revision) return "STALE_REVISION";
    return { p, vendor };
  };

  return {
    async requestPayment(vaultId, req: PaymentRequest) {
      const v = vaults.get(vaultId);
      if (!v) return reject("BAD_CALLER");
      if (v.policy.paused) return reject("PAUSED");
      if (!v.binding.enabled || now > BigInt(v.binding.expires_at_ns) || now > BigInt(v.policy.expires_at_ns)) return reject("BINDING_INACTIVE");
      const c = payableChecks(v, req.payable_ref);
      if (typeof c === "string") return reject(c);
      const { p, vendor } = c;
      if (
        req.expected_vendor_revision !== vendor.revision ||
        req.expected_policy_revision !== v.policy.revision ||
        req.expected_binding_revision !== v.binding.revision
      )
        return reject("STALE_REVISION");
      const amount = BigInt(p.amount_atomic);
      if (amount > BigInt(vendor.per_payment_cap_atomic)) return reject("OVER_VENDOR_CAP");
      if (v.weekly + amount > BigInt(v.policy.weekly_cap_atomic)) return reject("OVER_WEEKLY_CAP");
      if (v.lifetime + amount > BigInt(v.policy.lifetime_cap_atomic)) return reject("OVER_LIFETIME_CAP");
      if (v.balance < amount) return reject("INSUFFICIENT_BALANCE");
      return settle(vaultId, v, p, vendor, "AGENT");
    },
    async ownerPay(vaultId, payableRef) {
      const v = vault(vaultId);
      const c = payableChecks(v, payableRef);
      if (typeof c === "string") return reject(c);
      if (v.balance < BigInt(c.p.amount_atomic)) return reject("INSUFFICIENT_BALANCE");
      return settle(vaultId, v, c.p, c.vendor, "OWNER");
    },
    async getPayable(vaultId, ref) {
      const p = vault(vaultId).payables.get(ref);
      return p ? clone(p) : null;
    },
    async getOperation(vaultId, id) {
      const o = vault(vaultId).operations.get(id);
      return o ? clone(o) : null;
    },
    async getUsage(vaultId): Promise<VaultUsage> {
      const v = vault(vaultId);
      return {
        weekly_settled_atomic: v.weekly.toString(),
        weekly_reserved_atomic: "0",
        lifetime_settled_atomic: v.lifetime.toString(),
        lifetime_reserved_atomic: "0",
        balance_atomic: v.balance.toString(),
      };
    },
    async getPolicy(vaultId) {
      return clone(vault(vaultId).policy);
    },
    async getBinding(vaultId) {
      return clone(vault(vaultId).binding);
    },
    async pause(vaultId) {
      vault(vaultId).policy.paused = true;
    },
    async revokeAgent(vaultId) {
      vault(vaultId).binding.enabled = false;
    },
    transfers: () => log.map(clone),
    setNow(ns) {
      now = ns;
    },
  };
};
