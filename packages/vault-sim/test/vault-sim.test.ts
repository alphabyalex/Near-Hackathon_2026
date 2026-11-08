import { beforeEach, describe, expect, it } from "vitest";
import type { PaymentRequest, VaultRejection } from "@redline/schemas";
import {
  RECONCILE_AFTER_NS,
  ROLLING_WINDOW_NS,
  SimVaultGateway,
  createGymVaultSim,
  computeApprovalDigest,
  VaultPanic,
  VaultSim,
  type AgentCaller,
  type VaultSimConfig,
  type VaultSimInit,
} from "../src/index.js";

const OWNER = "owner.test";
const AGENT = "agent.test";
const AGENT_KEY = "ed25519:agentkey";
const VENDOR = "vendor.test";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const START = 1_000_000_000_000_000_000n;
const FAR = (2n ** 62n).toString();
const WEEKLY = 10_000n;
const LIFETIME = 25_000n;
const FUNDED = 1_000_000n;

const agent: AgentCaller = { predecessor: AGENT, signer: AGENT, public_key: AGENT_KEY };

function makeVault(overrides: Partial<VaultSimConfig> = {}): VaultSim {
  const vault = new VaultSim({
    vault_id: "vault.test",
    owner: OWNER,
    guardian: "guardian.test",
    token_contract: "token.test",
    policy: { weekly_cap_atomic: WEEKLY.toString(), lifetime_cap_atomic: LIFETIME.toString(), expires_at_ns: FAR },
    now_ns: START,
    ...overrides,
  });
  vault.setVendor(OWNER, { vendor_id: "vnd", display_name: "Vendor", account_id: VENDOR, per_payment_cap_atomic: "5000", active: true }, 0);
  vault.activateAgent(OWNER, { agent_account_id: AGENT, public_key: AGENT_KEY, manifest_digest: DIGEST_A, assessment_ref: "run", expires_at_ns: FAR }, 0);
  vault.fund(FUNDED);
  vault.unpause(OWNER);
  return vault;
}

function addPayable(vault: VaultSim, payable_ref: string, amount: bigint | string, times: { not_before?: bigint; expires?: bigint } = {}): void {
  vault.registerPayable(OWNER, {
    payable_ref,
    vendor_id: "vnd",
    vendor_revision: vault.getVendors().find((v) => v.vendor_id === "vnd")!.revision,
    po_number: "PO-1",
    invoice_number: "INV-1",
    amount_atomic: amount.toString(),
    not_before_ns: (times.not_before ?? START).toString(),
    due_at_ns: (times.expires ?? BigInt(FAR)).toString(),
    expires_at_ns: (times.expires ?? BigInt(FAR)).toString(),
    evidence_commitment: DIGEST_A,
  });
}

function requestFor(vault: VaultSim, payable_ref: string, overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    payable_ref,
    request_digest: DIGEST_A,
    expected_vendor_revision: vault.getVendors().find((v) => v.vendor_id === "vnd")!.revision,
    expected_policy_revision: vault.getPolicy().revision,
    expected_binding_revision: vault.getBinding()?.revision ?? 0,
    ...overrides,
  };
}

function rejectionOf(vault: VaultSim, payable_ref: string, overrides: Partial<PaymentRequest> = {}, caller = agent): VaultRejection | null {
  return vault.requestPayment(caller, requestFor(vault, payable_ref, overrides)).rejection;
}

function expectPanic(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(VaultPanic);
    expect((error as VaultPanic).code).toBe(code);
    return;
  }
  throw new Error(`expected panic ${code}`);
}

/** funded = A + R + owner_reserved + S + owner_paid + withdrawn + withdrawal_in_flight */
function expectConserved(vault: VaultSim, funded = FUNDED): void {
  const u = vault.getUsage();
  const total =
    BigInt(u.balance_atomic) +
    BigInt(u.lifetime_reserved_atomic) +
    BigInt(u.owner_reserved_atomic) +
    BigInt(u.lifetime_settled_atomic) +
    BigInt(u.owner_paid_atomic) +
    BigInt(u.withdrawn_atomic) +
    BigInt(u.withdrawal_in_flight_atomic);
  expect(total).toBe(funded);
}

describe("request_payment rejections", () => {
  let vault: VaultSim;
  beforeEach(() => {
    vault = makeVault();
    addPayable(vault, "p", 100n);
  });

  it("a fresh vault starts paused with no agent", () => {
    const fresh = new VaultSim({
      vault_id: "v",
      owner: OWNER,
      token_contract: "t",
      policy: { weekly_cap_atomic: "1", lifetime_cap_atomic: "1", expires_at_ns: FAR },
      now_ns: START,
    });
    expect(fresh.getPolicy().paused).toBe(true);
    expect(fresh.getPolicy().revision).toBe(1);
    expect(fresh.getBinding()).toBeNull();
  });

  it("BAD_CALLER: wrong account, wrong key, proxy, malformed digest", () => {
    expect(rejectionOf(vault, "p", {}, { predecessor: "x.test", signer: "x.test", public_key: AGENT_KEY })).toBe("BAD_CALLER");
    expect(rejectionOf(vault, "p", {}, { predecessor: AGENT, signer: AGENT, public_key: "ed25519:other" })).toBe("BAD_CALLER");
    expect(rejectionOf(vault, "p", {}, { predecessor: "proxy.test", signer: AGENT, public_key: AGENT_KEY })).toBe("BAD_CALLER");
    expect(rejectionOf(vault, "p", {}, { predecessor: AGENT, signer: "proxy.test", public_key: AGENT_KEY })).toBe("BAD_CALLER");
    expect(rejectionOf(vault, "p", { request_digest: "sha256:zz" })).toBe("BAD_CALLER");
  });

  it("BAD_CALLER when no agent was ever enrolled", () => {
    const fresh = new VaultSim({
      vault_id: "v",
      owner: OWNER,
      token_contract: "t",
      policy: { weekly_cap_atomic: "1", lifetime_cap_atomic: "1", expires_at_ns: FAR },
      now_ns: START,
    });
    expect(fresh.requestPayment(agent, { payable_ref: "p", request_digest: DIGEST_A, expected_vendor_revision: 0, expected_policy_revision: 1, expected_binding_revision: 0 }).rejection).toBe("BAD_CALLER");
  });

  it("BINDING_INACTIVE: revoked, expired binding, expired policy", () => {
    const revoked = makeVault();
    addPayable(revoked, "p", 1n);
    revoked.revokeAgent(OWNER, AGENT);
    expect(rejectionOf(revoked, "p")).toBe("BINDING_INACTIVE");

    const expired = makeVault();
    addPayable(expired, "p", 1n);
    expired.activateAgent(OWNER, { agent_account_id: AGENT, public_key: AGENT_KEY, manifest_digest: DIGEST_A, assessment_ref: "run", expires_at_ns: (START + 10n).toString() }, 1);
    expired.setNow(START + 9n);
    expect(rejectionOf(expired, "p")).toBeNull();
    addPayable(expired, "q", 1n);
    expired.setNow(START + 10n);
    expect(rejectionOf(expired, "q")).toBe("BINDING_INACTIVE");

    const policyEnded = makeVault();
    addPayable(policyEnded, "p", 1n);
    policyEnded.setPolicy(OWNER, { weekly_cap_atomic: "10", lifetime_cap_atomic: "10", expires_at_ns: START.toString() }, 1);
    expect(rejectionOf(policyEnded, "p")).toBe("BINDING_INACTIVE");
  });

  it("identity is checked before binding, binding before pause", () => {
    vault.pause(OWNER);
    expect(rejectionOf(vault, "p", {}, { predecessor: "x.test", signer: "x.test", public_key: "k" })).toBe("BAD_CALLER");
    expect(rejectionOf(vault, "p")).toBe("PAUSED");
    vault.revokeAgent(OWNER, AGENT);
    expect(rejectionOf(vault, "p")).toBe("BINDING_INACTIVE");
  });

  it("UNKNOWN_PAYABLE: never registered, cancelled, failed and not reopened", () => {
    expect(rejectionOf(vault, "nope")).toBe("UNKNOWN_PAYABLE");
    vault.cancelPayable(OWNER, "p");
    expect(rejectionOf(vault, "p")).toBe("UNKNOWN_PAYABLE");

    const failing = makeVault({ token_registered: [] });
    addPayable(failing, "p", 1n);
    expect(failing.requestPayment(agent, requestFor(failing, "p")).ok).toBe(true);
    expect(failing.getPayable("p")?.status).toBe("FAILED_KNOWN");
    expect(rejectionOf(failing, "p")).toBe("UNKNOWN_PAYABLE");
  });

  it("time window edges: not_before inclusive, expires_at exclusive", () => {
    addPayable(vault, "w", 1n, { not_before: START + 100n, expires: START + 200n });
    vault.setNow(START + 99n);
    expect(rejectionOf(vault, "w")).toBe("NOT_YET_PAYABLE");
    vault.setNow(START + 200n);
    expect(rejectionOf(vault, "w")).toBe("PAYABLE_EXPIRED");
    expect(vault.getPayable("w")?.status).toBe("EXPIRED");
    vault.setNow(START + 100n);
    expect(vault.getPayable("w")?.status).toBe("OPEN");
    expect(rejectionOf(vault, "w")).toBeNull();
  });

  it("STALE_REVISION: each expected revision, vendor moved, vendor deactivated", () => {
    expect(rejectionOf(vault, "p", { expected_vendor_revision: 99 })).toBe("STALE_REVISION");
    expect(rejectionOf(vault, "p", { expected_policy_revision: 99 })).toBe("STALE_REVISION");
    expect(rejectionOf(vault, "p", { expected_binding_revision: 99 })).toBe("STALE_REVISION");
    vault.setVendor(OWNER, { vendor_id: "vnd", display_name: "Vendor", account_id: VENDOR, per_payment_cap_atomic: "9000", active: true }, 1);
    expect(rejectionOf(vault, "p")).toBe("STALE_REVISION");
  });

  it("caps: exactly at passes, one atomic unit over fails", () => {
    const fresh = makeVault();
    addPayable(fresh, "ok", 5000n);
    expect(rejectionOf(fresh, "ok")).toBeNull();
    addPayable(fresh, "over", 5001n);
    expect(rejectionOf(fresh, "over")).toBe("OVER_VENDOR_CAP");

    addPayable(fresh, "w1", 5000n);
    expect(rejectionOf(fresh, "w1")).toBeNull();
    addPayable(fresh, "w2", 1n);
    expect(rejectionOf(fresh, "w2")).toBe("OVER_WEEKLY_CAP");

    fresh.advance(ROLLING_WINDOW_NS);
    expect(rejectionOf(fresh, "w2")).toBeNull();
    addPayable(fresh, "l1", 5000n);
    expect(rejectionOf(fresh, "l1")).toBeNull();
    fresh.advance(ROLLING_WINDOW_NS);
    addPayable(fresh, "l2", 4999n);
    expect(rejectionOf(fresh, "l2")).toBeNull();
    fresh.advance(ROLLING_WINDOW_NS);
    // S is now 5000+5000+1+5000+4999 = 20000. C is 25000.
    addPayable(fresh, "l3", 5000n);
    expect(rejectionOf(fresh, "l3")).toBeNull();
    fresh.advance(ROLLING_WINDOW_NS);
    addPayable(fresh, "l4", 1n);
    expect(rejectionOf(fresh, "l4")).toBe("OVER_LIFETIME_CAP");
  });

  it("reserved money counts against weekly and lifetime caps", () => {
    const manual = makeVault({ auto_resolve: false });
    addPayable(manual, "a", 5000n);
    addPayable(manual, "b", 5000n);
    addPayable(manual, "c", 1n);
    expect(rejectionOf(manual, "a")).toBeNull();
    expect(rejectionOf(manual, "b")).toBeNull();
    expect(rejectionOf(manual, "c")).toBe("OVER_WEEKLY_CAP");
    expect(manual.getUsage().lifetime_reserved_atomic).toBe("10000");
  });

  it("INSUFFICIENT_BALANCE when funds run out", () => {
    const poor = new VaultSim({
      vault_id: "v",
      owner: OWNER,
      token_contract: "t",
      policy: { weekly_cap_atomic: "1000", lifetime_cap_atomic: "1000", expires_at_ns: FAR },
      now_ns: START,
    });
    poor.setVendor(OWNER, { vendor_id: "vnd", display_name: "V", account_id: VENDOR, per_payment_cap_atomic: "1000", active: true }, 0);
    poor.activateAgent(OWNER, { agent_account_id: AGENT, public_key: AGENT_KEY, manifest_digest: DIGEST_A, assessment_ref: "r", expires_at_ns: FAR }, 0);
    poor.unpause(OWNER);
    poor.fund(99n);
    addPayable(poor, "p", 100n);
    expect(rejectionOf(poor, "p")).toBe("INSUFFICIENT_BALANCE");
    poor.fund(1n);
    expect(rejectionOf(poor, "p")).toBeNull();
  });

  it("CAPACITY_FULL for pending, settlement slots and operations", () => {
    const pending = makeVault({ auto_resolve: false, capacities: { max_vendors: 4, max_payables: 16, max_pending: 1, max_rolling: 16, max_operations: 16 } });
    addPayable(pending, "a", 1n);
    addPayable(pending, "b", 1n);
    expect(rejectionOf(pending, "a")).toBeNull();
    expect(rejectionOf(pending, "b")).toBe("CAPACITY_FULL");

    const rolling = makeVault({ capacities: { max_vendors: 4, max_payables: 16, max_pending: 8, max_rolling: 1, max_operations: 16 } });
    addPayable(rolling, "a", 1n);
    addPayable(rolling, "b", 1n);
    expect(rejectionOf(rolling, "a")).toBeNull();
    expect(rejectionOf(rolling, "b")).toBe("CAPACITY_FULL");
    rolling.advance(ROLLING_WINDOW_NS);
    expect(rejectionOf(rolling, "b")).toBeNull();

    const operations = makeVault({ capacities: { max_vendors: 4, max_payables: 16, max_pending: 8, max_rolling: 16, max_operations: 1 } });
    addPayable(operations, "a", 1n);
    addPayable(operations, "b", 1n);
    expect(rejectionOf(operations, "a")).toBeNull();
    expect(rejectionOf(operations, "b")).toBe("CAPACITY_FULL");
  });

  it("rejected requests change nothing", () => {
    addPayable(vault, "big", 5001n);
    const before = JSON.stringify([vault.getUsage(), vault.getPayable("big")]);
    for (let i = 0; i < 25; i++) {
      expect(rejectionOf(vault, "big")).toBe("OVER_VENDOR_CAP");
      expect(rejectionOf(vault, "unknown")).toBe("UNKNOWN_PAYABLE");
    }
    expect(JSON.stringify([vault.getUsage(), vault.getPayable("big")])).toBe(before);
  });
});

describe("single-payment lock and idempotency", () => {
  it("same digest returns the existing operation, different digest is rejected", () => {
    const vault = makeVault({ auto_resolve: false });
    addPayable(vault, "p", 100n);
    const first = vault.requestPayment(agent, requestFor(vault, "p"));
    expect(first).toEqual({ ok: true, operation_id: "op_1", rejection: null });

    expect(vault.requestPayment(agent, requestFor(vault, "p"))).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect(rejectionOf(vault, "p", { request_digest: DIGEST_B })).toBe("ALREADY_PENDING");
    expect(vault.getUsage().lifetime_reserved_atomic).toBe("100");

    vault.resolveOperation("op_1", "success");
    expect(vault.requestPayment(agent, requestFor(vault, "p"))).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect(rejectionOf(vault, "p", { request_digest: DIGEST_B })).toBe("ALREADY_PAID");
    expect(vault.getUsage().lifetime_settled_atomic).toBe("100");
    expectConserved(vault);
  });

  it("an owner-paid payable reads ALREADY_PAID to the agent", () => {
    const vault = makeVault();
    addPayable(vault, "p", 100n);
    expect(vault.ownerPay(OWNER, "p").ok).toBe(true);
    expect(rejectionOf(vault, "p")).toBe("ALREADY_PAID");
  });

  it("revisions are not checked on an idempotent retry, so a settled answer stays stable", () => {
    const vault = makeVault();
    addPayable(vault, "p", 100n);
    vault.requestPayment(agent, requestFor(vault, "p"));
    vault.setPolicy(OWNER, { weekly_cap_atomic: "1", lifetime_cap_atomic: "100", expires_at_ns: FAR }, 1);
    expect(vault.requestPayment(agent, requestFor(vault, "p", { expected_policy_revision: 1 })).operation_id).toBe("op_1");
  });
});

describe("callback outcomes", () => {
  let vault: VaultSim;
  beforeEach(() => {
    vault = makeVault({ auto_resolve: false });
    addPayable(vault, "p", 100n);
    vault.requestPayment(agent, requestFor(vault, "p"));
  });

  it("reservation debits available and locks the payable before any transfer", () => {
    const u = vault.getUsage();
    expect(u.balance_atomic).toBe((FUNDED - 100n).toString());
    expect(u.weekly_reserved_atomic).toBe("100");
    expect(vault.getPayable("p")?.status).toBe("PENDING");
    expect(vault.getOperation("op_1")?.status).toBe("RESERVED");
    expectConserved(vault);
  });

  it("success moves R to S, once", () => {
    vault.resolveOperation("op_1", "success");
    vault.resolveOperation("op_1", "success");
    vault.resolveOperation("op_1", "failed");
    const u = vault.getUsage();
    expect(u.lifetime_settled_atomic).toBe("100");
    expect(u.weekly_settled_atomic).toBe("100");
    expect(u.lifetime_reserved_atomic).toBe("0");
    expect(vault.getOperation("op_1")?.status).toBe("SETTLED");
    expect(vault.getPayable("p")?.status).toBe("SETTLED");
    expectConserved(vault);
  });

  it("failure releases once", () => {
    vault.resolveOperation("op_1", "failed");
    vault.resolveOperation("op_1", "failed");
    expect(vault.getUsage().balance_atomic).toBe(FUNDED.toString());
    expect(vault.getOperation("op_1")?.status).toBe("FAILED_KNOWN");
    expect(vault.getPayable("p")?.status).toBe("FAILED_KNOWN");
    expectConserved(vault);
  });

  it("failed then reopened gets a higher attempt and a new operation", () => {
    vault.resolveOperation("op_1", "failed");
    vault.reopenFailedPayable(OWNER, "p");
    expect(vault.requestPayment(agent, requestFor(vault, "p")).operation_id).toBe("op_2");
    expect(vault.getOperation("op_2")?.attempt).toBe(2);
  });

  it("unknown keeps the reservation until the owner reconciles", () => {
    vault.resolveOperation("op_1", "unknown");
    expect(vault.getOperation("op_1")?.status).toBe("OUTCOME_UNCERTAIN");
    expect(vault.getPayable("p")?.status).toBe("PENDING");
    expect(vault.getUsage().lifetime_reserved_atomic).toBe("100");
    expect(vault.ownerPay(OWNER, "p").rejection).toBe("ALREADY_PENDING");
    vault.reconcileOperation(OWNER, "op_1", true);
    expect(vault.getOperation("op_1")?.status).toBe("SETTLED");
    vault.resolveOperation("op_1", "failed");
    expect(vault.getUsage().lifetime_settled_atomic).toBe("100");
    expectConserved(vault);
  });

  it("reconcile: fresh RESERVED refused, one hour old allowed, final statuses refused", () => {
    expectPanic(() => vault.reconcileOperation(OWNER, "op_1", false), "E_NOT_RECONCILABLE");
    vault.advance(RECONCILE_AFTER_NS - 1n);
    expectPanic(() => vault.reconcileOperation(OWNER, "op_1", false), "E_NOT_RECONCILABLE");
    vault.advance(1n);
    vault.reconcileOperation(OWNER, "op_1", false);
    expect(vault.getUsage().balance_atomic).toBe(FUNDED.toString());
    expectPanic(() => vault.reconcileOperation(OWNER, "op_1", false), "E_NOT_RECONCILABLE");
  });

  it("pause and vendor change do not affect a pending payment", () => {
    vault.pause(OWNER);
    vault.setVendor(OWNER, { vendor_id: "vnd", display_name: "Vendor", account_id: "new.test", per_payment_cap_atomic: "1", active: false }, 1);
    vault.resolveOperation("op_1", "success");
    expect(vault.getOperation("op_1")?.recipient).toBe(VENDOR);
    expect(vault.getPayable("p")?.status).toBe("SETTLED");
  });
});

describe("rolling window", () => {
  function settledThenRequestAt(offset: bigint): VaultRejection | null {
    const vault = makeVault();
    addPayable(vault, "a", 5000n);
    addPayable(vault, "b", 5000n);
    addPayable(vault, "c", 1n);
    vault.requestPayment(agent, requestFor(vault, "a"));
    vault.requestPayment(agent, requestFor(vault, "b"));
    vault.setNow(START + offset);
    return rejectionOf(vault, "c");
  }

  it("immediately before 7 days still counts", () => expect(settledThenRequestAt(ROLLING_WINDOW_NS - 1n)).toBe("OVER_WEEKLY_CAP"));
  it("exactly at 7 days no longer counts", () => expect(settledThenRequestAt(ROLLING_WINDOW_NS)).toBeNull());
  it("after 7 days no longer counts", () => expect(settledThenRequestAt(ROLLING_WINDOW_NS + 1n)).toBeNull());

  it("the entry is dated at callback time, not reservation time", () => {
    const vault = makeVault({ auto_resolve: false });
    addPayable(vault, "a", 5000n);
    addPayable(vault, "a2", 5000n);
    addPayable(vault, "b", 1n);
    vault.requestPayment(agent, requestFor(vault, "a"));
    vault.requestPayment(agent, requestFor(vault, "a2"));
    vault.setNow(START + 1000n);
    vault.resolveOperation("op_1", "success");
    vault.resolveOperation("op_2", "success");
    vault.setNow(START + ROLLING_WINDOW_NS);
    expect(rejectionOf(vault, "b")).toBe("OVER_WEEKLY_CAP");
    vault.setNow(START + 1000n + ROLLING_WINDOW_NS);
    expect(rejectionOf(vault, "b")).toBeNull();
  });
});

describe("owner_pay", () => {
  it("pays an over-cap item, ignores pause and time, does not consume agent caps", () => {
    const vault = makeVault();
    addPayable(vault, "big", 50_000n, { not_before: START + 1000n, expires: START + 2000n });
    expect(rejectionOf(vault, "big")).toBe("NOT_YET_PAYABLE");
    vault.pause(OWNER);
    expect(vault.ownerPay(OWNER, "big")).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    const u = vault.getUsage();
    expect(u.owner_paid_atomic).toBe("50000");
    expect(u.lifetime_settled_atomic).toBe("0");
    expect(u.weekly_settled_atomic).toBe("0");
    expect(vault.getOperation("op_1")?.origin).toBe("OWNER");
    expectConserved(vault);
  });

  it("rejection order and codes", () => {
    const vault = makeVault();
    addPayable(vault, "p", 100n);
    expect(vault.ownerPay(AGENT, "p").rejection).toBe("BAD_CALLER");
    expect(vault.ownerPay(OWNER, "nope").rejection).toBe("UNKNOWN_PAYABLE");
    vault.ownerPay(OWNER, "p");
    expect(vault.ownerPay(OWNER, "p").rejection).toBe("ALREADY_PAID");
    addPayable(vault, "c", 100n);
    vault.cancelPayable(OWNER, "c");
    expect(vault.ownerPay(OWNER, "c").rejection).toBe("UNKNOWN_PAYABLE");
    addPayable(vault, "huge", FUNDED + 1n);
    expect(vault.ownerPay(OWNER, "huge").rejection).toBe("INSUFFICIENT_BALANCE");
  });

  it("a cap-only vendor change does not block, a recipient change does", () => {
    const vault = makeVault();
    addPayable(vault, "a", 100n);
    addPayable(vault, "b", 100n);
    vault.setVendor(OWNER, { vendor_id: "vnd", display_name: "Vendor", account_id: VENDOR, per_payment_cap_atomic: "1", active: true }, 1);
    expect(vault.ownerPay(OWNER, "a").ok).toBe(true);
    vault.setVendor(OWNER, { vendor_id: "vnd", display_name: "Vendor", account_id: "rotated.test", per_payment_cap_atomic: "1", active: true }, 2);
    expect(vault.ownerPay(OWNER, "b").rejection).toBe("STALE_REVISION");
  });

  it("a failed owner payment releases and tracks separately", () => {
    const vault = makeVault({ token_registered: [] });
    addPayable(vault, "p", 100n);
    expect(vault.ownerPay(OWNER, "p").ok).toBe(true);
    expect(vault.getPayable("p")?.status).toBe("FAILED_KNOWN");
    expect(vault.getUsage().owner_paid_atomic).toBe("0");
    expect(vault.getUsage().balance_atomic).toBe(FUNDED.toString());
    vault.registerWithToken(VENDOR);
    vault.reopenFailedPayable(OWNER, "p");
    expect(vault.ownerPay(OWNER, "p").ok).toBe(true);
    expect(vault.getUsage().owner_paid_atomic).toBe("100");
    expect(vault.getOperation("op_2")?.attempt).toBe(2);
  });
});

describe("owner methods", () => {
  let vault: VaultSim;
  beforeEach(() => {
    vault = makeVault();
  });

  it("are owner only", () => {
    const vendor = { vendor_id: "x", display_name: "X", account_id: "x.test", per_payment_cap_atomic: "1", active: true };
    const policy = { weekly_cap_atomic: "1", lifetime_cap_atomic: "1", expires_at_ns: FAR };
    expectPanic(() => vault.setVendor(AGENT, vendor, 0), "E_NOT_OWNER");
    expectPanic(() => vault.setPolicy(AGENT, policy, 1), "E_NOT_OWNER");
    expectPanic(() => vault.unpause("guardian.test"), "E_NOT_OWNER");
    expectPanic(() => vault.pause(AGENT), "E_NOT_OWNER_OR_GUARDIAN");
    expectPanic(() => vault.revokeAgent(AGENT, AGENT), "E_NOT_OWNER");
    expectPanic(() => vault.withdrawAvailable(AGENT, 1n), "E_NOT_OWNER");
    vault.pause("guardian.test");
    expect(vault.getPolicy().paused).toBe(true);
  });

  it("set_policy: revision guard, cannot go below S + R, never clears", () => {
    addPayable(vault, "p", 100n);
    vault.requestPayment(agent, requestFor(vault, "p"));
    expectPanic(() => vault.setPolicy(OWNER, { weekly_cap_atomic: "1", lifetime_cap_atomic: "1000", expires_at_ns: FAR }, 7), "E_STALE_REVISION");
    expectPanic(() => vault.setPolicy(OWNER, { weekly_cap_atomic: "1", lifetime_cap_atomic: "99", expires_at_ns: FAR }, 1), "E_BELOW_COMMITTED");
    expect(vault.setPolicy(OWNER, { weekly_cap_atomic: "1", lifetime_cap_atomic: "100", expires_at_ns: FAR }, 1)).toBe(2);
    expect(vault.getUsage().lifetime_settled_atomic).toBe("100");
    expect(vault.getUsage().weekly_settled_atomic).toBe("100");
  });

  it("register_payable validates", () => {
    addPayable(vault, "p", 1n);
    expectPanic(() => addPayable(vault, "p", 1n), "E_DUPLICATE_PAYABLE");
    expectPanic(() => addPayable(vault, "zero", 0n), "E_INVALID_INPUT");
    const base = { payable_ref: "x", vendor_id: "vnd", vendor_revision: 1, po_number: "P", invoice_number: null, amount_atomic: "1", not_before_ns: "5", due_at_ns: "6", expires_at_ns: "7", evidence_commitment: DIGEST_A };
    expectPanic(() => vault.registerPayable(OWNER, { ...base, vendor_id: "none" }), "E_UNKNOWN_VENDOR");
    expectPanic(() => vault.registerPayable(OWNER, { ...base, vendor_revision: 9 }), "E_VENDOR_REVISION_MISMATCH");
    expectPanic(() => vault.registerPayable(OWNER, { ...base, not_before_ns: "8" }), "E_INVALID_INPUT");
    expectPanic(() => vault.registerPayable(OWNER, { ...base, evidence_commitment: "nope" }), "E_INVALID_INPUT");
    vault.setVendor(OWNER, { vendor_id: "vnd", display_name: "V", account_id: VENDOR, per_payment_cap_atomic: "1", active: false }, 1);
    expectPanic(() => vault.registerPayable(OWNER, { ...base, vendor_revision: 2 }), "E_VENDOR_INACTIVE");
  });

  it("capacities are enforced on vendors and payables", () => {
    const small = makeVault({ capacities: { max_vendors: 1, max_payables: 1, max_pending: 8, max_rolling: 8, max_operations: 8 } });
    expectPanic(() => small.setVendor(OWNER, { vendor_id: "two", display_name: "T", account_id: "t.test", per_payment_cap_atomic: "1", active: true }, 0), "E_CAPACITY_FULL");
    addPayable(small, "a", 1n);
    expectPanic(() => addPayable(small, "b", 1n), "E_CAPACITY_FULL");
  });

  it("cancel_payable and reopen guards", () => {
    addPayable(vault, "p", 1n);
    expectPanic(() => vault.reopenFailedPayable(OWNER, "p"), "E_NOT_FAILED");
    vault.requestPayment(agent, requestFor(vault, "p"));
    expectPanic(() => vault.cancelPayable(OWNER, "p"), "E_NOT_CANCELLABLE");
    expectPanic(() => vault.cancelPayable(OWNER, "nope"), "E_UNKNOWN_PAYABLE");
  });

  it("revoke_agent names the enrolled agent", () => {
    expectPanic(() => vault.revokeAgent(OWNER, "other.test"), "E_AGENT_MISMATCH");
  });

  it("capacities above the hard limit are refused", () => {
    expectPanic(
      () => new VaultSim({ vault_id: "v", owner: OWNER, token_contract: "t", policy: { weekly_cap_atomic: "1", lifetime_cap_atomic: "1", expires_at_ns: FAR }, now_ns: START, capacities: { max_vendors: 9999, max_payables: 1, max_pending: 1, max_rolling: 1, max_operations: 1 } }),
      "E_INVALID_INPUT",
    );
  });
});

describe("funding and withdrawal", () => {
  it("only the fixed token can fund, funding never raises caps", () => {
    const vault = makeVault();
    expectPanic(() => vault.ftOnTransfer("other-token.test", OWNER, 1n), "E_WRONG_TOKEN");
    const policy = vault.getPolicy();
    vault.fund(5n);
    expect(vault.getPolicy()).toEqual(policy);
    expect(vault.getUsage().balance_atomic).toBe((FUNDED + 5n).toString());
  });

  it("withdraw requires paused, nothing pending, in balance", () => {
    const vault = makeVault({ auto_resolve: false });
    addPayable(vault, "p", 100n);
    expectPanic(() => vault.withdrawAvailable(OWNER, 1n), "E_NOT_PAUSED");
    vault.requestPayment(agent, requestFor(vault, "p"));
    vault.pause(OWNER);
    expectPanic(() => vault.withdrawAvailable(OWNER, 1n), "E_PENDING_OPERATIONS");
    vault.resolveOperation("op_1", "success");
    expectPanic(() => vault.withdrawAvailable(OWNER, 0n), "E_INSUFFICIENT_BALANCE");
    expectPanic(() => vault.withdrawAvailable(OWNER, FUNDED), "E_INSUFFICIENT_BALANCE");
    vault.withdrawAvailable(OWNER, 10n);
    expectPanic(() => vault.withdrawAvailable(OWNER, 1n), "E_WITHDRAWAL_IN_FLIGHT");
    expectConserved(vault);
    vault.resolveWithdrawal(10n, "failed");
    vault.resolveWithdrawal(10n, "failed");
    expect(vault.getUsage().balance_atomic).toBe((FUNDED - 100n).toString());
    expectConserved(vault);
    vault.withdrawAvailable(OWNER, 10n);
    vault.resolveWithdrawal(10n, "success");
    vault.resolveWithdrawal(10n, "success");
    expect(vault.getUsage().withdrawn_atomic).toBe("10");
    expectConserved(vault);
  });

  it("an uncertain withdrawal stays in flight until reconciled", () => {
    const vault = makeVault({ auto_resolve: false });
    vault.pause(OWNER);
    vault.withdrawAvailable(OWNER, 10n);
    expectPanic(() => vault.reconcileWithdrawal(OWNER, true), "E_NOT_RECONCILABLE");
    vault.resolveWithdrawal(10n, "unknown");
    expectPanic(() => vault.withdrawAvailable(OWNER, 1n), "E_WITHDRAWAL_IN_FLIGHT");
    vault.reconcileWithdrawal(OWNER, true);
    expect(vault.getUsage().withdrawn_atomic).toBe("10");
    expectPanic(() => vault.reconcileWithdrawal(OWNER, true), "E_NO_WITHDRAWAL");
    expectConserved(vault);
  });
});

describe("SimVaultGateway", () => {
  it("implements the VaultGateway flow and separates tenants", async () => {
    const a = makeVault({ vault_id: "a.test" });
    const b = makeVault({ vault_id: "b.test" });
    addPayable(a, "p", 100n);
    const gateway = new SimVaultGateway([a, b]);

    const request = requestFor(a, "p");
    expect((await gateway.requestPayment("b.test", request)).rejection).toBe("UNKNOWN_PAYABLE");
    const result = await gateway.requestPayment("a.test", request);
    expect(result.ok).toBe(true);
    expect((await gateway.getOperation("a.test", result.operation_id!))?.status).toBe("SETTLED");
    expect((await gateway.getPayable("a.test", "p"))?.status).toBe("SETTLED");
    expect((await gateway.getUsage("a.test")).lifetime_settled_atomic).toBe("100");
    expect((await gateway.getUsage("b.test")).lifetime_settled_atomic).toBe("0");

    await gateway.pause("a.test");
    expect((await gateway.getPolicy("a.test")).paused).toBe(true);
    await gateway.unpause("a.test");
    expect((await gateway.getPolicy("a.test")).paused).toBe(false);
    await gateway.revokeAgent("a.test", AGENT);
    expect((await gateway.getBinding("a.test"))?.enabled).toBe(false);
    await expect(gateway.getUsage("nope")).rejects.toThrow("unknown vault");
  });

  it("createGymVaultSim logs transfers and updates clock", async () => {
    const init: VaultSimInit = {
      vault_id: "gym.test",
      policy: {
        revision: 1,
        weekly_cap_atomic: "5000",
        lifetime_cap_atomic: "20000",
        expires_at_ns: FAR,
        paused: false,
      },
      binding_revision: 1,
      binding_enabled: true,
      vendors: [
        {
          vendor_id: "v1",
          display_name: "Vendor One",
          account_id: "vendor1.test",
          revision: 1,
          per_payment_cap_atomic: "2000",
          active: true,
        },
      ],
      payables: [
        {
          payable_ref: "pay_1",
          vault_id: "gym.test",
          vendor_id: "v1",
          vendor_revision: 1,
          invoice_number: "INV-1",
          po_number: "PO-1",
          evidence_commitment: DIGEST_A,
          amount_atomic: "500",
          token_contract_id: "redl.redline-labs.testnet",
          not_before_ns: "0",
          expires_at_ns: FAR,
          due_at_ns: "1000",
          status: "OPEN",
        },
      ],
      balance_atomic: "10000",
      weekly_settled_atomic: "0",
      lifetime_settled_atomic: "0",
    };

    const gym = createGymVaultSim([init], START);
    expect(gym.transfers()).toHaveLength(0);

    const result = await gym.requestPayment("gym.test", {
      payable_ref: "pay_1",
      expected_vendor_revision: 1,
      expected_policy_revision: 1,
      expected_binding_revision: 1,
      request_digest: DIGEST_A,
    });

    expect(result.ok).toBe(true);
    expect(gym.transfers()).toHaveLength(1);
    expect(gym.transfers()[0]).toMatchObject({
      vault_id: "gym.test",
      payable_ref: "pay_1",
      recipient: "vendor1.test",
      amount_atomic: "500",
      payer: "AGENT",
    });

    gym.setNow(START + 100n);
    const usage = await gym.getUsage("gym.test");
    expect(usage.balance_atomic).toBe("9500");
  });
});

describe("v2 endpoint change control and release guard", () => {
  const APPROVER = "approver.test";

  it("proposes an endpoint and calculates cooldown based on tier and open payables", () => {
    const vault = makeVault({ approver: APPROVER });
    addPayable(vault, "p_open", 1000n);

    // T2 with payable under vendor cap (5000): cooldown should be 24h
    const rev2 = vault.proposeEndpoint(OWNER, "vnd", "near:testnet:new.testnet", "T2", DIGEST_A);
    expect(rev2).toBe(2);

    const vendor = vault.getVendor("vnd");
    expect(vendor).not.toBeNull();
    const ep2 = vendor!.endpoints?.find((e) => e.revision === rev2);
    expect(ep2).toBeDefined();
    expect(ep2!.status).toBe("PENDING_COOLDOWN");
    const cd24h = 24n * 3600n * 1_000_000_000n;
    expect(BigInt(ep2!.activates_at_ns!)).toBe(START + cd24h);

    // T1: cooldown should be default 72h
    const rev3 = vault.proposeEndpoint(OWNER, "vnd", "near:testnet:other.testnet", "T1", DIGEST_A);
    const ep3 = vault.getVendor("vnd")!.endpoints?.find((e) => e.revision === rev3);
    const cd72h = 72n * 3600n * 1_000_000_000n;
    expect(BigInt(ep3!.activates_at_ns!)).toBe(START + cd72h);
  });

  it("approver role separation: only configured approver can approve", () => {
    const vault = makeVault({ approver: APPROVER });
    const rev = vault.proposeEndpoint(OWNER, "vnd", "near:testnet:new.testnet", "T2", DIGEST_A);
    const expiry = START + 7n * 24n * 3600n * 1_000_000_000n;
    const digest = computeApprovalDigest("vault.test", "vnd", rev, "near:testnet:new.testnet", expiry);

    // Owner cannot approve when approver is configured
    expectPanic(() => vault.approveEndpoint(OWNER, "vnd", rev, digest, expiry), "E_NOT_APPROVER");
    // Agent cannot approve
    expectPanic(() => vault.approveEndpoint(AGENT, "vnd", rev, digest, expiry), "E_NOT_APPROVER");
    // Approver succeeds
    vault.approveEndpoint(APPROVER, "vnd", rev, digest, expiry);
    const ep = vault.getVendor("vnd")!.endpoints?.find((e) => e.revision === rev);
    expect(ep!.status).toBe("APPROVED_PENDING_COOLDOWN");
  });

  it("rejects stale or mismatched approvals, and prevents replay", () => {
    const vault = makeVault({ approver: APPROVER });
    const rev = vault.proposeEndpoint(OWNER, "vnd", "near:testnet:new.testnet", "T2", DIGEST_A);
    const expiry = START + 1000n;
    const wrongDigest = `sha256:${"f".repeat(64)}`;

    // Mismatched digest
    expectPanic(() => vault.approveEndpoint(APPROVER, "vnd", rev, wrongDigest, expiry), "E_APPROVAL_MISMATCH");

    // Stale approval
    vault.setNow(expiry + 1n);
    const validDigest = computeApprovalDigest("vault.test", "vnd", rev, "near:testnet:new.testnet", expiry);
    expectPanic(() => vault.approveEndpoint(APPROVER, "vnd", rev, validDigest, expiry), "E_APPROVAL_STALE");

    // Replay rejection
    vault.setNow(START);
    const freshExpiry = START + 100_000n;
    const freshDigest = computeApprovalDigest("vault.test", "vnd", rev, "near:testnet:new.testnet", freshExpiry);
    vault.approveEndpoint(APPROVER, "vnd", rev, freshDigest, freshExpiry);

    // Propose rev 3 with identical details (for replay test)
    const rev3 = vault.proposeEndpoint(OWNER, "vnd", "near:testnet:new.testnet", "T2", DIGEST_A);
    expectPanic(() => vault.approveEndpoint(APPROVER, "vnd", rev3, freshDigest, freshExpiry), "E_APPROVAL_REPLAYED");
  });

  it("cooldown holds payment until finished and approved", () => {
    const vault = makeVault({ approver: APPROVER });
    const rev = vault.proposeEndpoint(OWNER, "vnd", "near:testnet:new.testnet", "T2", DIGEST_A);
    const cd = 24n * 3600n * 1_000_000_000n;

    // Register payable pinned to new revision
    expectPanic(
      () =>
        vault.registerPayable(OWNER, {
          payable_ref: "p_pin",
          vendor_id: "vnd",
          vendor_revision: 1,
          po_number: "PO-PIN",
          invoice_number: "INV-PIN",
          amount_atomic: "100",
          not_before_ns: START.toString(),
          due_at_ns: FAR,
          expires_at_ns: FAR,
          evidence_commitment: DIGEST_A,
          expected_endpoint_revision: rev,
        }),
      "E_ENDPOINT_REVISION_MISMATCH",
    );

    // Standard payable pays old active revision during cooldown
    addPayable(vault, "p_old", 100n);
    const res = vault.requestPayment(agent, requestFor(vault, "p_old"));
    expect(res.ok).toBe(true);

    // Advance time past cooldown without approval: cannot activate
    vault.setNow(START + cd + 1n);
    expectPanic(() => vault.activateEndpoint("vnd", rev), "E_NOT_APPROVED");

    // Approve now that cooldown has passed: activates immediately
    const expiry = START + cd + 10_000n;
    const digest = computeApprovalDigest("vault.test", "vnd", rev, "near:testnet:new.testnet", expiry);
    vault.approveEndpoint(APPROVER, "vnd", rev, digest, expiry);

    const vendorAfter = vault.getVendor("vnd");
    expect(vendorAfter!.active_endpoint_revision).toBe(rev);
    expect(vendorAfter!.account_id).toBe("new.testnet");
  });

  it("Release Guard: manifest digest mismatch rejects with RELEASE_MISMATCH", () => {
    const vault = makeVault();
    addPayable(vault, "p_rg", 100n);

    // Matching manifest succeeds
    const matchRes = vault.requestPayment(
      agent,
      requestFor(vault, "p_rg", { manifest_digest: DIGEST_A }),
    );
    expect(matchRes.ok).toBe(true);

    addPayable(vault, "p_rg2", 100n);
    // Mismatched manifest fails
    const mismatchRes = vault.requestPayment(
      agent,
      requestFor(vault, "p_rg2", { manifest_digest: DIGEST_B }),
    );
    expect(mismatchRes.ok).toBe(false);
    expect(mismatchRes.rejection).toBe("RELEASE_MISMATCH");
  });

  it("conservative caps on agent activation and explicit owner raise", () => {
    const conservativeCaps = {
      weekly_cap_atomic: "1000",
      lifetime_cap_atomic: "5000",
      expires_at_ns: FAR,
    };
    const vault = makeVault({ conservative_caps: conservativeCaps });

    // Re-enroll agent to trigger conservative caps
    vault.activateAgent(
      OWNER,
      {
        agent_account_id: AGENT,
        public_key: AGENT_KEY,
        manifest_digest: DIGEST_A,
        assessment_ref: "assessment_v2",
        expires_at_ns: FAR,
      },
      1,
    );

    expect(vault.getPolicy().weekly_cap_atomic).toBe("1000");

    // Amount over conservative weekly cap (1000) fails
    addPayable(vault, "p_big", 1500n);
    const rej = rejectionOf(vault, "p_big");
    expect(rej).toBe("OVER_WEEKLY_CAP");

    // Explicit owner raise restores policy weekly cap (WEEKLY = 10000)
    vault.raiseBindingCaps(OWNER);
    expect(vault.getPolicy().weekly_cap_atomic).toBe(WEEKLY.toString());

    // Now payable passes
    const okRes = vault.requestPayment(agent, requestFor(vault, "p_big"));
    expect(okRes.ok).toBe(true);
  });

  it("revoking active endpoint prevents payments with PAYEE_NOT_VERIFIED", () => {
    const vault = makeVault({ approver: APPROVER });
    addPayable(vault, "p_payee", 100n);

    // Revoke active endpoint (rev 1)
    vault.revokeEndpoint(OWNER, "vnd", 1);
    const vendor = vault.getVendor("vnd");
    expect(vendor!.active_endpoint_revision).toBeNull();

    const rej = rejectionOf(vault, "p_payee");
    expect(rej).toBe("PAYEE_NOT_VERIFIED");

    // owner_pay also fails with PAYEE_NOT_VERIFIED
    const ownerRes = vault.ownerPay(OWNER, "p_payee");
    expect(ownerRes.ok).toBe(false);
    expect(ownerRes.rejection).toBe("PAYEE_NOT_VERIFIED");
  });
});
