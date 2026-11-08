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
  expected_endpoint_revision?: number | null;
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

  proposeEndpoint(vendorId: string, account: string, evidenceTier: string, evidenceDigest: string): Promise<FinalOutcome> {
    return this.call("propose_endpoint", {
      vendor_id: vendorId,
      account,
      evidence_tier: evidenceTier,
      evidence_digest: evidenceDigest,
    });
  }

  approveEndpoint(
    vendorId: string,
    revision: number,
    approvalDigest: string,
    expiryNs?: string,
    signer?: SignerHandle,
  ): Promise<FinalOutcome> {
    const handle = signer ?? this.owner;
    return callFinal(
      handle,
      {
        contract_id: this.vaultId,
        method: "approve_endpoint",
        args: {
          vendor_id: vendorId,
          revision,
          approval_digest: approvalDigest,
          expiry_ns: expiryNs ?? null,
        },
        deposit: 0n,
        gas: GAS_ADMIN,
      },
      this.options,
    );
  }

  activateEndpoint(vendorId: string, revision: number): Promise<FinalOutcome> {
    return this.call("activate_endpoint", { vendor_id: vendorId, revision }, 0n);
  }

  rejectEndpoint(vendorId: string, revision: number, signer?: SignerHandle): Promise<FinalOutcome> {
    const handle = signer ?? this.owner;
    return callFinal(
      handle,
      {
        contract_id: this.vaultId,
        method: "reject_endpoint",
        args: { vendor_id: vendorId, revision },
        deposit: 0n,
        gas: GAS_ADMIN,
      },
      this.options,
    );
  }

  revokeEndpoint(vendorId: string, revision: number, signer?: SignerHandle): Promise<FinalOutcome> {
    const handle = signer ?? this.owner;
    return callFinal(
      handle,
      {
        contract_id: this.vaultId,
        method: "revoke_endpoint",
        args: { vendor_id: vendorId, revision },
        deposit: 0n,
        gas: GAS_ADMIN,
      },
      this.options,
    );
  }

  raiseBindingCaps(): Promise<FinalOutcome> {
    return this.call("raise_binding_caps", {});
  }
}
