import type {
  AgentBinding,
  Operation,
  Payable,
  PaymentRequest,
  Policy,
  RequestResult,
  VaultGateway,
  VaultUsage,
  Vendor,
} from "@redline/schemas";
import { VaultSim } from "./vault-sim.js";
import type { SimVendor } from "./types.js";

/**
 * `VaultGateway` over simulators, so the Gym can drop it in wherever the API uses the real client.
 * It signs as the enrolled agent, which is what a real signer holding the agent key would do.
 * To test other callers, call `VaultSim.requestPayment` directly.
 */
export class SimVaultGateway implements VaultGateway {
  protected readonly vaults = new Map<string, VaultSim>();

  constructor(vaults: VaultSim[]) {
    for (const vault of vaults) this.vaults.set(vault.vaultId, vault);
  }

  async requestPayment(vaultId: string, request: PaymentRequest): Promise<RequestResult> {
    const vault = this.vault(vaultId);
    const binding = vault.getBinding();
    if (!binding) return { ok: false, operation_id: null, rejection: "BAD_CALLER" };
    return vault.requestPayment(
      { predecessor: binding.agent_account_id, signer: binding.agent_account_id, public_key: binding.public_key },
      request,
    );
  }

  async ownerPay(vaultId: string, payableRef: string): Promise<RequestResult> {
    const vault = this.vault(vaultId);
    return vault.ownerPay(vault.owner, payableRef);
  }

  async getPayable(vaultId: string, payableRef: string): Promise<Payable | null> {
    return this.vault(vaultId).getPayable(payableRef);
  }

  async getOperation(vaultId: string, operationId: string): Promise<Operation | null> {
    return this.vault(vaultId).getOperation(operationId);
  }

  async getUsage(vaultId: string): Promise<VaultUsage> {
    return this.vault(vaultId).getUsage();
  }

  async getPolicy(vaultId: string): Promise<Policy> {
    return this.vault(vaultId).getPolicy();
  }

  async getBinding(vaultId: string): Promise<AgentBinding | null> {
    return this.vault(vaultId).getBinding();
  }

  async pause(vaultId: string): Promise<void> {
    const vault = this.vault(vaultId);
    vault.pause(vault.owner);
  }

  async unpause(vaultId: string): Promise<void> {
    const vault = this.vault(vaultId);
    vault.unpause(vault.owner);
  }

  async revokeAgent(vaultId: string, agentAccountId: string): Promise<void> {
    const vault = this.vault(vaultId);
    vault.revokeAgent(vault.owner, agentAccountId);
  }

  async proposeEndpoint(
    vaultId: string,
    caller: string,
    vendorId: string,
    account: string,
    evidenceTier: string,
    evidenceDigest: string,
  ): Promise<number> {
    return this.vault(vaultId).proposeEndpoint(caller, vendorId, account, evidenceTier, evidenceDigest);
  }

  async approveEndpoint(
    vaultId: string,
    caller: string,
    vendorId: string,
    revision: number,
    approvalDigest: string,
    expiryNs?: string | bigint,
  ): Promise<void> {
    this.vault(vaultId).approveEndpoint(caller, vendorId, revision, approvalDigest, expiryNs);
  }

  async activateEndpoint(vaultId: string, vendorId: string, revision: number): Promise<void> {
    this.vault(vaultId).activateEndpoint(vendorId, revision);
  }

  async rejectEndpoint(vaultId: string, caller: string, vendorId: string, revision: number): Promise<void> {
    this.vault(vaultId).rejectEndpoint(caller, vendorId, revision);
  }

  async revokeEndpoint(vaultId: string, caller: string, vendorId: string, revision: number): Promise<void> {
    this.vault(vaultId).revokeEndpoint(caller, vendorId, revision);
  }

  async raiseBindingCaps(vaultId: string, caller: string): Promise<void> {
    this.vault(vaultId).raiseBindingCaps(caller);
  }

  async getVendor(vaultId: string, vendorId: string): Promise<SimVendor | null> {
    return this.vault(vaultId).getVendor(vendorId);
  }

  async getVendors(vaultId: string, fromIndex = 0, limit = 100): Promise<SimVendor[]> {
    return this.vault(vaultId).getVendors(fromIndex, limit);
  }

  protected vault(vaultId: string): VaultSim {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new Error(`unknown vault ${vaultId}`);
    return vault;
  }
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

export interface GymVaultSim extends VaultGateway {
  transfers(): readonly SimTransfer[];
  setNow(ns: bigint): void;
}

/**
 * Adapter matching the Gym's VaultSim interface: provides VaultGateway
 * plus a transfer log and clock controls.
 */
export class GymSimVaultGateway extends SimVaultGateway implements GymVaultSim {
  private readonly transferLog: SimTransfer[] = [];

  constructor(vaults: VaultSim[]) {
    super(vaults);
  }

  transfers(): readonly SimTransfer[] {
    return [...this.transferLog];
  }

  setNow(ns: bigint): void {
    for (const vault of this.vaults.values()) {
      vault.setNow(ns);
    }
  }

  override async requestPayment(vaultId: string, request: PaymentRequest): Promise<RequestResult> {
    const vault = this.vault(vaultId);
    const payableBefore = vault.getPayable(request.payable_ref);
    const result = await super.requestPayment(vaultId, request);
    if (result.ok && result.operation_id && payableBefore) {
      this.transferLog.push({
        operation_id: result.operation_id,
        vault_id: vaultId,
        payable_ref: request.payable_ref,
        recipient: payableBefore.recipient,
        amount_atomic: payableBefore.amount_atomic,
        at_ns: vault.now().toString(),
        payer: "AGENT",
      });
    }
    return result;
  }

  override async ownerPay(vaultId: string, payableRef: string): Promise<RequestResult> {
    const vault = this.vault(vaultId);
    const payableBefore = vault.getPayable(payableRef);
    const result = await super.ownerPay(vaultId, payableRef);
    if (result.ok && result.operation_id && payableBefore) {
      this.transferLog.push({
        operation_id: result.operation_id,
        vault_id: vaultId,
        payable_ref: payableRef,
        recipient: payableBefore.recipient,
        amount_atomic: payableBefore.amount_atomic,
        at_ns: vault.now().toString(),
        payer: "OWNER",
      });
    }
    return result;
  }
}

/**
 * Factory matching Lucy's VaultSimFactory in services/evaluator/src/sim.ts.
 */
export function createGymVaultSim(inits: VaultSimInit[], nowNs: bigint): GymVaultSim {
  const simVaults: VaultSim[] = [];

  for (const init of inits) {
    const owner = `owner.${init.vault_id}`;
    const tokenContract = "redl.redline-labs.testnet";
    const sim = new VaultSim({
      vault_id: init.vault_id,
      owner,
      token_contract: tokenContract,
      policy: init.policy,
      now_ns: nowNs.toString(),
    });

    // Fund the available balance
    sim.ftOnTransfer(tokenContract, owner, init.balance_atomic);

    // Register vendors
    for (const vendor of init.vendors) {
      sim.setVendor(
        owner,
        {
          vendor_id: vendor.vendor_id,
          display_name: vendor.display_name,
          account_id: vendor.account_id,
          per_payment_cap_atomic: vendor.per_payment_cap_atomic,
          active: vendor.active,
        },
        vendor.revision - 1,
      );
    }

    // Register payables
    for (const payable of init.payables) {
      sim.registerPayable(owner, {
        payable_ref: payable.payable_ref,
        vendor_id: payable.vendor_id,
        vendor_revision: payable.vendor_revision,
        invoice_number: payable.invoice_number,
        po_number: payable.po_number,
        evidence_commitment: payable.evidence_commitment,
        amount_atomic: payable.amount_atomic,
        not_before_ns: payable.not_before_ns,
        expires_at_ns: payable.expires_at_ns,
        due_at_ns: payable.due_at_ns,
      });
    }

    // Configure agent binding
    sim.activateAgent(
      owner,
      {
        agent_account_id: `agent.${init.vault_id}`,
        public_key: "ed25519:SimulatedKeyNotReal",
        manifest_digest: `sha256:${"0".repeat(64)}`,
        assessment_ref: "sim",
        expires_at_ns: init.policy.expires_at_ns,
      },
      init.binding_revision - 1,
    );

    if (!init.binding_enabled) {
      sim.revokeAgent(owner, `agent.${init.vault_id}`);
    }

    if (!init.policy.paused) {
      sim.unpause(owner);
    }

    simVaults.push(sim);
  }

  return new GymSimVaultGateway(simVaults);
}
