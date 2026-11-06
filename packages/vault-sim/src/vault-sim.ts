import { VaultAdminError } from "./errors.js";
import {
  AgentBinding,
  AgentBindingInput,
  AtomicAmount,
  CallContext,
  Operation,
  OperationActor,
  OperationStatus,
  OwnerContext,
  Payable,
  PayableInput,
  PayableStatus,
  PaymentRequest,
  Policy,
  RequestResult,
  RollingEntry,
  SEVEN_DAYS_NS,
  SettlementOutcome,
  SimulatorSnapshot,
  Usage,
  VaultConfig,
  VaultRejectionCode,
  Vendor,
  VendorInput,
} from "./types.js";

const U128_MAX = (1n << 128n) - 1n;

function checkedAdd(a: bigint, b: bigint, label: string): bigint {
  const result = a + b;
  if (result < a || result > U128_MAX) {
    throw new VaultAdminError("ARITHMETIC_OVERFLOW", `${label} overflowed`);
  }
  return result;
}

function assertU128(value: bigint, label: string): void {
  if (value < 0n || value > U128_MAX) {
    throw new VaultAdminError("INVALID_U128", `${label} must fit an unsigned 128-bit integer`);
  }
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, "en");
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export class VaultSimulator {
  private readonly config: VaultConfig;
  private paused = true;
  private policy: Policy;
  private binding?: AgentBinding;
  private readonly vendors = new Map<string, Vendor>();
  private readonly payables = new Map<string, Payable>();
  private readonly operations = new Map<number, Operation>();
  private rollingEntries: RollingEntry[] = [];
  private nextOperationId = 1;
  private settledAgentTotalAtomic = 0n;
  private reservedAgentTotalAtomic = 0n;
  private ownerPaidTotalAtomic = 0n;
  private recordedBalanceAtomic = 0n;
  private availableBalanceAtomic = 0n;
  private pendingOperations = 0;
  private pendingAgentOperations = 0;
  private withdrawalOperationId: number | undefined;

  public constructor(config: VaultConfig) {
    assertU128(config.weeklyCapAtomic, "weekly cap");
    assertU128(config.lifetimeCeilingAtomic, "lifetime ceiling");
    if (config.lifetimeCeilingAtomic < config.weeklyCapAtomic) {
      // This is allowed, but it is usually a configuration mistake. The
      // lifetime ceiling remains the tighter limit.
    }
    if (config.tokenDecimals < 0 || config.tokenDecimals > 24) {
      throw new VaultAdminError("INVALID_TOKEN_DECIMALS", "token decimals must be between 0 and 24");
    }
    for (const [name, value] of Object.entries(config.capacities)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new VaultAdminError("INVALID_CAPACITY", `${name} must be a positive safe integer`);
      }
    }
    this.config = config;
    this.policy = {
      weeklyCapAtomic: config.weeklyCapAtomic,
      lifetimeCeilingAtomic: config.lifetimeCeilingAtomic,
      revision: 1,
    };
  }

  public getConfig(): VaultConfig {
    return this.config;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public getPolicy(): Policy {
    return { ...this.policy };
  }

  public getBinding(): AgentBinding | undefined {
    return this.binding === undefined ? undefined : { ...this.binding };
  }

  public getVendor(vendorId: string): Vendor | undefined {
    const vendor = this.vendors.get(vendorId);
    return vendor === undefined ? undefined : { ...vendor };
  }

  public getPayable(payableRef: string): Payable | undefined {
    const payable = this.payables.get(payableRef);
    return payable === undefined ? undefined : { ...payable };
  }

  public getOperation(operationId: number): Operation | undefined {
    const operation = this.operations.get(operationId);
    return operation === undefined ? undefined : { ...operation };
  }

  public listVendors(): readonly Vendor[] {
    return [...this.vendors.values()].map((vendor) => ({ ...vendor })).sort((a, b) => compareStrings(a.vendorId, b.vendorId));
  }

  public pause(context: OwnerContext): void {
    const caller = context.predecessorAccountId;
    if (caller !== this.config.ownerId && caller !== this.config.guardianId) {
      throw new VaultAdminError("UNAUTHORIZED", "only owner or guardian may pause");
    }
    this.paused = true;
  }

  public unpause(context: OwnerContext): void {
    this.assertOwner(context);
    this.paused = false;
  }

  public setVendor(context: OwnerContext, input: VendorInput, expectedRevision: number): Vendor {
    this.assertOwner(context);
    this.assertIdentifier(input.vendorId, "vendor id");
    assertU128(input.perPaymentCapAtomic, "per-payment cap");
    const current = this.vendors.get(input.vendorId);
    if (current === undefined) {
      if (expectedRevision !== 0) {
        throw new VaultAdminError("STALE_VENDOR_REVISION", "new vendor expects revision 0");
      }
      if (this.vendors.size >= this.config.capacities.maxVendors) {
        throw new VaultAdminError("VENDOR_CAPACITY_EXHAUSTED", "vendor capacity is exhausted");
      }
      const vendor: Vendor = { ...input, revision: 1 };
      this.vendors.set(input.vendorId, vendor);
      return { ...vendor };
    }
    if (current.revision !== expectedRevision) {
      throw new VaultAdminError("STALE_VENDOR_REVISION", "vendor revision does not match");
    }
    const vendor: Vendor = { ...input, revision: this.incrementRevision(current.revision, "vendor") };
    this.vendors.set(input.vendorId, vendor);
    return { ...vendor };
  }

  public registerPayable(context: OwnerContext, input: PayableInput): Payable {
    this.assertOwner(context);
    this.assertIdentifier(input.payableRef, "payable reference");
    this.assertIdentifier(input.poNumber, "purchase order number");
    assertU128(input.amountAtomic, "payable amount");
    if (input.amountAtomic === 0n) {
      throw new VaultAdminError("ZERO_AMOUNT", "payable amount must be positive");
    }
    if (!(input.notBeforeNs <= input.dueAtNs && input.dueAtNs <= input.expiresAtNs)) {
      throw new VaultAdminError("INVALID_TIME_WINDOW", "payable timestamps must be ordered");
    }
    if (this.payables.has(input.payableRef)) {
      throw new VaultAdminError("DUPLICATE_PAYABLE", "payable reference already exists");
    }
    if (this.payables.size >= this.config.capacities.maxPayables) {
      throw new VaultAdminError("PAYABLE_CAPACITY_EXHAUSTED", "payable capacity is exhausted");
    }
    const vendor = this.vendors.get(input.vendorId);
    if (vendor === undefined) {
      throw new VaultAdminError("UNKNOWN_VENDOR", "vendor must exist before payable registration");
    }
    if (vendor.revision !== input.vendorRevision) {
      throw new VaultAdminError("STALE_VENDOR_REVISION", "payable vendor revision is stale");
    }
    const payable: Payable = {
      ...input,
      recipient: vendor.recipient,
      status: PayableStatus.OPEN,
    };
    this.payables.set(input.payableRef, payable);
    return { ...payable };
  }

  public setPolicy(
    context: OwnerContext,
    change: { readonly weeklyCapAtomic: AtomicAmount; readonly lifetimeCeilingAtomic: AtomicAmount },
    expectedRevision: number,
  ): Policy {
    this.assertOwner(context);
    assertU128(change.weeklyCapAtomic, "weekly cap");
    assertU128(change.lifetimeCeilingAtomic, "lifetime ceiling");
    if (this.policy.revision !== expectedRevision) {
      throw new VaultAdminError("STALE_POLICY_REVISION", "policy revision does not match");
    }
    const committed = checkedAdd(this.settledAgentTotalAtomic, this.reservedAgentTotalAtomic, "committed agent spend");
    if (change.lifetimeCeilingAtomic < committed) {
      throw new VaultAdminError("CEILING_BELOW_COMMITTED", "lifetime ceiling cannot be below settled plus reserved spend");
    }
    const weeklyCommitted = checkedAdd(this.rollingTotal(context.nowNs), this.reservedAgentTotalAtomic, "weekly committed spend");
    if (change.weeklyCapAtomic < weeklyCommitted) {
      throw new VaultAdminError("WEEKLY_CAP_BELOW_COMMITTED", "weekly cap cannot be below rolling settled plus reserved spend");
    }
    this.policy = {
      ...change,
      revision: this.incrementRevision(this.policy.revision, "policy"),
    };
    return { ...this.policy };
  }

  public activateAgent(context: OwnerContext, input: AgentBindingInput, expectedRevision: number): AgentBinding {
    this.assertOwner(context);
    this.assertDigest(input.manifestDigest, "manifest digest");
    if (input.validFromNs > input.expiresAtNs) {
      throw new VaultAdminError("INVALID_BINDING_WINDOW", "binding validity interval is inverted");
    }
    const currentRevision = this.binding?.revision ?? 0;
    if (currentRevision !== expectedRevision) {
      throw new VaultAdminError("STALE_BINDING_REVISION", "binding revision does not match");
    }
    const binding: AgentBinding = {
      ...input,
      enabled: true,
      revision: this.incrementRevision(currentRevision, "binding"),
    };
    this.binding = binding;
    return { ...binding };
  }

  public revokeAgent(context: OwnerContext, expectedRevision: number): AgentBinding {
    this.assertOwner(context);
    const binding = this.binding;
    if (binding === undefined || binding.revision !== expectedRevision) {
      throw new VaultAdminError("STALE_BINDING_REVISION", "binding revision does not match");
    }
    this.binding = {
      ...binding,
      enabled: false,
      revision: this.incrementRevision(binding.revision, "binding"),
    };
    return { ...this.binding };
  }

  public fund(tokenContractId: string, amountAtomic: AtomicAmount): void {
    if (tokenContractId !== this.config.tokenContractId) {
      throw new VaultAdminError("WRONG_TOKEN", "only the fixed token contract may fund the vault");
    }
    assertU128(amountAtomic, "funding amount");
    if (amountAtomic === 0n) {
      throw new VaultAdminError("ZERO_AMOUNT", "funding amount must be positive");
    }
    this.recordedBalanceAtomic = checkedAdd(this.recordedBalanceAtomic, amountAtomic, "recorded balance");
    this.availableBalanceAtomic = checkedAdd(this.availableBalanceAtomic, amountAtomic, "available balance");
  }

  public requestPayment(context: CallContext, request: PaymentRequest): RequestResult {
    const payable = this.payables.get(request.payableRef);
    const rejected = (code: VaultRejectionCode, vendorRevision?: number, requestedAmountAtomic?: bigint): RequestResult =>
      this.rejection(code, context.nowNs, request.payableRef, vendorRevision, requestedAmountAtomic);

    if (this.paused) {
      return rejected(VaultRejectionCode.VAULT_PAUSED);
    }
    if (context.attachedDepositYocto !== 0n) {
      return rejected(VaultRejectionCode.NON_ZERO_ATTACHED_DEPOSIT);
    }
    if (context.predecessorAccountId !== context.signerAccountId) {
      return rejected(VaultRejectionCode.CALLER_SIGNER_MISMATCH);
    }
    const binding = this.binding;
    if (binding === undefined || context.predecessorAccountId !== binding.accountId) {
      return rejected(VaultRejectionCode.AGENT_ACCOUNT_MISMATCH);
    }
    if (context.signerPublicKey !== binding.publicKey) {
      return rejected(VaultRejectionCode.AGENT_KEY_MISMATCH);
    }
    if (!binding.enabled) {
      return rejected(VaultRejectionCode.AGENT_BINDING_DISABLED);
    }
    if (context.nowNs < binding.validFromNs) {
      return rejected(VaultRejectionCode.AGENT_BINDING_NOT_YET_VALID);
    }
    if (context.nowNs > binding.expiresAtNs) {
      return rejected(VaultRejectionCode.AGENT_BINDING_EXPIRED);
    }
    if (request.expectedBindingRevision !== binding.revision) {
      return rejected(VaultRejectionCode.STALE_BINDING_REVISION);
    }
    if (payable === undefined) {
      return rejected(VaultRejectionCode.UNKNOWN_PAYABLE);
    }
    if (
      utf8ByteLength(request.requestDigest) === 0 ||
      utf8ByteLength(request.requestDigest) > this.config.capacities.maxDigestLength
    ) {
      return rejected(
        VaultRejectionCode.INVALID_REQUEST_DIGEST,
        payable.vendorRevision,
        payable.amountAtomic,
      );
    }
    if (
      (payable.status === PayableStatus.PENDING_AGENT || payable.status === PayableStatus.SETTLED) &&
      payable.requestDigest === request.requestDigest &&
      payable.operationId !== undefined
    ) {
      return {
        accepted: true,
        existing: true,
        operationId: payable.operationId,
        status: payable.status,
      };
    }
    if (payable.requestDigest !== undefined && payable.requestDigest !== request.requestDigest) {
      return rejected(
        VaultRejectionCode.REQUEST_DIGEST_CONFLICT,
        payable.vendorRevision,
        payable.amountAtomic,
      );
    }
    if (payable.status !== PayableStatus.OPEN) {
      return rejected(
        VaultRejectionCode.PAYABLE_NOT_OPEN,
        payable.vendorRevision,
        payable.amountAtomic,
      );
    }
    if (context.nowNs < payable.notBeforeNs) {
      return rejected(VaultRejectionCode.PAYABLE_TOO_EARLY, payable.vendorRevision, payable.amountAtomic);
    }
    if (context.nowNs > payable.expiresAtNs) {
      return rejected(VaultRejectionCode.PAYABLE_EXPIRED, payable.vendorRevision, payable.amountAtomic);
    }
    const vendor = this.vendors.get(payable.vendorId);
    if (vendor === undefined) {
      return rejected(VaultRejectionCode.UNKNOWN_VENDOR, undefined, payable.amountAtomic);
    }
    if (!vendor.enabled) {
      return rejected(VaultRejectionCode.VENDOR_DISABLED, vendor.revision, payable.amountAtomic);
    }
    if (request.expectedVendorRevision !== vendor.revision || payable.vendorRevision !== vendor.revision) {
      return rejected(VaultRejectionCode.STALE_VENDOR_REVISION, vendor.revision, payable.amountAtomic);
    }
    if (request.expectedPolicyRevision !== this.policy.revision) {
      return rejected(VaultRejectionCode.STALE_POLICY_REVISION, vendor.revision, payable.amountAtomic);
    }
    if (payable.amountAtomic > vendor.perPaymentCapAtomic) {
      return rejected(VaultRejectionCode.AMOUNT_OVER_VENDOR_CAP, vendor.revision, payable.amountAtomic);
    }
    this.pruneRolling(context.nowNs);
    const rolling = this.rollingTotal(context.nowNs);
    const weeklyCommitted = checkedAdd(rolling, this.reservedAgentTotalAtomic, "weekly committed");
    if (
      weeklyCommitted > this.policy.weeklyCapAtomic ||
      payable.amountAtomic > this.policy.weeklyCapAtomic - weeklyCommitted
    ) {
      return rejected(VaultRejectionCode.WEEKLY_CAP_EXCEEDED, vendor.revision, payable.amountAtomic);
    }
    const lifetimeCommitted = checkedAdd(this.settledAgentTotalAtomic, this.reservedAgentTotalAtomic, "lifetime committed");
    if (
      lifetimeCommitted > this.policy.lifetimeCeilingAtomic ||
      payable.amountAtomic > this.policy.lifetimeCeilingAtomic - lifetimeCommitted
    ) {
      return rejected(VaultRejectionCode.LIFETIME_CEILING_EXCEEDED, vendor.revision, payable.amountAtomic);
    }
    if (this.availableBalanceAtomic < payable.amountAtomic) {
      return rejected(VaultRejectionCode.INSUFFICIENT_RECORDED_BALANCE, vendor.revision, payable.amountAtomic);
    }
    const capacityRejection = this.capacityRejection(true);
    if (capacityRejection !== undefined) {
      return rejected(capacityRejection, vendor.revision, payable.amountAtomic);
    }
    const operation = this.reservePayable(payable, vendor, OperationActor.AGENT, context.nowNs, request.requestDigest);
    return {
      accepted: true,
      existing: false,
      operationId: operation.operationId,
      status: PayableStatus.PENDING_AGENT,
    };
  }

  public ownerPay(context: OwnerContext, payableRef: string): RequestResult {
    this.assertOwner(context);
    if (this.paused) {
      return this.rejection(VaultRejectionCode.VAULT_PAUSED, context.nowNs, payableRef);
    }
    const payable = this.payables.get(payableRef);
    if (payable === undefined) {
      return this.rejection(VaultRejectionCode.UNKNOWN_PAYABLE, context.nowNs, payableRef);
    }
    if (payable.status !== PayableStatus.OPEN) {
      return this.rejection(VaultRejectionCode.PAYABLE_NOT_OPEN, context.nowNs, payableRef, payable.vendorRevision, payable.amountAtomic);
    }
    if (context.nowNs < payable.notBeforeNs) {
      return this.rejection(VaultRejectionCode.PAYABLE_TOO_EARLY, context.nowNs, payableRef, payable.vendorRevision, payable.amountAtomic);
    }
    if (context.nowNs > payable.expiresAtNs) {
      return this.rejection(VaultRejectionCode.PAYABLE_EXPIRED, context.nowNs, payableRef, payable.vendorRevision, payable.amountAtomic);
    }
    const vendor = this.vendors.get(payable.vendorId);
    if (vendor === undefined) {
      return this.rejection(VaultRejectionCode.UNKNOWN_VENDOR, context.nowNs, payableRef, undefined, payable.amountAtomic);
    }
    if (!vendor.enabled) {
      return this.rejection(VaultRejectionCode.VENDOR_DISABLED, context.nowNs, payableRef, vendor.revision, payable.amountAtomic);
    }
    if (vendor.revision !== payable.vendorRevision) {
      return this.rejection(VaultRejectionCode.STALE_VENDOR_REVISION, context.nowNs, payableRef, vendor.revision, payable.amountAtomic);
    }
    if (this.availableBalanceAtomic < payable.amountAtomic) {
      return this.rejection(VaultRejectionCode.INSUFFICIENT_RECORDED_BALANCE, context.nowNs, payableRef, vendor.revision, payable.amountAtomic);
    }
    const capacityRejection = this.capacityRejection(false);
    if (capacityRejection !== undefined) {
      return this.rejection(capacityRejection, context.nowNs, payableRef, vendor.revision, payable.amountAtomic);
    }
    const operation = this.reservePayable(payable, vendor, OperationActor.OWNER, context.nowNs);
    return {
      accepted: true,
      existing: false,
      operationId: operation.operationId,
      status: PayableStatus.PENDING_OWNER,
    };
  }

  public settlePayment(operationId: number, outcome: SettlementOutcome, nowNs: Nanoseconds): Operation {
    const operation = this.operations.get(operationId);
    if (operation === undefined || operation.actor === OperationActor.WITHDRAWAL) {
      throw new VaultAdminError("UNKNOWN_OPERATION", "payment operation does not exist");
    }
    if (operation.status !== OperationStatus.DISPATCHED) {
      return { ...operation };
    }
    const payableRef = operation.payableRef;
    if (payableRef === undefined) {
      throw new VaultAdminError("CORRUPT_OPERATION", "payment operation has no payable reference");
    }
    const payable = this.payables.get(payableRef);
    if (payable === undefined || payable.operationId !== operationId) {
      throw new VaultAdminError("CORRUPT_OPERATION", "operation and payable are not linked");
    }
    if (outcome === SettlementOutcome.SUCCESS) {
      operation.status = OperationStatus.SETTLED;
      operation.settledAtNs = nowNs;
      payable.status = PayableStatus.SETTLED;
      this.pendingOperations -= 1;
      this.recordedBalanceAtomic -= operation.amountAtomic;
      if (operation.actor === OperationActor.AGENT) {
        this.reservedAgentTotalAtomic -= operation.amountAtomic;
        this.settledAgentTotalAtomic = checkedAdd(this.settledAgentTotalAtomic, operation.amountAtomic, "settled agent total");
        this.pendingAgentOperations -= 1;
        this.rollingEntries.push({ operationId, amountAtomic: operation.amountAtomic, settledAtNs: nowNs });
      } else {
        this.ownerPaidTotalAtomic = checkedAdd(this.ownerPaidTotalAtomic, operation.amountAtomic, "owner paid total");
      }
    } else if (outcome === SettlementOutcome.KNOWN_FAILURE) {
      operation.status = OperationStatus.FAILED_KNOWN;
      operation.settledAtNs = nowNs;
      operation.failureCategory = "TOKEN_TRANSFER_FAILED";
      payable.status = PayableStatus.FAILED_KNOWN;
      this.pendingOperations -= 1;
      this.availableBalanceAtomic = checkedAdd(this.availableBalanceAtomic, operation.amountAtomic, "released balance");
      if (operation.actor === OperationActor.AGENT) {
        this.reservedAgentTotalAtomic -= operation.amountAtomic;
        this.pendingAgentOperations -= 1;
      }
    } else {
      operation.status = OperationStatus.RECONCILIATION;
      operation.failureCategory = "AMBIGUOUS_RESULT";
      payable.status = PayableStatus.RECONCILIATION;
      // Reservations and pending capacity intentionally remain consumed.
    }
    return { ...operation };
  }

  public reopenFailedPayable(context: OwnerContext, payableRef: string): Payable {
    this.assertOwner(context);
    const payable = this.payables.get(payableRef);
    if (payable === undefined || payable.status !== PayableStatus.FAILED_KNOWN) {
      throw new VaultAdminError("PAYABLE_NOT_FAILED", "only a known-failed payable may be reopened");
    }
    payable.status = PayableStatus.OPEN;
    delete payable.operationId;
    delete payable.requestDigest;
    return { ...payable };
  }

  public requestWithdrawal(context: OwnerContext, recipient: string, amountAtomic: AtomicAmount): Operation {
    this.assertOwner(context);
    assertU128(amountAtomic, "withdrawal amount");
    if (!this.paused) {
      throw new VaultAdminError("VAULT_NOT_PAUSED", "withdrawal requires paused state");
    }
    if (this.pendingOperations !== 0 || this.withdrawalOperationId !== undefined) {
      throw new VaultAdminError("UNRESOLVED_OPERATION", "withdrawal requires no unresolved operation");
    }
    if (amountAtomic === 0n || amountAtomic > this.availableBalanceAtomic) {
      throw new VaultAdminError("INSUFFICIENT_RECORDED_BALANCE", "withdrawal amount is unavailable");
    }
    if (this.operations.size >= this.config.capacities.maxOperations) {
      throw new VaultAdminError("OPERATION_CAPACITY_EXHAUSTED", "operation capacity is exhausted");
    }
    const operation: Operation = {
      operationId: this.allocateOperationId(),
      actor: OperationActor.WITHDRAWAL,
      amountAtomic,
      recipient,
      createdAtNs: context.nowNs,
      status: OperationStatus.DISPATCHED,
    };
    this.operations.set(operation.operationId, operation);
    this.withdrawalOperationId = operation.operationId;
    this.availableBalanceAtomic -= amountAtomic;
    return { ...operation };
  }

  public settleWithdrawal(operationId: number, outcome: SettlementOutcome, nowNs: Nanoseconds): Operation {
    const operation = this.operations.get(operationId);
    if (operation === undefined || operation.actor !== OperationActor.WITHDRAWAL) {
      throw new VaultAdminError("UNKNOWN_OPERATION", "withdrawal operation does not exist");
    }
    if (operation.status !== OperationStatus.DISPATCHED) {
      return { ...operation };
    }
    if (this.withdrawalOperationId !== operationId) {
      throw new VaultAdminError("CORRUPT_OPERATION", "active withdrawal pointer does not match");
    }
    if (outcome === SettlementOutcome.SUCCESS) {
      operation.status = OperationStatus.SETTLED;
      operation.settledAtNs = nowNs;
      this.recordedBalanceAtomic -= operation.amountAtomic;
      this.withdrawalOperationId = undefined;
    } else if (outcome === SettlementOutcome.KNOWN_FAILURE) {
      operation.status = OperationStatus.FAILED_KNOWN;
      operation.settledAtNs = nowNs;
      operation.failureCategory = "TOKEN_TRANSFER_FAILED";
      this.availableBalanceAtomic = checkedAdd(this.availableBalanceAtomic, operation.amountAtomic, "released withdrawal");
      this.withdrawalOperationId = undefined;
    } else {
      operation.status = OperationStatus.RECONCILIATION;
      operation.failureCategory = "AMBIGUOUS_RESULT";
      // The withdrawal reservation remains consumed.
    }
    return { ...operation };
  }

  public getUsage(nowNs: Nanoseconds): Usage {
    return {
      settledAgentTotalAtomic: this.settledAgentTotalAtomic,
      reservedAgentTotalAtomic: this.reservedAgentTotalAtomic,
      ownerPaidTotalAtomic: this.ownerPaidTotalAtomic,
      rollingSettledAtomic: this.rollingTotal(nowNs),
      weeklyCapAtomic: this.policy.weeklyCapAtomic,
      lifetimeCeilingAtomic: this.policy.lifetimeCeilingAtomic,
      recordedBalanceAtomic: this.recordedBalanceAtomic,
      availableBalanceAtomic: this.availableBalanceAtomic,
      pendingOperations: this.pendingOperations,
      pendingAgentOperations: this.pendingAgentOperations,
    };
  }

  public assertInvariants(nowNs: Nanoseconds): void {
    const reservedFromOperations = [...this.operations.values()]
      .filter((operation) => operation.actor === OperationActor.AGENT)
      .filter((operation) => operation.status === OperationStatus.DISPATCHED || operation.status === OperationStatus.RECONCILIATION)
      .reduce((sum, operation) => sum + operation.amountAtomic, 0n);
    if (reservedFromOperations !== this.reservedAgentTotalAtomic) {
      throw new VaultAdminError("INVARIANT_RESERVED", "reserved total does not match unresolved agent operations");
    }
    if (this.settledAgentTotalAtomic + this.reservedAgentTotalAtomic > this.policy.lifetimeCeilingAtomic) {
      throw new VaultAdminError("INVARIANT_LIFETIME", "settled plus reserved exceeds lifetime ceiling");
    }
    if (this.rollingTotal(nowNs) + this.reservedAgentTotalAtomic > this.policy.weeklyCapAtomic) {
      throw new VaultAdminError("INVARIANT_WEEKLY", "rolling plus reserved exceeds weekly cap");
    }
    const unresolvedOutgoing = [...this.operations.values()]
      .filter((operation) => operation.status === OperationStatus.DISPATCHED || operation.status === OperationStatus.RECONCILIATION)
      .reduce((sum, operation) => sum + operation.amountAtomic, 0n);
    if (this.availableBalanceAtomic + unresolvedOutgoing !== this.recordedBalanceAtomic) {
      throw new VaultAdminError("INVARIANT_BALANCE", "available plus unresolved outgoing does not equal recorded balance");
    }
    const successfulByPayable = new Map<string, number>();
    for (const operation of this.operations.values()) {
      if (operation.status === OperationStatus.SETTLED && operation.payableRef !== undefined) {
        successfulByPayable.set(operation.payableRef, (successfulByPayable.get(operation.payableRef) ?? 0) + 1);
      }
    }
    for (const count of successfulByPayable.values()) {
      if (count > 1) {
        throw new VaultAdminError("INVARIANT_DOUBLE_PAYMENT", "a payable settled more than once");
      }
    }
    const unresolvedCount = [...this.operations.values()].filter(
      (operation) =>
        operation.actor !== OperationActor.WITHDRAWAL &&
        (operation.status === OperationStatus.DISPATCHED || operation.status === OperationStatus.RECONCILIATION),
    ).length;
    if (unresolvedCount !== this.pendingOperations) {
      throw new VaultAdminError("INVARIANT_PENDING", "pending count does not match unresolved payments");
    }
    const unresolvedAgentCount = [...this.operations.values()].filter(
      (operation) =>
        operation.actor === OperationActor.AGENT &&
        (operation.status === OperationStatus.DISPATCHED || operation.status === OperationStatus.RECONCILIATION),
    ).length;
    if (unresolvedAgentCount !== this.pendingAgentOperations) {
      throw new VaultAdminError(
        "INVARIANT_PENDING_AGENT",
        "pending agent count does not match unresolved agent payments",
      );
    }
  }

  public snapshot(): SimulatorSnapshot {
    const encode = (value: unknown): unknown => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (Array.isArray(value)) {
        return value.map(encode);
      }
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
      }
      return value;
    };
    return {
      paused: this.paused,
      policy: {
        weeklyCapAtomic: this.policy.weeklyCapAtomic.toString(),
        lifetimeCeilingAtomic: this.policy.lifetimeCeilingAtomic.toString(),
        revision: this.policy.revision,
      },
      settledAgentTotalAtomic: this.settledAgentTotalAtomic.toString(),
      reservedAgentTotalAtomic: this.reservedAgentTotalAtomic.toString(),
      ownerPaidTotalAtomic: this.ownerPaidTotalAtomic.toString(),
      recordedBalanceAtomic: this.recordedBalanceAtomic.toString(),
      availableBalanceAtomic: this.availableBalanceAtomic.toString(),
      pendingOperations: this.pendingOperations,
      pendingAgentOperations: this.pendingAgentOperations,
      vendors: encode(this.listVendors()) as readonly unknown[],
      payables: encode([...this.payables.values()].sort((a, b) => compareStrings(a.payableRef, b.payableRef))) as readonly unknown[],
      operations: encode([...this.operations.values()].sort((a, b) => a.operationId - b.operationId)) as readonly unknown[],
      rollingEntries: encode([...this.rollingEntries]) as readonly unknown[],
    };
  }

  private assertOwner(context: OwnerContext): void {
    if (context.predecessorAccountId !== this.config.ownerId) {
      throw new VaultAdminError("UNAUTHORIZED", "owner signature required");
    }
  }

  private assertIdentifier(value: string, label: string): void {
    const length = utf8ByteLength(value);
    if (length === 0 || length > this.config.capacities.maxIdentifierLength) {
      throw new VaultAdminError("INVALID_IDENTIFIER", `${label} length is invalid`);
    }
  }

  private assertDigest(value: string, label: string): void {
    const length = utf8ByteLength(value);
    if (length === 0 || length > this.config.capacities.maxDigestLength) {
      throw new VaultAdminError("INVALID_DIGEST", `${label} length is invalid`);
    }
  }

  private incrementRevision(current: number, label: string): number {
    if (!Number.isSafeInteger(current) || current >= Number.MAX_SAFE_INTEGER) {
      throw new VaultAdminError("REVISION_OVERFLOW", `${label} revision cannot increase`);
    }
    return current + 1;
  }

  private allocateOperationId(): number {
    if (!Number.isSafeInteger(this.nextOperationId)) {
      throw new VaultAdminError("OPERATION_ID_OVERFLOW", "operation id cannot increase");
    }
    return this.nextOperationId++;
  }

  private capacityRejection(agent: boolean): VaultRejectionCode | undefined {
    if (this.operations.size >= this.config.capacities.maxOperations) {
      return VaultRejectionCode.OPERATION_CAPACITY_EXHAUSTED;
    }
    if (this.pendingOperations >= this.config.capacities.maxPendingOperations) {
      return VaultRejectionCode.PENDING_CAPACITY_EXHAUSTED;
    }
    if (agent) {
      if (
        this.rollingEntries.length + this.pendingAgentOperations >=
        this.config.capacities.maxRollingEntries
      ) {
        return VaultRejectionCode.ROLLING_CAPACITY_EXHAUSTED;
      }
    }
    return undefined;
  }

  private reservePayable(
    payable: Payable,
    vendor: Vendor,
    actor: OperationActor,
    nowNs: Nanoseconds,
    requestDigest?: string,
  ): Operation {
    const operation: Operation = {
      operationId: this.allocateOperationId(),
      actor,
      payableRef: payable.payableRef,
      ...(requestDigest === undefined ? {} : { requestDigest }),
      amountAtomic: payable.amountAtomic,
      recipient: payable.recipient,
      createdAtNs: nowNs,
      status: OperationStatus.DISPATCHED,
    };
    this.operations.set(operation.operationId, operation);
    payable.status = actor === OperationActor.AGENT ? PayableStatus.PENDING_AGENT : PayableStatus.PENDING_OWNER;
    payable.operationId = operation.operationId;
    if (requestDigest !== undefined) {
      payable.requestDigest = requestDigest;
    }
    this.availableBalanceAtomic -= payable.amountAtomic;
    if (actor === OperationActor.AGENT) {
      this.reservedAgentTotalAtomic = checkedAdd(this.reservedAgentTotalAtomic, payable.amountAtomic, "reserved agent total");
      this.pendingAgentOperations += 1;
    }
    this.pendingOperations += 1;
    return operation;
  }

  private pruneRolling(nowNs: Nanoseconds): void {
    if (nowNs < SEVEN_DAYS_NS) {
      return;
    }
    const threshold = nowNs - SEVEN_DAYS_NS;
    this.rollingEntries = this.rollingEntries.filter((entry) => entry.settledAtNs > threshold);
  }

  private rollingTotal(nowNs: Nanoseconds): bigint {
    const active = nowNs < SEVEN_DAYS_NS
      ? this.rollingEntries
      : this.rollingEntries.filter((entry) => entry.settledAtNs > nowNs - SEVEN_DAYS_NS);
    return active.reduce((sum, entry) => sum + entry.amountAtomic, 0n);
  }

  private rejection(
    code: VaultRejectionCode,
    nowNs: Nanoseconds,
    payableRef?: string,
    vendorRevision?: number,
    requestedAmountAtomic?: bigint,
  ): RequestResult {
    const bindingRevision = this.binding?.revision;
    return {
      accepted: false,
      rejection: {
        code,
        humanReview: true,
        ...(payableRef === undefined ? {} : { payableRef }),
        ...(requestedAmountAtomic === undefined ? {} : { requestedAmountAtomic }),
        policyRevision: this.policy.revision,
        ...(vendorRevision === undefined ? {} : { vendorRevision }),
        ...(bindingRevision === undefined ? {} : { bindingRevision }),
        usage: this.getUsage(nowNs),
      },
    };
  }
}

type Nanoseconds = bigint;
