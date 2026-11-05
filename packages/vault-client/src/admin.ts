import { ONE_YOCTO, GAS_ADMIN, GAS_PAYMENT, callFinal, type FinalOutcome, type SignerHandle, type TransportOptions } from "./transport.js";

export interface VendorInput {
  vendor_id: string;
  display_name: string;
  account_id: string;
  per_payment_cap_atomic: string;
  active: boolean;
}

export interface PayableInput {
  payable_ref: string;
  vendor_id: string;
  vendor_revision: number;
  po_number: string;
  invoice_number: string | null;
  amount_atomic: string;
  not_before_ns: string;
  due_at_ns: string;
  expires_at_ns: string;
  evidence_commitment: string;
}

export interface PolicyInput {
  weekly_cap_atomic: string;
  lifetime_cap_atomic: string;
  expires_at_ns: string;
}

export interface BindingInput {
  agent_account_id: string;
  public_key: string;
  manifest_digest: string;
  assessment_ref: string;
  expires_at_ns: string;
}

/**
 * Owner-signed vault methods that are not on `VaultGateway`, for scripts and tests. The money-moving
 * and limit-raising ones attach the 1 yocto that proves a full-access key signed them.
 */
export class VaultAdmin {
  constructor(
    private readonly owner: SignerHandle,
    private readonly vaultId: string,
    private readonly options: TransportOptions = {},
  ) {}

  private call(method: string, args: object, deposit: bigint = ONE_YOCTO, gas: bigint = GAS_ADMIN): Promise<FinalOutcome> {
    return callFinal(this.owner, { contract_id: this.vaultId, method, args, deposit, gas }, this.options);
  }

  setVendor(vendor: VendorInput, expectedRevision: number): Promise<FinalOutcome> {
    return this.call("set_vendor", { vendor, expected_revision: expectedRevision });
  }

  registerPayable(payable: PayableInput): Promise<FinalOutcome> {
    return this.call("register_payable", { payable });
  }

  cancelPayable(payableRef: string): Promise<FinalOutcome> {
    return this.call("cancel_payable", { payable_ref: payableRef });
  }

  reopenFailedPayable(payableRef: string): Promise<FinalOutcome> {
    return this.call("reopen_failed_payable", { payable_ref: payableRef });
  }

  setPolicy(change: PolicyInput, expectedRevision: number): Promise<FinalOutcome> {
    return this.call("set_policy", { change, expected_revision: expectedRevision });
  }

  activateAgent(binding: BindingInput, expectedRevision: number): Promise<FinalOutcome> {
    return this.call("activate_agent", { binding, expected_revision: expectedRevision });
  }

  revokeAgent(agentAccountId: string): Promise<FinalOutcome> {
    return this.call("revoke_agent", { agent_account_id: agentAccountId }, 0n);
  }

  pause(): Promise<FinalOutcome> {
    return this.call("pause", {}, 0n);
  }

  unpause(): Promise<FinalOutcome> {
    return this.call("unpause", {});
  }

  ownerPay(payableRef: string): Promise<FinalOutcome> {
    return this.call("owner_pay", { payable_ref: payableRef }, ONE_YOCTO, GAS_PAYMENT);
  }

  withdrawAvailable(amountAtomic: string): Promise<FinalOutcome> {
    return this.call("withdraw_available", { amount: amountAtomic }, ONE_YOCTO, GAS_PAYMENT);
  }

  reconcileOperation(operationId: string, settled: boolean): Promise<FinalOutcome> {
    return this.call("reconcile_operation", { operation_id: operationId, settled });
  }

  reconcileWithdrawal(settled: boolean): Promise<FinalOutcome> {
    return this.call("reconcile_withdrawal", { settled });
  }
}
