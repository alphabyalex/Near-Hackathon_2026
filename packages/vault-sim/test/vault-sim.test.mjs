import test from "node:test";
import assert from "node:assert/strict";
import {
  PayableStatus,
  SEVEN_DAYS_NS,
  SettlementOutcome,
  VaultRejectionCode,
  VaultSimulator,
} from "../dist/index.js";

const NS = 1_000_000_000n;
const DAY = 24n * 60n * 60n * NS;
const OWNER = "owner.testnet";
const GUARDIAN = "guardian.testnet";
const AGENT = "agent.business-a.testnet";
const KEY = "ed25519:agent-key";
const VAULT = "vault-a.testnet";
const TOKEN = "sgusd.testnet";

function config(overrides = {}) {
  return {
    vaultId: VAULT,
    ownerId: OWNER,
    guardianId: GUARDIAN,
    tokenContractId: TOKEN,
    tokenDecimals: 6,
    weeklyCapAtomic: 1_000n,
    lifetimeCeilingAtomic: 3_000n,
    capacities: {
      maxVendors: 8,
      maxPayables: 64,
      maxOperations: 128,
      maxPendingOperations: 8,
      maxRollingEntries: 64,
      maxIdentifierLength: 96,
      maxDigestLength: 128,
    },
    ...overrides,
  };
}

function owner(nowNs = 10n * DAY) {
  return { predecessorAccountId: OWNER, nowNs };
}

function agent(nowNs = 10n * DAY, overrides = {}) {
  return {
    currentAccountId: VAULT,
    predecessorAccountId: AGENT,
    signerAccountId: AGENT,
    signerPublicKey: KEY,
    attachedDepositYocto: 0n,
    nowNs,
    ...overrides,
  };
}

function setup(overrides = {}) {
  const sim = new VaultSimulator(config(overrides));
  sim.setVendor(owner(), {
    vendorId: "vendor-a",
    recipient: "vendor-a.testnet",
    perPaymentCapAtomic: 500n,
    enabled: true,
  }, 0);
  sim.activateAgent(owner(), {
    accountId: AGENT,
    publicKey: KEY,
    manifestDigest: "sha256:manifest-v1",
    validFromNs: 1n,
    expiresAtNs: 100n * DAY,
  }, 0);
  sim.fund(TOKEN, 20_000n);
  sim.unpause(owner());
  return sim;
}

function addPayable(sim, ref, amount, options = {}) {
  const vendor = sim.getVendor("vendor-a");
  assert.ok(vendor);
  sim.registerPayable(owner(), {
    payableRef: ref,
    vendorId: "vendor-a",
    vendorRevision: vendor.revision,
    amountAtomic: amount,
    poNumber: `PO-${ref}`,
    notBeforeNs: 1n,
    dueAtNs: 20n * DAY,
    expiresAtNs: 30n * DAY,
    ...options,
  });
}

function request(sim, ref, digest = `digest:${ref}`, nowNs = 10n * DAY, overrides = {}) {
  const vendor = sim.getVendor("vendor-a");
  const binding = sim.getBinding();
  assert.ok(vendor && binding);
  return sim.requestPayment(agent(nowNs, overrides.context ?? {}), {
    payableRef: ref,
    requestDigest: digest,
    expectedPolicyRevision: sim.getPolicy().revision,
    expectedVendorRevision: vendor.revision,
    expectedBindingRevision: binding.revision,
    ...overrides.request,
  });
}

function expectRejected(result, code) {
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.rejection.code, code);
    assert.equal(result.rejection.humanReview, true);
  }
}

test("starts paused and enforces caller, signer, account, key, and deposit checks", () => {
  const sim = setup();
  addPayable(sim, "p1", 100n);

  sim.pause(owner());
  expectRejected(request(sim, "p1"), VaultRejectionCode.VAULT_PAUSED);
  sim.unpause(owner());

  expectRejected(request(sim, "p1", "d1", 10n * DAY, { context: { attachedDepositYocto: 1n } }), VaultRejectionCode.NON_ZERO_ATTACHED_DEPOSIT);
  expectRejected(request(sim, "p1", "d1", 10n * DAY, { context: { signerAccountId: "proxy.testnet" } }), VaultRejectionCode.CALLER_SIGNER_MISMATCH);
  expectRejected(request(sim, "p1", "d1", 10n * DAY, { context: { predecessorAccountId: "other.testnet", signerAccountId: "other.testnet" } }), VaultRejectionCode.AGENT_ACCOUNT_MISMATCH);
  expectRejected(request(sim, "p1", "d1", 10n * DAY, { context: { signerPublicKey: "ed25519:wrong" } }), VaultRejectionCode.AGENT_KEY_MISMATCH);
});

test("exact vendor cap is accepted and cap plus one is reviewed without mutation", () => {
  const sim = setup();
  addPayable(sim, "exact", 500n);
  addPayable(sim, "over", 501n);
  const accepted = request(sim, "exact");
  assert.equal(accepted.accepted, true);
  const before = sim.snapshot();
  expectRejected(request(sim, "over"), VaultRejectionCode.AMOUNT_OVER_VENDOR_CAP);
  assert.deepEqual(sim.snapshot(), before);
});

test("reservations prevent concurrent weekly and lifetime oversubscription", () => {
  const sim = setup({ weeklyCapAtomic: 1_000n, lifetimeCeilingAtomic: 1_000n });
  addPayable(sim, "a", 500n);
  addPayable(sim, "b", 500n);
  addPayable(sim, "c", 1n);
  assert.equal(request(sim, "a").accepted, true);
  assert.equal(request(sim, "b").accepted, true);
  expectRejected(request(sim, "c"), VaultRejectionCode.WEEKLY_CAP_EXCEEDED);
  const usage = sim.getUsage(10n * DAY);
  assert.equal(usage.reservedAgentTotalAtomic, 1_000n);
  sim.assertInvariants(10n * DAY);
});


test("pending agent operations reserve future rolling slots", () => {
  const sim = setup({
    capacities: {
      maxVendors: 8,
      maxPayables: 64,
      maxOperations: 128,
      maxPendingOperations: 8,
      maxRollingEntries: 2,
      maxIdentifierLength: 96,
      maxDigestLength: 128,
    },
  });
  addPayable(sim, "slot-a", 100n);
  addPayable(sim, "slot-b", 100n);
  addPayable(sim, "slot-c", 100n);
  const a = request(sim, "slot-a");
  const b = request(sim, "slot-b");
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, true);
  expectRejected(request(sim, "slot-c"), VaultRejectionCode.ROLLING_CAPACITY_EXHAUSTED);
  sim.settlePayment(a.operationId, SettlementOutcome.SUCCESS, 10n * DAY + 1n);
  sim.settlePayment(b.operationId, SettlementOutcome.SUCCESS, 10n * DAY + 2n);
  assert.equal(sim.snapshot().rollingEntries.length, 2);
});

test("malformed request digest is a structured rejection", () => {
  const sim = setup();
  addPayable(sim, "bad-digest", 100n);
  const result = request(sim, "bad-digest", "");
  expectRejected(result, VaultRejectionCode.INVALID_REQUEST_DIGEST);
  assert.equal(result.rejection.vendorRevision, 1);
  assert.equal(result.rejection.requestedAmountAtomic, 100n);
  assert.equal(sim.snapshot().operations.length, 0);
});

test("length limits use UTF-8 bytes and zero-value funding is rejected", () => {
  const custom = new VaultSimulator({
    ...config(),
    capacities: {
      ...config().capacities,
      maxIdentifierLength: 4,
      maxDigestLength: 4,
    },
  });
  custom.setVendor(owner(), {
    vendorId: "éé",
    recipient: "vendor.testnet",
    perPaymentCapAtomic: 100n,
    enabled: true,
  }, 0);
  assert.throws(
    () => custom.setVendor(owner(), {
      vendorId: "ééa",
      recipient: "vendor-2.testnet",
      perPaymentCapAtomic: 100n,
      enabled: true,
    }, 0),
    /length is invalid/,
  );
  assert.throws(() => custom.fund(TOKEN, 0n), /must be positive/);
});

test("payables lock the recipient recorded at registration", () => {
  const sim = setup();
  addPayable(sim, "locked-recipient", 100n);
  const payable = sim.getPayable("locked-recipient");
  assert.equal(payable.recipient, "vendor-a.testnet");
  const accepted = request(sim, "locked-recipient");
  assert.equal(accepted.accepted, true);
  assert.equal(sim.getOperation(accepted.operationId).recipient, "vendor-a.testnet");
});

test("pending agent usage follows dispatched and reconciliation operations", () => {
  const sim = setup();
  addPayable(sim, "pending-count", 100n);
  const accepted = request(sim, "pending-count");
  assert.equal(accepted.accepted, true);
  assert.equal(sim.getUsage(10n * DAY).pendingAgentOperations, 1);
  sim.settlePayment(accepted.operationId, SettlementOutcome.AMBIGUOUS, 10n * DAY + 1n);
  assert.equal(sim.getUsage(10n * DAY + 1n).pendingAgentOperations, 1);
  sim.assertInvariants(10n * DAY + 1n);
});

test("weekly policy cannot be lowered below rolling settled plus reservations", () => {
  const sim = setup();
  addPayable(sim, "rolling", 300n);
  addPayable(sim, "reserved", 200n);
  const rolling = request(sim, "rolling");
  assert.equal(rolling.accepted, true);
  sim.settlePayment(rolling.operationId, SettlementOutcome.SUCCESS, 10n * DAY);
  assert.equal(request(sim, "reserved").accepted, true);
  assert.throws(
    () => sim.setPolicy(owner(), { weeklyCapAtomic: 499n, lifetimeCeilingAtomic: 3_000n }, sim.getPolicy().revision),
    /below rolling settled plus reserved/,
  );
});

test("same digest is idempotent and a conflicting digest never dispatches", () => {
  const sim = setup();
  addPayable(sim, "replay", 200n);
  const first = request(sim, "replay", "same");
  assert.equal(first.accepted, true);
  assert.equal(first.existing, false);
  const replay = request(sim, "replay", "same");
  assert.equal(replay.accepted, true);
  assert.equal(replay.existing, true);
  assert.equal(replay.operationId, first.operationId);
  expectRejected(request(sim, "replay", "different"), VaultRejectionCode.REQUEST_DIGEST_CONFLICT);
  assert.equal(sim.snapshot().operations.length, 1);
});

test("known token failure releases exactly once and requires owner reopen", () => {
  const sim = setup();
  addPayable(sim, "fail", 250n);
  const result = request(sim, "fail");
  assert.equal(result.accepted, true);
  const failed = sim.settlePayment(result.operationId, SettlementOutcome.KNOWN_FAILURE, 10n * DAY + 1n);
  assert.equal(failed.status, "FAILED_KNOWN");
  const afterFirst = sim.snapshot();
  sim.settlePayment(result.operationId, SettlementOutcome.KNOWN_FAILURE, 10n * DAY + 2n);
  assert.deepEqual(sim.snapshot(), afterFirst);
  assert.equal(sim.getUsage(10n * DAY).reservedAgentTotalAtomic, 0n);
  assert.equal(sim.getPayable("fail").status, PayableStatus.FAILED_KNOWN);
  sim.reopenFailedPayable(owner(), "fail");
  assert.equal(sim.getPayable("fail").status, PayableStatus.OPEN);
  assert.equal(request(sim, "fail", "retry").accepted, true);
});

test("ambiguous settlement preserves every reservation and locks the payable", () => {
  const sim = setup();
  addPayable(sim, "ambiguous", 300n);
  const result = request(sim, "ambiguous");
  assert.equal(result.accepted, true);
  sim.settlePayment(result.operationId, SettlementOutcome.AMBIGUOUS, 10n * DAY + 1n);
  const usage = sim.getUsage(10n * DAY + 1n);
  assert.equal(usage.reservedAgentTotalAtomic, 300n);
  assert.equal(usage.pendingOperations, 1);
  assert.equal(sim.getPayable("ambiguous").status, PayableStatus.RECONCILIATION);
  expectRejected(request(sim, "ambiguous"), VaultRejectionCode.PAYABLE_NOT_OPEN);
  sim.assertInvariants(10n * DAY + 1n);
});

test("rolling boundary expires at exactly seven days, not one nanosecond earlier", () => {
  const settledAt = 10n * DAY;

  const before = setup({ weeklyCapAtomic: 500n, lifetimeCeilingAtomic: 5_000n });
  addPayable(before, "first", 500n);
  const first = request(before, "first", "one", settledAt);
  assert.equal(first.accepted, true);
  before.settlePayment(first.operationId, SettlementOutcome.SUCCESS, settledAt);
  addPayable(before, "second", 1n, { notBeforeNs: 1n, dueAtNs: 30n * DAY, expiresAtNs: 40n * DAY });
  expectRejected(request(before, "second", "two", settledAt + SEVEN_DAYS_NS - 1n), VaultRejectionCode.WEEKLY_CAP_EXCEEDED);

  const at = setup({ weeklyCapAtomic: 500n, lifetimeCeilingAtomic: 5_000n });
  addPayable(at, "first", 500n);
  const firstAt = request(at, "first", "one", settledAt);
  assert.equal(firstAt.accepted, true);
  at.settlePayment(firstAt.operationId, SettlementOutcome.SUCCESS, settledAt);
  addPayable(at, "second", 1n, { notBeforeNs: 1n, dueAtNs: 30n * DAY, expiresAtNs: 40n * DAY });
  assert.equal(request(at, "second", "two", settledAt + SEVEN_DAYS_NS).accepted, true);
});

test("owner pay bypasses agent caps but preserves exact amount and paid lock", () => {
  const sim = setup({ weeklyCapAtomic: 100n, lifetimeCeilingAtomic: 100n });
  addPayable(sim, "large", 500n);
  expectRejected(request(sim, "large"), VaultRejectionCode.WEEKLY_CAP_EXCEEDED);
  const ownerResult = sim.ownerPay(owner(), "large");
  assert.equal(ownerResult.accepted, true);
  sim.settlePayment(ownerResult.operationId, SettlementOutcome.SUCCESS, 10n * DAY + 1n);
  const usage = sim.getUsage(10n * DAY + 1n);
  assert.equal(usage.ownerPaidTotalAtomic, 500n);
  assert.equal(usage.settledAgentTotalAtomic, 0n);
  expectRejected(sim.ownerPay(owner(), "large"), VaultRejectionCode.PAYABLE_NOT_OPEN);
});

test("policy cannot be lowered below settled plus reserved and never resets history", () => {
  const sim = setup();
  addPayable(sim, "paid", 300n);
  addPayable(sim, "pending", 200n);
  const paid = request(sim, "paid");
  assert.equal(paid.accepted, true);
  sim.settlePayment(paid.operationId, SettlementOutcome.SUCCESS, 10n * DAY);
  assert.equal(request(sim, "pending").accepted, true);
  assert.throws(() => sim.setPolicy(owner(), { weeklyCapAtomic: 900n, lifetimeCeilingAtomic: 499n }, sim.getPolicy().revision), /below settled plus reserved/);
  sim.setPolicy(owner(), { weeklyCapAtomic: 900n, lifetimeCeilingAtomic: 500n }, sim.getPolicy().revision);
  const usage = sim.getUsage(10n * DAY);
  assert.equal(usage.settledAgentTotalAtomic, 300n);
  assert.equal(usage.reservedAgentTotalAtomic, 200n);
});

test("vendor revision change invalidates an already registered payable", () => {
  const sim = setup();
  addPayable(sim, "stale", 100n);
  const vendor = sim.getVendor("vendor-a");
  sim.setVendor(owner(), { ...vendor, recipient: "new-recipient.testnet" }, vendor.revision);
  const changed = sim.getVendor("vendor-a");
  const binding = sim.getBinding();
  const result = sim.requestPayment(agent(), {
    payableRef: "stale",
    requestDigest: "stale-digest",
    expectedPolicyRevision: sim.getPolicy().revision,
    expectedVendorRevision: changed.revision,
    expectedBindingRevision: binding.revision,
  });
  expectRejected(result, VaultRejectionCode.STALE_VENDOR_REVISION);
});

test("guardian can pause but cannot unpause or mutate policy", () => {
  const sim = setup();
  sim.pause({ predecessorAccountId: GUARDIAN, nowNs: 10n * DAY });
  assert.equal(sim.isPaused(), true);
  assert.throws(() => sim.unpause({ predecessorAccountId: GUARDIAN, nowNs: 10n * DAY }), /owner signature required/);
  assert.throws(() => sim.setPolicy({ predecessorAccountId: GUARDIAN, nowNs: 10n * DAY }, { weeklyCapAtomic: 1n, lifetimeCeilingAtomic: 1n }, sim.getPolicy().revision), /owner signature required/);
});

test("withdrawal is reserved, idempotently released on known failure, and blocked by pending payments", () => {
  const sim = setup();
  addPayable(sim, "pending", 100n);
  const payment = request(sim, "pending");
  assert.equal(payment.accepted, true);
  sim.pause(owner());
  assert.throws(() => sim.requestWithdrawal(owner(), OWNER, 100n), /no unresolved operation/);
  sim.settlePayment(payment.operationId, SettlementOutcome.KNOWN_FAILURE, 10n * DAY + 1n);
  const withdrawal = sim.requestWithdrawal(owner(), OWNER, 100n);
  sim.settleWithdrawal(withdrawal.operationId, SettlementOutcome.KNOWN_FAILURE, 10n * DAY + 2n);
  const after = sim.snapshot();
  sim.settleWithdrawal(withdrawal.operationId, SettlementOutcome.KNOWN_FAILURE, 10n * DAY + 3n);
  assert.deepEqual(sim.snapshot(), after);
  sim.assertInvariants(10n * DAY + 3n);
});

test("tenant A credentials cannot authorize a tenant B vault", () => {
  const a = setup();
  const b = new VaultSimulator(config({ vaultId: "vault-b.testnet", ownerId: "owner-b.testnet" }));
  b.setVendor({ predecessorAccountId: "owner-b.testnet", nowNs: 10n * DAY }, {
    vendorId: "vendor-a",
    recipient: "vendor-b.testnet",
    perPaymentCapAtomic: 500n,
    enabled: true,
  }, 0);
  b.activateAgent({ predecessorAccountId: "owner-b.testnet", nowNs: 10n * DAY }, {
    accountId: "agent-b.testnet",
    publicKey: "ed25519:b",
    manifestDigest: "sha256:b",
    validFromNs: 1n,
    expiresAtNs: 100n * DAY,
  }, 0);
  b.fund(TOKEN, 1_000n);
  b.registerPayable({ predecessorAccountId: "owner-b.testnet", nowNs: 10n * DAY }, {
    payableRef: "b-payable",
    vendorId: "vendor-a",
    vendorRevision: 1,
    amountAtomic: 100n,
    poNumber: "PO-B",
    notBeforeNs: 1n,
    dueAtNs: 20n * DAY,
    expiresAtNs: 30n * DAY,
  });
  b.unpause({ predecessorAccountId: "owner-b.testnet", nowNs: 10n * DAY });
  const result = b.requestPayment(agent(10n * DAY, { currentAccountId: "vault-b.testnet" }), {
    payableRef: "b-payable",
    requestDigest: "cross-tenant",
    expectedPolicyRevision: b.getPolicy().revision,
    expectedVendorRevision: 1,
    expectedBindingRevision: 1,
  });
  expectRejected(result, VaultRejectionCode.AGENT_ACCOUNT_MISMATCH);
  a.assertInvariants(10n * DAY);
  b.assertInvariants(10n * DAY);
});

test("deterministic randomized sequence preserves accounting and single-payment invariants", () => {
  let seed = 0x5eed1234;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const sim = setup({ weeklyCapAtomic: 5_000n, lifetimeCeilingAtomic: 20_000n });
  for (let i = 0; i < 40; i += 1) {
    addPayable(sim, `fuzz-${i}`, BigInt((rand() % 200) + 1), {
      dueAtNs: 100n * DAY,
      expiresAtNs: 120n * DAY,
    });
  }
  const unresolved = [];
  let now = 10n * DAY;
  for (let step = 0; step < 500; step += 1) {
    now += BigInt(rand() % 1_000_000);
    const choice = rand() % 4;
    if (choice === 0) {
      const ref = `fuzz-${rand() % 40}`;
      const result = request(sim, ref, `digest:${ref}`, now);
      if (result.accepted && !result.existing) {
        unresolved.push(result.operationId);
      }
    } else if (unresolved.length > 0) {
      const index = rand() % unresolved.length;
      const [operationId] = unresolved.splice(index, 1);
      const outcome = rand() % 5 === 0 ? SettlementOutcome.KNOWN_FAILURE : SettlementOutcome.SUCCESS;
      sim.settlePayment(operationId, outcome, now);
      if (outcome === SettlementOutcome.KNOWN_FAILURE) {
        const operation = sim.getOperation(operationId);
        sim.reopenFailedPayable(owner(now), operation.payableRef);
      }
    }
    sim.assertInvariants(now);
  }
});

test("atomic inputs reject values outside the contract u128 domain", () => {
  const tooLarge = 1n << 128n;
  assert.throws(
    () => new VaultSimulator(config({ weeklyCapAtomic: tooLarge })),
    /unsigned 128-bit integer/,
  );

  const sim = setup();
  assert.throws(
    () => sim.setVendor(owner(), {
      vendorId: "oversized",
      recipient: "oversized.testnet",
      perPaymentCapAtomic: tooLarge,
      enabled: true,
    }, 0),
    /unsigned 128-bit integer/,
  );
  assert.throws(
    () => sim.fund(TOKEN, tooLarge),
    /unsigned 128-bit integer/,
  );
});

test("cap overflow is a structured rejection rather than a simulator exception", () => {
  const u128Max = (1n << 128n) - 1n;
  const sim = new VaultSimulator(config({
    weeklyCapAtomic: u128Max,
    lifetimeCeilingAtomic: u128Max,
  }));
  sim.setVendor(owner(), {
    vendorId: "vendor-a",
    recipient: "vendor-a.testnet",
    perPaymentCapAtomic: u128Max,
    enabled: true,
  }, 0);
  sim.activateAgent(owner(), {
    accountId: AGENT,
    publicKey: KEY,
    manifestDigest: "sha256:manifest-v1",
    validFromNs: 1n,
    expiresAtNs: 100n * DAY,
  }, 0);
  sim.fund(TOKEN, u128Max);
  sim.unpause(owner());
  addPayable(sim, "reserve-one", 1n);
  addPayable(sim, "overflow-request", u128Max);
  assert.equal(request(sim, "reserve-one").accepted, true);
  expectRejected(request(sim, "overflow-request"), VaultRejectionCode.WEEKLY_CAP_EXCEEDED);
  sim.assertInvariants(10n * DAY);
});
