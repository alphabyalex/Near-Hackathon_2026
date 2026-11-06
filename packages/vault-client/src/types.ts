export interface ContractCall {
  readonly contractId: string;
  readonly methodName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly gas: bigint;
  readonly deposit: bigint;
}

export interface ContractView {
  readonly contractId: string;
  readonly methodName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface VaultTransport {
  call<T>(call: ContractCall): Promise<T>;
  view<T>(view: ContractView): Promise<T>;
}

export interface PaymentRequest {
  readonly payable_ref: string;
  readonly request_digest: string;
  readonly expected_policy_revision: number;
  readonly expected_vendor_revision: number;
  readonly expected_binding_revision: number;
}

export interface UsageView {
  readonly settled_agent_total_atomic: string;
  readonly reserved_agent_total_atomic: string;
  readonly owner_paid_total_atomic: string;
  readonly rolling_settled_atomic: string;
  readonly weekly_cap_atomic: string;
  readonly lifetime_ceiling_atomic: string;
  readonly recorded_balance_atomic: string;
  readonly available_balance_atomic: string;
  readonly pending_operations: number;
  readonly pending_agent_operations: number;
}

export interface VaultRejection {
  readonly code: string;
  readonly human_review: boolean;
  readonly payable_ref: string | null;
  readonly requested_amount_atomic: string | null;
  readonly policy_revision: number;
  readonly vendor_revision: number | null;
  readonly binding_revision: number | null;
  readonly usage: UsageView;
}

export type PayableStatus =
  | "OPEN"
  | "PENDING_AGENT"
  | "PENDING_OWNER"
  | "SETTLED"
  | "FAILED_KNOWN"
  | "RECONCILIATION";

export type OperationStatus =
  | "DISPATCHED"
  | "SETTLED"
  | "FAILED_KNOWN"
  | "RECONCILIATION";

export interface RequestAccepted {
  readonly accepted: true;
  readonly existing: boolean;
  readonly operation_id: string;
  readonly status: PayableStatus;
  readonly rejection: null;
}

export interface RequestRejected {
  readonly accepted: false;
  readonly existing: false;
  readonly operation_id: null;
  readonly status: null;
  readonly rejection: VaultRejection;
}

export type RequestResult = RequestAccepted | RequestRejected;

export interface PayableView {
  readonly payable_ref: string;
  readonly vendor_id: string;
  readonly vendor_revision: number;
  readonly recipient: string;
  readonly amount_atomic: string;
  readonly po_number: string;
  readonly not_before_ns: string;
  readonly due_at_ns: string;
  readonly expires_at_ns: string;
  readonly status: PayableStatus;
  readonly operation_id: string | null;
  readonly request_digest: string | null;
}

export interface OperationView {
  readonly operation_id: string;
  readonly actor: "AGENT" | "OWNER" | "WITHDRAWAL";
  readonly payable_ref: string | null;
  readonly request_digest: string | null;
  readonly amount_atomic: string;
  readonly recipient: string;
  readonly created_at_ns: string;
  readonly status: OperationStatus;
  readonly settled_at_ns: string | null;
  readonly failure_category: string | null;
}

export interface PolicyView {
  readonly weekly_cap_atomic: string;
  readonly lifetime_ceiling_atomic: string;
  readonly revision: number;
}

export interface VendorView {
  readonly vendor_id: string;
  readonly recipient: string;
  readonly per_payment_cap_atomic: string;
  readonly enabled: boolean;
  readonly revision: number;
}

export type SubmissionOutcome =
  | { readonly kind: "RESULT"; readonly result: RequestResult }
  | {
      readonly kind: "OBSERVATION_AMBIGUOUS";
      readonly payable: PayableView | null;
      readonly operation: OperationView | null;
      readonly cause: string;
      readonly retry_allowed: false;
    };
