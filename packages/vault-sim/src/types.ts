import type { Operation, Payable, Vendor, VaultUsage } from "@wardline/schemas";

export const ROLLING_WINDOW_NS = 7n * 24n * 60n * 60n * 1_000_000_000n;
export const RECONCILE_AFTER_NS = 60n * 60n * 1_000_000_000n;

export interface Capacities {
  max_vendors: number;
  max_payables: number;
  max_pending: number;
  max_rolling: number;
  max_operations: number;
}

export const DEFAULT_CAPACITIES: Capacities = {
  max_vendors: 64,
  max_payables: 1024,
  max_pending: 32,
  max_rolling: 256,
  max_operations: 2048,
};

export const HARD_LIMITS: Capacities = {
  max_vendors: 128,
  max_payables: 4096,
  max_pending: 64,
  max_rolling: 512,
  max_operations: 8192,
};

export interface PolicyInput {
  weekly_cap_atomic: string;
  lifetime_cap_atomic: string;
  expires_at_ns: string;
}

export interface VaultSimConfig {
  vault_id: string;
  owner: string;
  guardian?: string | null;
  token_contract: string;
  token_decimals?: number;
  policy: PolicyInput;
  capacities?: Capacities;
  /** Start time of the simulated clock, in nanoseconds. */
  now_ns: string | bigint;
  /**
   * Accounts registered with the token. A transfer to anyone else fails, like a real NEP-141.
   * Defaults to "all", which never fails a transfer.
   */
  token_registered?: "all" | string[];
  /**
   * When true (default), a reservation resolves immediately through the token model.
   * When false, operations stay RESERVED until `resolveOperation`, so tests can model pending states.
   */
  auto_resolve?: boolean;
}

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

export interface BindingInput {
  agent_account_id: string;
  public_key: string;
  manifest_digest: string;
  assessment_ref: string;
  expires_at_ns: string;
}

/** Who signed the transaction. On a direct call all three agree on the account. */
export interface AgentCaller {
  predecessor: string;
  signer: string;
  public_key: string;
}

export type Origin = "AGENT" | "OWNER";

/** What the callback sees. "unknown" is anything other than a clean success or a clean failure. */
export type TransferOutcome = "success" | "failed" | "unknown";

export type SimPayable = Payable & { recipient: string; operation_id: string | null };

export type SimOperation = Operation & { origin: Origin; request_digest: string | null };

export type SimUsage = VaultUsage & {
  owner_paid_atomic: string;
  owner_reserved_atomic: string;
  withdrawn_atomic: string;
  withdrawal_in_flight_atomic: string;
  pending_count: number;
};

export type SimVendor = Vendor;

/** A panic in the contract. `code` is the same `E_*` string as the contract's panic message. */
export class VaultPanic extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "VaultPanic";
  }
}
