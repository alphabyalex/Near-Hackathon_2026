import { createHash } from "node:crypto";
import type {
  AgentBinding,
  OperationStatus,
  PayableStatus,
  PaymentRequest,
  Policy,
  RequestResult,
  VaultRejection,
} from "@wardline/schemas";
import {
  DEFAULT_CAPACITIES,
  HARD_LIMITS,
  RECONCILE_AFTER_NS,
  ROLLING_WINDOW_NS,
  VaultPanic,
  type AgentCaller,
  type BindingInput,
  type Capacities,
  type EndpointRevisionView,
  type EndpointStatusView,
  type Origin,
  type PayableInput,
  type PolicyInput,
  type SimOperation,
  type SimPayable,
  type SimUsage,
  type SimVendor,
  type TransferOutcome,
  type VaultSimConfig,
  type VendorInput,
} from "./types.js";

const MAX_ID_BYTES = 64;
const MAX_TEXT_BYTES = 64;
const MAX_PAGE = 100;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const encoder = new TextEncoder();

interface StoredEndpointRevision {
  revision: number;
  account: string;
  evidence_tier: string;
  evidence_digest: string;
  status: EndpointStatusView;
  approval_digest: string | null;
  activates_at_ns: bigint;
}

interface StoredVendor {
  display_name: string;
  account_id: string;
  revision: number;
  per_payment_cap: bigint;
  active: boolean;
  endpoints: StoredEndpointRevision[];
  active_endpoint_revision: number | null;
}

interface StoredPayable {
  vendor_id: string;
  vendor_revision: number;
  recipient: string;
  po_number: string;
  invoice_number: string | null;
  amount: bigint;
  not_before_ns: bigint;
  due_at_ns: bigint;
  expires_at_ns: bigint;
  evidence_commitment: string;
  status: Exclude<PayableStatus, "EXPIRED">;
  attempts: number;
  operation_id: string | null;
  expected_endpoint_revision: number | null;
}

interface StoredOperation {
  payable_ref: string;
  amount: bigint;
  recipient: string;
  status: Exclude<OperationStatus, "REQUESTED">;
  attempt: number;
  reserved_at_ns: bigint;
  resolved_at_ns: bigint | null;
  origin: Origin;
  request_digest: string | null;
}

interface StoredBinding {
  agent_account_id: string;
  public_key: string;
  manifest_digest: string;
  assessment_ref: string;
  expires_at_ns: bigint;
  enabled: boolean;
}

interface WithdrawalInFlight {
  amount: bigint;
  started_at_ns: bigint;
  uncertain: boolean;
}

type RequestDecision =
  | { kind: "reject"; rejection: VaultRejection }
  | { kind: "existing"; operation_id: string }
  | { kind: "reserve"; amount: bigint; recipient: string };

const rejected = (rejection: VaultRejection): RequestResult => ({ ok: false, operation_id: null, rejection });
const accepted = (operation_id: string): RequestResult => ({ ok: true, operation_id, rejection: null });

function panic(code: string): never {
  throw new VaultPanic(code);
}

function checkInput(ok: boolean): void {
  if (!ok) panic("E_INVALID_INPUT");
}

function isBounded(value: string, limit: number): boolean {
  return value.length > 0 && encoder.encode(value).length <= limit;
}

/**
 * Pure TypeScript model of docs/VAULT_RULES.md, for the Gym. Same rejection codes, same order of
 * checks, same operation ids as the contract. The parity tests in tests/sandbox hold it to that.
 *
 * Not modeled, because they depend on the chain: attached deposits, gas (`E_INSUFFICIENT_GAS`),
 * and the NEAR storage margin behind `CAPACITY_FULL`.
 */
export class VaultSim {
  readonly vaultId: string;
  readonly owner: string;
  readonly guardian: string | null;
  readonly tokenContract: string;
  readonly tokenDecimals: number;
  readonly capacities: Capacities;
  readonly approver: string | null;
  readonly attestor: string | null;
  readonly cooldownPolicy: { tier2_under_cap_ns: bigint; default_ns: bigint };
  readonly conservativeCaps: PolicyInput | null;
  bindingTierIsConservative: boolean;
  fullPolicyWeeklyCap: bigint;
  private readonly usedApprovals = new Set<string>();

  private nowNs: bigint;
  private readonly autoResolve: boolean;
  private tokenRegistered: "all" | Set<string>;

  private policy: {
    revision: number;
    weekly_cap: bigint;
    lifetime_cap: bigint;
    expires_at_ns: bigint;
    paused: boolean;
  };
  private binding: StoredBinding | null = null;
  private bindingRevision = 0;
  private readonly vendors = new Map<string, StoredVendor>();
  private readonly payables = new Map<string, StoredPayable>();
  private readonly operations = new Map<string, StoredOperation>();
  private operationCount = 0;

  private available = 0n;
  private reserved = 0n;
  private settled = 0n;
  private ownerReserved = 0n;
  private ownerPaid = 0n;
  private withdrawn = 0n;
  private withdrawal: WithdrawalInFlight | null = null;
  private rolling: Array<{ amount: bigint; settled_at_ns: bigint }> = [];
  private pendingCount = 0;
  private agentPendingCount = 0;

  /** `new(config)`. Starts paused with no agent enrolled. */
  constructor(config: VaultSimConfig) {
    const capacities = config.capacities ?? DEFAULT_CAPACITIES;
    checkInput(
      capacities.max_vendors <= HARD_LIMITS.max_vendors &&
        capacities.max_payables <= HARD_LIMITS.max_payables &&
        capacities.max_pending <= HARD_LIMITS.max_pending &&
        capacities.max_rolling <= HARD_LIMITS.max_rolling &&
        capacities.max_operations <= HARD_LIMITS.max_operations,
    );
    this.vaultId = config.vault_id;
    this.owner = config.owner;
    this.guardian = config.guardian ?? null;
    this.tokenContract = config.token_contract;
    this.tokenDecimals = config.token_decimals ?? 6;
    this.capacities = capacities;
    this.approver = config.approver ?? null;
    this.attestor = config.attestor ?? null;
    this.cooldownPolicy = {
      tier2_under_cap_ns: BigInt(config.cooldown_policy?.tier2_under_cap_ns ?? 24 * 3600 * 1_000_000_000),
      default_ns: BigInt(config.cooldown_policy?.default_ns ?? 72 * 3600 * 1_000_000_000),
    };
    this.conservativeCaps = config.conservative_caps ?? null;
    this.bindingTierIsConservative = false;
    this.fullPolicyWeeklyCap = BigInt(config.policy.weekly_cap_atomic);
    this.nowNs = BigInt(config.now_ns);
    this.autoResolve = config.auto_resolve ?? true;
    this.tokenRegistered = config.token_registered === undefined || config.token_registered === "all" ? "all" : new Set(config.token_registered);
    this.policy = {
      revision: 1,
      weekly_cap: BigInt(config.policy.weekly_cap_atomic),
      lifetime_cap: BigInt(config.policy.lifetime_cap_atomic),
      expires_at_ns: BigInt(config.policy.expires_at_ns),
      paused: true,
    };
  }

  // ---------- Simulation controls, no contract equivalent ----------

  now(): bigint {
    return this.nowNs;
  }

  setNow(ns: bigint | string): void {
    this.nowNs = BigInt(ns);
  }

  advance(ns: bigint): void {
    this.nowNs += ns;
  }

  /** Models `storage_deposit` on the token. */
  registerWithToken(account: string): void {
    if (this.tokenRegistered !== "all") this.tokenRegistered.add(account);
  }

  // ---------- Owner: configuration ----------

  setVendor(caller: string, vendor: VendorInput, expectedRevision: number): number {
    this.assertOwner(caller);
    checkInput(isBounded(vendor.vendor_id, MAX_ID_BYTES));
    checkInput(isBounded(vendor.display_name, MAX_TEXT_BYTES));
    const current = this.vendors.get(vendor.vendor_id);
    if ((current?.revision ?? 0) !== expectedRevision) panic("E_STALE_REVISION");
    if (!current && this.vendors.size >= this.capacities.max_vendors) panic("E_CAPACITY_FULL");
    const revision = expectedRevision + 1;
    const initialRev = 1;
    const endpoints: StoredEndpointRevision[] = current?.endpoints ?? [
      {
        revision: initialRev,
        account: `near:testnet:${vendor.account_id}`,
        evidence_tier: "T2",
        evidence_digest: `sha256:${"0".repeat(64)}`,
        status: "ACTIVE",
        approval_digest: null,
        activates_at_ns: 0n,
      },
    ];
    this.vendors.set(vendor.vendor_id, {
      display_name: vendor.display_name,
      account_id: vendor.account_id,
      revision,
      per_payment_cap: BigInt(vendor.per_payment_cap_atomic),
      active: vendor.active,
      endpoints,
      active_endpoint_revision: current?.active_endpoint_revision ?? initialRev,
    });
    return revision;
  }

  proposeEndpoint(caller: string, vendorId: string, account: string, evidenceTier: string, evidenceDigest: string): number {
    if (caller !== this.owner && caller !== this.attestor) panic("E_NOT_OWNER_OR_ATTESTOR");
    checkInput(isBounded(vendorId, MAX_ID_BYTES));
    checkInput(DIGEST.test(evidenceDigest));
    checkInput(account.length > 0 && account.length <= 128);

    const vendor = this.vendors.get(vendorId);
    if (!vendor) panic("E_UNKNOWN_VENDOR");
    if (!vendor.active) panic("E_VENDOR_INACTIVE");

    const nextRev = Math.max(0, ...vendor.endpoints.map((e) => e.revision)) + 1;

    let largestOpen = 0n;
    for (const payable of this.payables.values()) {
      if (payable.vendor_id === vendorId && payable.status === "OPEN") {
        if (payable.amount > largestOpen) largestOpen = payable.amount;
      }
    }

    const cooldownNs =
      (evidenceTier === "T2" || evidenceTier === "T3" || evidenceTier === "T4") && largestOpen <= vendor.per_payment_cap
        ? this.cooldownPolicy.tier2_under_cap_ns
        : this.cooldownPolicy.default_ns;

    const activatesAtNs = this.nowNs + cooldownNs;
    const normalized = normalizeCaip10(account);

    vendor.endpoints.push({
      revision: nextRev,
      account: normalized,
      evidence_tier: evidenceTier,
      evidence_digest: evidenceDigest,
      status: "PENDING_COOLDOWN",
      approval_digest: null,
      activates_at_ns: activatesAtNs,
    });

    return nextRev;
  }

  approveEndpoint(caller: string, vendorId: string, revision: number, approvalDigest: string, expiryNs?: string | bigint): void {
    if (!this.approver) panic("E_NO_APPROVER_CONFIGURED");
    if (caller !== this.approver) panic("E_NOT_APPROVER");
    if (caller === this.owner) panic("E_APPROVER_CANNOT_BE_OWNER");
    if (this.binding && caller === this.binding.agent_account_id) panic("E_APPROVER_CANNOT_BE_AGENT");

    checkInput(DIGEST.test(approvalDigest));
    if (this.usedApprovals.has(approvalDigest)) panic("E_APPROVAL_REPLAYED");

    const vendor = this.vendors.get(vendorId);
    if (!vendor) panic("E_UNKNOWN_VENDOR");

    const endpoint = vendor.endpoints.find((e) => e.revision === revision);
    if (!endpoint) panic("E_UNKNOWN_ENDPOINT");
    if (endpoint.status !== "PENDING_COOLDOWN") panic("E_INVALID_STATUS");

    const expiry = expiryNs !== undefined
      ? BigInt(expiryNs)
      : endpoint.activates_at_ns + 7n * 24n * 3600n * 1_000_000_000n;

    if (this.nowNs >= expiry) panic("E_APPROVAL_STALE");

    const expectedDigest = computeApprovalDigest(this.vaultId, vendorId, revision, endpoint.account, expiry);
    if (approvalDigest !== expectedDigest) panic("E_APPROVAL_MISMATCH");

    this.usedApprovals.add(approvalDigest);
    endpoint.approval_digest = approvalDigest;

    if (this.nowNs >= endpoint.activates_at_ns) {
      endpoint.status = "ACTIVE";
      vendor.account_id = parseNearAccount(endpoint.account);
      vendor.active_endpoint_revision = revision;
    } else {
      endpoint.status = "APPROVED_PENDING_COOLDOWN";
    }
  }

  activateEndpoint(vendorId: string, revision: number): void {
    const vendor = this.vendors.get(vendorId);
    if (!vendor) panic("E_UNKNOWN_VENDOR");
    const endpoint = vendor.endpoints.find((e) => e.revision === revision);
    if (!endpoint) panic("E_UNKNOWN_ENDPOINT");
    if (endpoint.status === "ACTIVE") return;
    if (endpoint.status !== "APPROVED_PENDING_COOLDOWN") panic("E_NOT_APPROVED");
    if (this.nowNs < endpoint.activates_at_ns) panic("E_COOLDOWN_ACTIVE");
    endpoint.status = "ACTIVE";
    vendor.account_id = parseNearAccount(endpoint.account);
    vendor.active_endpoint_revision = revision;
  }

  rejectEndpoint(caller: string, vendorId: string, revision: number): void {
    const isOwner = caller === this.owner;
    const isApprover = caller === this.approver;
    if (!isOwner && !isApprover) panic("E_NOT_OWNER_OR_APPROVER");
    const vendor = this.vendors.get(vendorId);
    if (!vendor) panic("E_UNKNOWN_VENDOR");
    const endpoint = vendor.endpoints.find((e) => e.revision === revision);
    if (!endpoint) panic("E_UNKNOWN_ENDPOINT");
    if (endpoint.status === "REJECTED" || endpoint.status === "REVOKED") panic("E_INVALID_STATUS");
    endpoint.status = "REJECTED";
  }

  revokeEndpoint(caller: string, vendorId: string, revision: number): void {
    const isOwner = caller === this.owner;
    const isApprover = caller === this.approver;
    if (!isOwner && !isApprover) panic("E_NOT_OWNER_OR_APPROVER");
    const vendor = this.vendors.get(vendorId);
    if (!vendor) panic("E_UNKNOWN_VENDOR");
    const endpoint = vendor.endpoints.find((e) => e.revision === revision);
    if (!endpoint) panic("E_UNKNOWN_ENDPOINT");
    endpoint.status = "REVOKED";
    if (vendor.active_endpoint_revision === revision) {
      vendor.active_endpoint_revision = null;
    }
  }

  raiseBindingCaps(caller: string): void {
    this.assertOwner(caller);
    this.bindingTierIsConservative = false;
    this.policy.weekly_cap = this.fullPolicyWeeklyCap;
  }

  registerPayable(caller: string, payable: PayableInput): void {
    this.assertOwner(caller);
    checkInput(isBounded(payable.payable_ref, MAX_ID_BYTES));
    checkInput(isBounded(payable.po_number, MAX_TEXT_BYTES));
    if (payable.invoice_number !== null) checkInput(isBounded(payable.invoice_number, MAX_TEXT_BYTES));
    checkInput(DIGEST.test(payable.evidence_commitment));
    if (this.payables.has(payable.payable_ref)) panic("E_DUPLICATE_PAYABLE");
    const vendor = this.vendors.get(payable.vendor_id);
    if (!vendor) panic("E_UNKNOWN_VENDOR");
    if (!vendor.active) panic("E_VENDOR_INACTIVE");
    if (vendor.revision !== payable.vendor_revision) panic("E_VENDOR_REVISION_MISMATCH");
    if (payable.expected_endpoint_revision !== undefined && payable.expected_endpoint_revision !== null) {
      if (vendor.active_endpoint_revision !== payable.expected_endpoint_revision) {
        panic("E_ENDPOINT_REVISION_MISMATCH");
      }
    }
    const amount = BigInt(payable.amount_atomic);
    const notBefore = BigInt(payable.not_before_ns);
    const due = BigInt(payable.due_at_ns);
    const expires = BigInt(payable.expires_at_ns);
    checkInput(amount > 0n && notBefore <= due && due <= expires && notBefore < expires);
    if (this.payables.size >= this.capacities.max_payables) panic("E_CAPACITY_FULL");
    this.payables.set(payable.payable_ref, {
      vendor_id: payable.vendor_id,
      vendor_revision: payable.vendor_revision,
      recipient: vendor.account_id,
      po_number: payable.po_number,
      invoice_number: payable.invoice_number,
      amount,
      not_before_ns: notBefore,
      due_at_ns: due,
      expires_at_ns: expires,
      evidence_commitment: payable.evidence_commitment,
      status: "OPEN",
      attempts: 0,
      operation_id: null,
      expected_endpoint_revision: payable.expected_endpoint_revision ?? null,
    });
  }

  cancelPayable(caller: string, payableRef: string): void {
    this.assertOwner(caller);
    const payable = this.payables.get(payableRef);
    if (!payable) panic("E_UNKNOWN_PAYABLE");
    if (payable.status !== "OPEN" && payable.status !== "FAILED_KNOWN") panic("E_NOT_CANCELLABLE");
    payable.status = "CANCELLED";
  }

  reopenFailedPayable(caller: string, payableRef: string): void {
    this.assertOwner(caller);
    const payable = this.payables.get(payableRef);
    if (!payable) panic("E_UNKNOWN_PAYABLE");
    if (payable.status !== "FAILED_KNOWN") panic("E_NOT_FAILED");
    payable.status = "OPEN";
  }

  setPolicy(caller: string, change: PolicyInput, expectedRevision: number): number {
    this.assertOwner(caller);
    if (this.policy.revision !== expectedRevision) panic("E_STALE_REVISION");
    if (BigInt(change.lifetime_cap_atomic) < this.settled + this.reserved) panic("E_BELOW_COMMITTED");
    this.policy.revision += 1;
    this.policy.weekly_cap = BigInt(change.weekly_cap_atomic);
    this.policy.lifetime_cap = BigInt(change.lifetime_cap_atomic);
    this.policy.expires_at_ns = BigInt(change.expires_at_ns);
    this.fullPolicyWeeklyCap = BigInt(change.weekly_cap_atomic);
    this.bindingTierIsConservative = false;
    return this.policy.revision;
  }

  activateAgent(caller: string, binding: BindingInput, expectedRevision: number): number {
    this.assertOwner(caller);
    if (this.bindingRevision !== expectedRevision) panic("E_STALE_REVISION");
    checkInput(DIGEST.test(binding.manifest_digest));
    checkInput(isBounded(binding.assessment_ref, MAX_TEXT_BYTES));
    this.bindingRevision += 1;
    if (this.conservativeCaps) {
      this.policy.weekly_cap = BigInt(this.conservativeCaps.weekly_cap_atomic);
      this.bindingTierIsConservative = true;
    }
    this.binding = {
      agent_account_id: binding.agent_account_id,
      public_key: binding.public_key,
      manifest_digest: binding.manifest_digest,
      assessment_ref: binding.assessment_ref,
      expires_at_ns: BigInt(binding.expires_at_ns),
      enabled: true,
    };
    return this.bindingRevision;
  }

  revokeAgent(caller: string, agentAccountId: string): void {
    this.assertOwner(caller);
    if (!this.binding) panic("E_NO_BINDING");
    if (this.binding.agent_account_id !== agentAccountId) panic("E_AGENT_MISMATCH");
    this.binding.enabled = false;
    this.bindingRevision += 1;
  }

  pause(caller: string): void {
    if (caller !== this.owner && caller !== this.guardian) panic("E_NOT_OWNER_OR_GUARDIAN");
    this.policy.paused = true;
  }

  unpause(caller: string): void {
    this.assertOwner(caller);
    this.policy.paused = false;
  }

  // ---------- Agent path ----------

  requestPayment(caller: AgentCaller, request: PaymentRequest): RequestResult {
    const decision = this.decideRequest(caller, request);
    if (decision.kind === "reject") return rejected(decision.rejection);
    if (decision.kind === "existing") return accepted(decision.operation_id);
    this.pruneRolling();
    this.available -= decision.amount;
    this.reserved += decision.amount;
    this.agentPendingCount += 1;
    const operationId = this.openOperation(request.payable_ref, decision.amount, decision.recipient, "AGENT", request.request_digest);
    if (this.autoResolve) this.resolveOperation(operationId, this.tokenOutcome(decision.recipient));
    return accepted(operationId);
  }

  // ---------- Owner path ----------

  ownerPay(caller: string, payableRef: string): RequestResult {
    const decision = this.decideOwnerPay(caller, payableRef);
    if ("rejection" in decision) return rejected(decision.rejection);
    this.available -= decision.amount;
    this.ownerReserved += decision.amount;
    const operationId = this.openOperation(payableRef, decision.amount, decision.recipient, "OWNER", null);
    if (this.autoResolve) this.resolveOperation(operationId, this.tokenOutcome(decision.recipient));
    return accepted(operationId);
  }

  // ---------- Callback and reconciliation ----------

  /** `on_payment_result`. Acts only on a RESERVED operation, so a repeat changes nothing. */
  resolveOperation(operationId: string, outcome: TransferOutcome): void {
    const operation = this.operations.get(operationId);
    if (!operation) panic("E_UNKNOWN_OPERATION");
    if (operation.status !== "RESERVED") return;
    if (outcome === "success") this.applySettled(operation);
    else if (outcome === "failed") this.applyFailed(operation);
    else operation.status = "OUTCOME_UNCERTAIN";
  }

  reconcileOperation(caller: string, operationId: string, settled: boolean): void {
    this.assertOwner(caller);
    const operation = this.operations.get(operationId);
    if (!operation) panic("E_UNKNOWN_OPERATION");
    const reconcilable =
      operation.status === "OUTCOME_UNCERTAIN" ||
      (operation.status === "RESERVED" && this.nowNs >= operation.reserved_at_ns + RECONCILE_AFTER_NS);
    if (!reconcilable) panic("E_NOT_RECONCILABLE");
    if (settled) this.applySettled(operation);
    else this.applyFailed(operation);
  }

  // ---------- Funding and withdrawal ----------

  /** `ft_on_transfer`. `predecessor` is the token contract on a legitimate funding. */
  ftOnTransfer(predecessor: string, _senderId: string, amount: string | bigint): string {
    if (predecessor !== this.tokenContract) panic("E_WRONG_TOKEN");
    this.available += BigInt(amount);
    return "0";
  }

  /** Convenience for funding through the fixed token. */
  fund(amount: string | bigint, sender = this.owner): void {
    this.ftOnTransfer(this.tokenContract, sender, amount);
  }

  withdrawAvailable(caller: string, amountAtomic: string | bigint): void {
    this.assertOwner(caller);
    const amount = BigInt(amountAtomic);
    if (!this.policy.paused) panic("E_NOT_PAUSED");
    if (this.pendingCount > 0) panic("E_PENDING_OPERATIONS");
    if (this.withdrawal) panic("E_WITHDRAWAL_IN_FLIGHT");
    if (amount === 0n || amount > this.available) panic("E_INSUFFICIENT_BALANCE");
    this.available -= amount;
    this.withdrawal = { amount, started_at_ns: this.nowNs, uncertain: false };
    if (this.autoResolve) this.resolveWithdrawal(amount, this.tokenOutcome(this.owner));
  }

  /** `on_withdraw_result`. Does nothing unless the matching withdrawal is in flight and unresolved. */
  resolveWithdrawal(amountAtomic: string | bigint, outcome: TransferOutcome): void {
    const withdrawal = this.withdrawal;
    if (!withdrawal || withdrawal.amount !== BigInt(amountAtomic) || withdrawal.uncertain) return;
    if (outcome === "success") this.finishWithdrawal(withdrawal.amount, true);
    else if (outcome === "failed") this.finishWithdrawal(withdrawal.amount, false);
    else withdrawal.uncertain = true;
  }

  reconcileWithdrawal(caller: string, settled: boolean): void {
    this.assertOwner(caller);
    if (!this.withdrawal) panic("E_NO_WITHDRAWAL");
    const oldEnough = this.nowNs >= this.withdrawal.started_at_ns + RECONCILE_AFTER_NS;
    if (!this.withdrawal.uncertain && !oldEnough) panic("E_NOT_RECONCILABLE");
    this.finishWithdrawal(this.withdrawal.amount, settled);
  }

  // ---------- Views ----------

  getPolicy(): Policy {
    return {
      revision: this.policy.revision,
      weekly_cap_atomic: this.policy.weekly_cap.toString(),
      lifetime_cap_atomic: this.policy.lifetime_cap.toString(),
      expires_at_ns: this.policy.expires_at_ns.toString(),
      paused: this.policy.paused,
    };
  }

  getUsage(): SimUsage {
    return {
      weekly_settled_atomic: this.rollingSettled().toString(),
      weekly_reserved_atomic: this.reserved.toString(),
      lifetime_settled_atomic: this.settled.toString(),
      lifetime_reserved_atomic: this.reserved.toString(),
      balance_atomic: this.available.toString(),
      owner_paid_atomic: this.ownerPaid.toString(),
      owner_reserved_atomic: this.ownerReserved.toString(),
      withdrawn_atomic: this.withdrawn.toString(),
      withdrawal_in_flight_atomic: (this.withdrawal?.amount ?? 0n).toString(),
      pending_count: this.pendingCount,
    };
  }

  getPayable(payableRef: string): SimPayable | null {
    const payable = this.payables.get(payableRef);
    return payable ? this.payableView(payableRef, payable) : null;
  }

  getPayables(fromIndex = 0, limit = MAX_PAGE): SimPayable[] {
    return [...this.payables.entries()]
      .slice(fromIndex, fromIndex + Math.min(limit, MAX_PAGE))
      .map(([payableRef, payable]) => this.payableView(payableRef, payable));
  }

  getOperation(operationId: string): SimOperation | null {
    const operation = this.operations.get(operationId);
    if (!operation) return null;
    return {
      operation_id: operationId,
      payable_ref: operation.payable_ref,
      amount_atomic: operation.amount.toString(),
      recipient: operation.recipient,
      status: operation.status,
      attempt: operation.attempt,
      reserved_at_ns: operation.reserved_at_ns.toString(),
      resolved_at_ns: operation.resolved_at_ns?.toString() ?? null,
      tx_hash: null,
      origin: operation.origin,
      request_digest: operation.request_digest,
    };
  }

  getVendor(vendorId: string): SimVendor | null {
    const vendor = this.vendors.get(vendorId);
    if (!vendor) return null;
    return {
      vendor_id: vendorId,
      display_name: vendor.display_name,
      account_id: vendor.account_id,
      revision: vendor.revision,
      per_payment_cap_atomic: vendor.per_payment_cap.toString(),
      active: vendor.active,
      endpoints: vendor.endpoints.map((e) => ({
        revision: e.revision,
        account: e.account,
        evidence_tier: e.evidence_tier,
        evidence_digest: e.evidence_digest,
        status: e.status,
        approval_digest: e.approval_digest,
      })),
      active_endpoint_revision: vendor.active_endpoint_revision,
    };
  }

  getVendors(fromIndex = 0, limit = MAX_PAGE): SimVendor[] {
    return [...this.vendors.entries()]
      .slice(fromIndex, fromIndex + Math.min(limit, MAX_PAGE))
      .map(([vendor_id, vendor]) => ({
        vendor_id,
        display_name: vendor.display_name,
        account_id: vendor.account_id,
        revision: vendor.revision,
        per_payment_cap_atomic: vendor.per_payment_cap.toString(),
        active: vendor.active,
        endpoints: vendor.endpoints.map((e) => ({
          revision: e.revision,
          account: e.account,
          evidence_tier: e.evidence_tier,
          evidence_digest: e.evidence_digest,
          status: e.status,
          approval_digest: e.approval_digest,
        })),
        active_endpoint_revision: vendor.active_endpoint_revision,
      }));
  }

  getBinding(): AgentBinding | null {
    if (!this.binding) return null;
    return {
      agent_account_id: this.binding.agent_account_id,
      public_key: this.binding.public_key,
      manifest_digest: this.binding.manifest_digest,
      assessment_ref: this.binding.assessment_ref,
      revision: this.bindingRevision,
      expires_at_ns: this.binding.expires_at_ns.toString(),
      enabled: this.binding.enabled,
    };
  }

  // ---------- Internals ----------

  private assertOwner(caller: string): void {
    if (caller !== this.owner) panic("E_NOT_OWNER");
  }

  /** Read only: checks 1 to 16 of `request_payment`, in spec order. */
  private decideRequest(caller: AgentCaller, request: PaymentRequest): RequestDecision {
    const reject = (rejection: VaultRejection): RequestDecision => ({ kind: "reject", rejection });
    const now = this.nowNs;
    const binding = this.binding;

    // 1. Identity.
    if (!binding) return reject("BAD_CALLER");
    if (
      caller.predecessor !== caller.signer ||
      caller.predecessor !== binding.agent_account_id ||
      caller.public_key !== binding.public_key
    ) {
      return reject("BAD_CALLER");
    }
    // 2. Request shape.
    if (!DIGEST.test(request.request_digest)) return reject("BAD_CALLER");
    // Release Guard:
    if (request.manifest_digest !== undefined && request.manifest_digest !== null) {
      if (request.manifest_digest !== binding.manifest_digest) {
        return reject("RELEASE_MISMATCH");
      }
    }
    // 3. Authority still live.
    if (!binding.enabled || now >= binding.expires_at_ns || now >= this.policy.expires_at_ns) {
      return reject("BINDING_INACTIVE");
    }
    // 4. Kill switch.
    if (this.policy.paused) return reject("PAUSED");
    // 5. Payable.
    const payable = this.payables.get(request.payable_ref);
    if (!payable) return reject("UNKNOWN_PAYABLE");
    // 6 and 7. Single-payment lock and idempotent retries.
    if (payable.status === "SETTLED") return this.existingOr(payable, request.request_digest, "ALREADY_PAID");
    if (payable.status === "PENDING") return this.existingOr(payable, request.request_digest, "ALREADY_PENDING");
    // 8. CANCELLED, and FAILED_KNOWN awaiting the owner's reopen.
    if (payable.status !== "OPEN") return reject("UNKNOWN_PAYABLE");
    // 9 and 10. Time window.
    if (now < payable.not_before_ns) return reject("NOT_YET_PAYABLE");
    if (now >= payable.expires_at_ns) return reject("PAYABLE_EXPIRED");
    // 11. Revisions.
    const vendor = this.vendors.get(payable.vendor_id);
    if (
      !vendor ||
      request.expected_policy_revision !== this.policy.revision ||
      request.expected_binding_revision !== this.bindingRevision ||
      request.expected_vendor_revision !== vendor.revision ||
      payable.vendor_revision !== vendor.revision ||
      !vendor.active
    ) {
      return reject("STALE_REVISION");
    }
    // Endpoint checks:
    if (vendor.active_endpoint_revision === null || vendor.active_endpoint_revision === undefined) {
      return reject("PAYEE_NOT_VERIFIED");
    }
    if (
      payable.expected_endpoint_revision !== null &&
      payable.expected_endpoint_revision !== undefined &&
      payable.expected_endpoint_revision !== vendor.active_endpoint_revision
    ) {
      return reject("ENDPOINT_REVISION_MISMATCH");
    }
    // 12 to 14. Caps. Exactly at a cap passes.
    const amount = payable.amount;
    if (amount > vendor.per_payment_cap) return reject("OVER_VENDOR_CAP");
    if (this.rollingSettled() + this.reserved + amount > this.policy.weekly_cap) return reject("OVER_WEEKLY_CAP");
    if (this.settled + this.reserved + amount > this.policy.lifetime_cap) return reject("OVER_LIFETIME_CAP");
    // 15. Funds.
    if (amount > this.available) return reject("INSUFFICIENT_BALANCE");
    // 16. Capacity. Settling needs a rolling slot, so it is reserved now.
    if (
      this.pendingCount >= this.capacities.max_pending ||
      this.liveRollingCount() + this.agentPendingCount >= this.capacities.max_rolling ||
      this.operationCount >= this.capacities.max_operations
    ) {
      return reject("CAPACITY_FULL");
    }
    return { kind: "reserve", amount, recipient: payable.recipient };
  }

  private existingOr(payable: StoredPayable, digest: string, rejection: VaultRejection): RequestDecision {
    const operation = payable.operation_id === null ? undefined : this.operations.get(payable.operation_id);
    if (operation && payable.operation_id !== null && operation.request_digest === digest) {
      return { kind: "existing", operation_id: payable.operation_id };
    }
    return { kind: "reject", rejection };
  }

  /** Read only: checks 1 to 8 of `owner_pay`, in spec order. */
  private decideOwnerPay(caller: string, payableRef: string): { rejection: VaultRejection } | { amount: bigint; recipient: string } {
    if (caller !== this.owner) return { rejection: "BAD_CALLER" };
    const payable = this.payables.get(payableRef);
    if (!payable) return { rejection: "UNKNOWN_PAYABLE" };
    if (payable.status === "SETTLED") return { rejection: "ALREADY_PAID" };
    if (payable.status === "PENDING") return { rejection: "ALREADY_PENDING" };
    if (payable.status !== "OPEN") return { rejection: "UNKNOWN_PAYABLE" };
    const vendor = this.vendors.get(payable.vendor_id);
    if (!vendor || !vendor.active || vendor.account_id !== payable.recipient) return { rejection: "STALE_REVISION" };
    if (vendor.active_endpoint_revision === null || vendor.active_endpoint_revision === undefined) {
      return { rejection: "PAYEE_NOT_VERIFIED" };
    }
    if (
      payable.expected_endpoint_revision !== null &&
      payable.expected_endpoint_revision !== undefined &&
      payable.expected_endpoint_revision !== vendor.active_endpoint_revision
    ) {
      return { rejection: "ENDPOINT_REVISION_MISMATCH" };
    }
    if (payable.amount > this.available) return { rejection: "INSUFFICIENT_BALANCE" };
    if (this.pendingCount >= this.capacities.max_pending || this.operationCount >= this.capacities.max_operations) {
      return { rejection: "CAPACITY_FULL" };
    }
    return { amount: payable.amount, recipient: payable.recipient };
  }

  private openOperation(payableRef: string, amount: bigint, recipient: string, origin: Origin, requestDigest: string | null): string {
    this.operationCount += 1;
    this.pendingCount += 1;
    const operationId = `op_${this.operationCount}`;
    const payable = this.payables.get(payableRef);
    if (!payable) panic("E_UNKNOWN_PAYABLE");
    payable.status = "PENDING";
    payable.attempts += 1;
    payable.operation_id = operationId;
    this.operations.set(operationId, {
      payable_ref: payableRef,
      amount,
      recipient,
      status: "RESERVED",
      attempt: payable.attempts,
      reserved_at_ns: this.nowNs,
      resolved_at_ns: null,
      origin,
      request_digest: requestDigest,
    });
    return operationId;
  }

  private tokenOutcome(recipient: string): TransferOutcome {
    return this.tokenRegistered === "all" || this.tokenRegistered.has(recipient) ? "success" : "failed";
  }

  private releaseSlots(origin: Origin): void {
    this.pendingCount -= 1;
    if (origin === "AGENT") this.agentPendingCount -= 1;
  }

  private applySettled(operation: StoredOperation): void {
    if (operation.origin === "AGENT") {
      this.reserved -= operation.amount;
      this.settled += operation.amount;
      this.pruneRolling();
      this.rolling.push({ amount: operation.amount, settled_at_ns: this.nowNs });
    } else {
      this.ownerReserved -= operation.amount;
      this.ownerPaid += operation.amount;
    }
    this.releaseSlots(operation.origin);
    this.setPayableStatus(operation.payable_ref, "SETTLED");
    operation.status = "SETTLED";
    operation.resolved_at_ns = this.nowNs;
  }

  private applyFailed(operation: StoredOperation): void {
    if (operation.origin === "AGENT") this.reserved -= operation.amount;
    else this.ownerReserved -= operation.amount;
    this.available += operation.amount;
    this.releaseSlots(operation.origin);
    this.setPayableStatus(operation.payable_ref, "FAILED_KNOWN");
    operation.status = "FAILED_KNOWN";
    operation.resolved_at_ns = this.nowNs;
  }

  private setPayableStatus(payableRef: string, status: StoredPayable["status"]): void {
    const payable = this.payables.get(payableRef);
    if (payable) payable.status = status;
  }

  private finishWithdrawal(amount: bigint, settled: boolean): void {
    this.withdrawal = null;
    if (settled) this.withdrawn += amount;
    else this.available += amount;
  }

  private isLive(entry: { settled_at_ns: bigint }): boolean {
    return this.nowNs < entry.settled_at_ns + ROLLING_WINDOW_NS;
  }

  private rollingSettled(): bigint {
    return this.rolling.filter((entry) => this.isLive(entry)).reduce((sum, entry) => sum + entry.amount, 0n);
  }

  private liveRollingCount(): number {
    return this.rolling.filter((entry) => this.isLive(entry)).length;
  }

  private pruneRolling(): void {
    this.rolling = this.rolling.filter((entry) => this.isLive(entry));
  }

  private payableView(payableRef: string, payable: StoredPayable): SimPayable {
    return {
      payable_ref: payableRef,
      vault_id: this.vaultId,
      vendor_id: payable.vendor_id,
      vendor_revision: payable.vendor_revision,
      po_number: payable.po_number,
      invoice_number: payable.invoice_number,
      amount_atomic: payable.amount.toString(),
      token_contract_id: this.tokenContract,
      not_before_ns: payable.not_before_ns.toString(),
      due_at_ns: payable.due_at_ns.toString(),
      expires_at_ns: payable.expires_at_ns.toString(),
      evidence_commitment: payable.evidence_commitment,
      status: payable.status === "OPEN" && this.nowNs >= payable.expires_at_ns ? "EXPIRED" : payable.status,
      recipient: payable.recipient,
      operation_id: payable.operation_id,
      expected_endpoint_revision: payable.expected_endpoint_revision,
    };
  }
}

export function parseNearAccount(caip10: string): string {
  if (caip10.startsWith("near:")) {
    const parts = caip10.slice("near:".length).split(":");
    if (parts.length === 2) return parts[1]!;
    if (parts.length === 1) return parts[0]!;
    return caip10;
  }
  return caip10;
}

export function normalizeCaip10(account: string): string {
  if (account.startsWith("eip155:")) {
    const parts = account.slice("eip155:".length).split(":");
    if (parts.length === 2) {
      return `eip155:${parts[0]}:${parts[1]!.toLowerCase()}`;
    }
    return account.toLowerCase();
  }
  return account;
}

export function computeApprovalDigest(
  vaultId: string,
  vendorId: string,
  revision: number,
  account: string,
  expiryNs: bigint | string | number,
): string {
  const payload = `wardline:endpoint-approval:${vaultId}:${vendorId}:${revision}:${account}:${expiryNs.toString()}`;
  const hash = createHash("sha256").update(payload).digest("hex");
  return `sha256:${hash}`;
}
