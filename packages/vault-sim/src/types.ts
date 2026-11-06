export type AtomicAmount = bigint;
export type Nanoseconds = bigint;

export const SEVEN_DAYS_NS = 7n * 24n * 60n * 60n * 1_000_000_000n;

export const PayableStatus = {
  OPEN: "OPEN",
  PENDING_AGENT: "PENDING_AGENT",
  PENDING_OWNER: "PENDING_OWNER",
  SETTLED: "SETTLED",
  FAILED_KNOWN: "FAILED_KNOWN",
  RECONCILIATION: "RECONCILIATION",
} as const;
export type PayableStatus = (typeof PayableStatus)[keyof typeof PayableStatus];

export const OperationStatus = {
  DISPATCHED: "DISPATCHED",
  SETTLED: "SETTLED",
  FAILED_KNOWN: "FAILED_KNOWN",
  RECONCILIATION: "RECONCILIATION",
} as const;
export type OperationStatus = (typeof OperationStatus)[keyof typeof OperationStatus];

export const OperationActor = {
  AGENT: "AGENT",
  OWNER: "OWNER",
  WITHDRAWAL: "WITHDRAWAL",
} as const;
export type OperationActor = (typeof OperationActor)[keyof typeof OperationActor];

export const SettlementOutcome = {
  SUCCESS: "SUCCESS",
  KNOWN_FAILURE: "KNOWN_FAILURE",
  AMBIGUOUS: "AMBIGUOUS",
} as const;
export type SettlementOutcome = (typeof SettlementOutcome)[keyof typeof SettlementOutcome];

export const VaultRejectionCode = {
  VAULT_PAUSED: "VAULT_PAUSED",
  NON_ZERO_ATTACHED_DEPOSIT: "NON_ZERO_ATTACHED_DEPOSIT",
  CALLER_SIGNER_MISMATCH: "CALLER_SIGNER_MISMATCH",
  AGENT_ACCOUNT_MISMATCH: "AGENT_ACCOUNT_MISMATCH",
  AGENT_KEY_MISMATCH: "AGENT_KEY_MISMATCH",
  AGENT_BINDING_DISABLED: "AGENT_BINDING_DISABLED",
  AGENT_BINDING_NOT_YET_VALID: "AGENT_BINDING_NOT_YET_VALID",
  AGENT_BINDING_EXPIRED: "AGENT_BINDING_EXPIRED",
  STALE_BINDING_REVISION: "STALE_BINDING_REVISION",
  UNKNOWN_PAYABLE: "UNKNOWN_PAYABLE",
  PAYABLE_NOT_OPEN: "PAYABLE_NOT_OPEN",
  PAYABLE_TOO_EARLY: "PAYABLE_TOO_EARLY",
  PAYABLE_EXPIRED: "PAYABLE_EXPIRED",
  REQUEST_DIGEST_CONFLICT: "REQUEST_DIGEST_CONFLICT",
  UNKNOWN_VENDOR: "UNKNOWN_VENDOR",
  VENDOR_DISABLED: "VENDOR_DISABLED",
  STALE_VENDOR_REVISION: "STALE_VENDOR_REVISION",
  STALE_POLICY_REVISION: "STALE_POLICY_REVISION",
  AMOUNT_OVER_VENDOR_CAP: "AMOUNT_OVER_VENDOR_CAP",
  WEEKLY_CAP_EXCEEDED: "WEEKLY_CAP_EXCEEDED",
  LIFETIME_CEILING_EXCEEDED: "LIFETIME_CEILING_EXCEEDED",
  INSUFFICIENT_RECORDED_BALANCE: "INSUFFICIENT_RECORDED_BALANCE",
  PENDING_CAPACITY_EXHAUSTED: "PENDING_CAPACITY_EXHAUSTED",
  ROLLING_CAPACITY_EXHAUSTED: "ROLLING_CAPACITY_EXHAUSTED",
  OPERATION_CAPACITY_EXHAUSTED: "OPERATION_CAPACITY_EXHAUSTED",
  INVALID_REQUEST_DIGEST: "INVALID_REQUEST_DIGEST",
} as const;
export type VaultRejectionCode =
  (typeof VaultRejectionCode)[keyof typeof VaultRejectionCode];

export interface CapacityLimits {
  readonly maxVendors: number;
  readonly maxPayables: number;
  readonly maxOperations: number;
  readonly maxPendingOperations: number;
  readonly maxRollingEntries: number;
  readonly maxIdentifierLength: number;
  readonly maxDigestLength: number;
}

export interface VaultConfig {
  readonly vaultId: string;
  readonly ownerId: string;
  readonly guardianId?: string;
  readonly tokenContractId: string;
  readonly tokenDecimals: number;
  readonly weeklyCapAtomic: AtomicAmount;
  readonly lifetimeCeilingAtomic: AtomicAmount;
  readonly capacities: CapacityLimits;
}

export interface CallContext {
  readonly currentAccountId: string;
  readonly predecessorAccountId: string;
  readonly signerAccountId: string;
  readonly signerPublicKey: string;
  readonly attachedDepositYocto: bigint;
  readonly nowNs: Nanoseconds;
}

export interface OwnerContext {
  readonly predecessorAccountId: string;
  readonly nowNs: Nanoseconds;
}

export interface VendorInput {
  readonly vendorId: string;
  readonly recipient: string;
  readonly perPaymentCapAtomic: AtomicAmount;
  readonly enabled: boolean;
}

export interface Vendor extends VendorInput {
  readonly revision: number;
}

export interface PayableInput {
  readonly payableRef: string;
  readonly vendorId: string;
  readonly vendorRevision: number;
  readonly amountAtomic: AtomicAmount;
  readonly poNumber: string;
  readonly notBeforeNs: Nanoseconds;
  readonly dueAtNs: Nanoseconds;
  readonly expiresAtNs: Nanoseconds;
}

export interface Payable extends PayableInput {
  readonly recipient: string;
  status: PayableStatus;
  operationId?: number;
  requestDigest?: string;
}

export interface Policy {
  readonly weeklyCapAtomic: AtomicAmount;
  readonly lifetimeCeilingAtomic: AtomicAmount;
  readonly revision: number;
}

export interface AgentBindingInput {
  readonly accountId: string;
  readonly publicKey: string;
  readonly manifestDigest: string;
  readonly validFromNs: Nanoseconds;
  readonly expiresAtNs: Nanoseconds;
}

export interface AgentBinding extends AgentBindingInput {
  readonly enabled: boolean;
  readonly revision: number;
}

export interface PaymentRequest {
  readonly payableRef: string;
  readonly requestDigest: string;
  readonly expectedPolicyRevision: number;
  readonly expectedVendorRevision: number;
  readonly expectedBindingRevision: number;
}

export interface RollingEntry {
  readonly operationId: number;
  readonly amountAtomic: AtomicAmount;
  readonly settledAtNs: Nanoseconds;
}

export interface Operation {
  readonly operationId: number;
  readonly actor: OperationActor;
  readonly payableRef?: string;
  readonly requestDigest?: string;
  readonly amountAtomic: AtomicAmount;
  readonly recipient: string;
  readonly createdAtNs: Nanoseconds;
  status: OperationStatus;
  settledAtNs?: Nanoseconds;
  failureCategory?: string;
}

export interface Usage {
  readonly settledAgentTotalAtomic: AtomicAmount;
  readonly reservedAgentTotalAtomic: AtomicAmount;
  readonly ownerPaidTotalAtomic: AtomicAmount;
  readonly rollingSettledAtomic: AtomicAmount;
  readonly weeklyCapAtomic: AtomicAmount;
  readonly lifetimeCeilingAtomic: AtomicAmount;
  readonly recordedBalanceAtomic: AtomicAmount;
  readonly availableBalanceAtomic: AtomicAmount;
  readonly pendingOperations: number;
  readonly pendingAgentOperations: number;
}

export interface VaultRejection {
  readonly code: VaultRejectionCode;
  readonly humanReview: true;
  readonly payableRef?: string;
  readonly requestedAmountAtomic?: AtomicAmount;
  readonly policyRevision: number;
  readonly vendorRevision?: number;
  readonly bindingRevision?: number;
  readonly usage: Usage;
}

export interface RequestAccepted {
  readonly accepted: true;
  readonly existing: boolean;
  readonly operationId: number;
  readonly status: PayableStatus;
}

export interface RequestRejected {
  readonly accepted: false;
  readonly rejection: VaultRejection;
}

export type RequestResult = RequestAccepted | RequestRejected;

export interface SimulatorSnapshot {
  readonly paused: boolean;
  readonly policy: {
    readonly weeklyCapAtomic: string;
    readonly lifetimeCeilingAtomic: string;
    readonly revision: number;
  };
  readonly settledAgentTotalAtomic: string;
  readonly reservedAgentTotalAtomic: string;
  readonly ownerPaidTotalAtomic: string;
  readonly recordedBalanceAtomic: string;
  readonly availableBalanceAtomic: string;
  readonly pendingOperations: number;
  readonly pendingAgentOperations: number;
  readonly vendors: readonly unknown[];
  readonly payables: readonly unknown[];
  readonly operations: readonly unknown[];
  readonly rollingEntries: readonly unknown[];
}
