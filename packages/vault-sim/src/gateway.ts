import type { AgentBinding, Operation, Payable, PaymentRequest, Policy, RequestResult, VaultGateway, VaultUsage } from "@redline/schemas";
import { VaultSim } from "./vault-sim.js";

/**
 * `VaultGateway` over simulators, so the Gym can drop it in wherever the API uses the real client.
 * It signs as the enrolled agent, which is what a real signer holding the agent key would do.
 * To test other callers, call `VaultSim.requestPayment` directly.
 */
export class SimVaultGateway implements VaultGateway {
  private readonly vaults = new Map<string, VaultSim>();

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

  async revokeAgent(vaultId: string, agentAccountId: string): Promise<void> {
    const vault = this.vault(vaultId);
    vault.revokeAgent(vault.owner, agentAccountId);
  }

  private vault(vaultId: string): VaultSim {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new Error(`unknown vault ${vaultId}`);
    return vault;
  }
}
