import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Chain, DIGEST_B, accountedTotal, makeWorld, panicOf, type World } from "../src/harness.js";

const SECOND = 1_000_000_000n;

describe("payables", () => {
  let chain: Chain;
  let world: World;

  beforeAll(async () => {
    chain = await Chain.start();
    world = await makeWorld(chain);
  });
  afterAll(() => chain?.stop());

  it("unknown payable", async () => {
    expect((await world.request("never_registered")).rejection).toBe("UNKNOWN_PAYABLE");
  });

  it("too early", async () => {
    const now = await chain.blockTimestampNs();
    const payable = await world.addPayable(10n, { not_before_ns: now + 3600n * SECOND });
    expect((await world.request(payable)).rejection).toBe("NOT_YET_PAYABLE");
  });

  it("expired, and the view says EXPIRED while the stored status stays OPEN for the owner", async () => {
    const now = await chain.blockTimestampNs();
    const payable = await world.addPayable(10n, { not_before_ns: now - 7200n * SECOND, expires_at_ns: now - 3600n * SECOND });
    expect((await world.request(payable)).rejection).toBe("PAYABLE_EXPIRED");
    expect((await world.payable(payable))?.status).toBe("EXPIRED");
    expect((await world.ownerPay(payable)).ok).toBe(true);
    expect((await world.payable(payable))?.status).toBe("SETTLED");
  });

  it("already paid: same digest returns the same operation, a different digest is ALREADY_PAID, and it pays once", async () => {
    const payable = await world.addPayable(10n);
    const before = await world.tokenBalance(world.vendor.account_id);
    const first = await world.request(payable);
    expect(first.ok).toBe(true);
    expect(await world.request(payable)).toEqual(first);
    expect((await world.request(payable, { request_digest: DIGEST_B })).rejection).toBe("ALREADY_PAID");
    expect((await world.tokenBalance(world.vendor.account_id)) - before).toBe(10n);
  });

  it("stale expected revisions", async () => {
    const payable = await world.addPayable(10n);
    expect((await world.request(payable, { expected_vendor_revision: 99 })).rejection).toBe("STALE_REVISION");
    expect((await world.request(payable, { expected_policy_revision: 99 })).rejection).toBe("STALE_REVISION");
    expect((await world.request(payable, { expected_binding_revision: 99 })).rejection).toBe("STALE_REVISION");
    expect((await world.payable(payable))?.status).toBe("OPEN");
  });

  it("a payable pinned to an old vendor revision is stale even with current expected revisions", async () => {
    const own = await makeWorld(chain);
    const payable = await own.addPayable(10n);
    await own.admin.setVendor({ vendor_id: "vnd", display_name: "V", account_id: own.vendor.account_id, per_payment_cap_atomic: "50000", active: true }, 1);
    expect((await own.request(payable)).rejection).toBe("STALE_REVISION");
  });

  it("a deactivated vendor is stale", async () => {
    const own = await makeWorld(chain);
    await own.admin.setVendor({ vendor_id: "vnd", display_name: "V", account_id: own.vendor.account_id, per_payment_cap_atomic: "50000", active: false }, 1);
    expect(await panicOf(() => own.addPayable(10n, { vendor_revision: 2 }))).toBe("E_VENDOR_INACTIVE");
  });

  it("a cancelled payable is gone, and its ref is never reused", async () => {
    const payable = await world.addPayable(10n);
    await world.admin.cancelPayable(payable);
    expect((await world.request(payable)).rejection).toBe("UNKNOWN_PAYABLE");
    expect((await world.ownerPay(payable)).rejection).toBe("UNKNOWN_PAYABLE");
    expect(await panicOf(() => world.addPayable(10n, { payable_ref: payable }))).toBe("E_DUPLICATE_PAYABLE");
  });

  it("register_payable rejects a duplicate, an unknown vendor and a bad window", async () => {
    const payable = await world.addPayable(10n);
    expect(await panicOf(() => world.addPayable(10n, { payable_ref: payable }))).toBe("E_DUPLICATE_PAYABLE");
    expect(await panicOf(() => world.addPayable(10n, { vendor_id: "nope" }))).toBe("E_UNKNOWN_VENDOR");
    expect(await panicOf(() => world.addPayable(10n, { vendor_revision: 9 }))).toBe("E_VENDOR_REVISION_MISMATCH");
    expect(await panicOf(() => world.addPayable(0n))).toBe("E_INVALID_INPUT");
    expect(await panicOf(() => world.addPayable(10n, { not_before_ns: 10n, expires_at_ns: 10n }))).toBe("E_INVALID_INPUT");
  });

  it("views match the shared schemas", async () => {
    const { PayableSchema, OperationSchema, PolicySchema, VaultUsageSchema, VendorSchema, AgentBindingSchema } = await import("@redline/schemas");
    const payable = await world.addPayable(10n);
    const result = await world.request(payable);
    PayableSchema.parse(await world.payable(payable));
    OperationSchema.parse(await world.operation(result.operation_id as string));
    PolicySchema.parse(await world.view("get_policy"));
    VaultUsageSchema.parse(await world.usage());
    AgentBindingSchema.parse(await world.view("get_binding"));
    for (const vendor of await world.view<unknown[]>("get_vendors")) VendorSchema.parse(vendor);
  });
});

describe("caps: exactly at passes, one atomic unit over fails", () => {
  let chain: Chain;

  beforeAll(async () => {
    chain = await Chain.start();
  });
  afterAll(() => chain?.stop());

  it("vendor cap", async () => {
    const world = await makeWorld(chain, { vendor_cap: 500n, weekly_cap: 10_000n });
    expect((await world.request(await world.addPayable(501n))).rejection).toBe("OVER_VENDOR_CAP");
    expect((await world.request(await world.addPayable(500n))).ok).toBe(true);
  });

  it("weekly cap", async () => {
    const world = await makeWorld(chain, { vendor_cap: 2_000n, weekly_cap: 1_000n, lifetime_cap: 100_000n });
    expect((await world.request(await world.addPayable(1_001n))).rejection).toBe("OVER_WEEKLY_CAP");
    expect((await world.request(await world.addPayable(1_000n))).ok).toBe(true);
    expect((await world.request(await world.addPayable(1n))).rejection).toBe("OVER_WEEKLY_CAP");
  });

  it("lifetime cap", async () => {
    const world = await makeWorld(chain, { vendor_cap: 2_000n, weekly_cap: 2_000n, lifetime_cap: 1_000n });
    expect((await world.request(await world.addPayable(1_001n))).rejection).toBe("OVER_LIFETIME_CAP");
    expect((await world.request(await world.addPayable(1_000n))).ok).toBe(true);
    expect((await world.request(await world.addPayable(1n))).rejection).toBe("OVER_LIFETIME_CAP");
  });

  it("balance", async () => {
    const world = await makeWorld(chain, { funded: 100n });
    expect((await world.request(await world.addPayable(101n))).rejection).toBe("INSUFFICIENT_BALANCE");
    expect((await world.request(await world.addPayable(100n))).ok).toBe(true);
    expect((await world.usage()).balance_atomic).toBe("0");
  });

  it("capacity: pending and rolling slots, and vendors and payables", async () => {
    const world = await makeWorld(chain, { capacities: { max_vendors: 1, max_payables: 3, max_pending: 8, max_rolling: 1, max_operations: 8 } });
    expect((await world.request(await world.addPayable(1n))).ok).toBe(true);
    const second = await world.addPayable(1n);
    expect((await world.request(second)).rejection).toBe("CAPACITY_FULL");
    expect((await world.payable(second))?.status).toBe("OPEN");
    expect(
      await panicOf(() => world.admin.setVendor({ vendor_id: "two", display_name: "T", account_id: world.vendor.account_id, per_payment_cap_atomic: "1", active: true }, 0)),
    ).toBe("E_CAPACITY_FULL");
    await world.addPayable(1n);
    expect(await panicOf(() => world.addPayable(1n))).toBe("E_CAPACITY_FULL");
  });

  it("capacities above the hard limit are refused at deploy", async () => {
    await expect(makeWorld(chain, { capacities: { max_vendors: 9999, max_payables: 1, max_pending: 1, max_rolling: 1, max_operations: 1 } })).rejects.toThrow();
  });

  it("set_policy needs the current revision, and C cannot drop below S + R", async () => {
    const world = await makeWorld(chain, { vendor_cap: 2_000n, weekly_cap: 2_000n, lifetime_cap: 2_000n });
    expect((await world.request(await world.addPayable(500n))).ok).toBe(true);
    const change = (lifetime: bigint) => ({ weekly_cap_atomic: "2000", lifetime_cap_atomic: lifetime.toString(), expires_at_ns: "4000000000000000000" });
    expect(await panicOf(() => world.admin.setPolicy(change(600n), 9))).toBe("E_STALE_REVISION");
    expect(await panicOf(() => world.admin.setPolicy(change(499n), 1))).toBe("E_BELOW_COMMITTED");
    await world.admin.setPolicy(change(500n), 1);
    const usage = await world.usage();
    expect(usage.lifetime_settled_atomic).toBe("500");
    expect(usage.weekly_settled_atomic).toBe("500");
  });
});

describe("owner_pay", () => {
  let chain: Chain;

  beforeAll(async () => {
    chain = await Chain.start();
  });
  afterAll(() => chain?.stop());

  it("pays an over-cap item that the agent was refused, without consuming agent caps", async () => {
    const world = await makeWorld(chain, { vendor_cap: 100n, weekly_cap: 100n, lifetime_cap: 100n, funded: 10_000n });
    const payable = await world.addPayable(5_000n);
    expect((await world.request(payable)).rejection).toBe("OVER_VENDOR_CAP");

    const before = await world.tokenBalance(world.vendor.account_id);
    const result = await world.ownerPay(payable);
    expect(result.ok).toBe(true);
    expect((await world.tokenBalance(world.vendor.account_id)) - before).toBe(5_000n);

    const usage = await world.usage();
    expect(usage.owner_paid_atomic).toBe("5000");
    expect(usage.lifetime_settled_atomic).toBe("0");
    expect(usage.weekly_settled_atomic).toBe("0");
    expect(usage.balance_atomic).toBe("5000");
    expect(accountedTotal(usage)).toBe(10_000n);
    expect((await world.operation(result.operation_id as string))?.origin).toBe("OWNER");
    // The agent caps are untouched: the agent can still spend its full budget.
    expect((await world.request(await world.addPayable(100n))).ok).toBe(true);
  });

  it("is single-payment locked and needs balance", async () => {
    const world = await makeWorld(chain, { funded: 100n });
    const payable = await world.addPayable(60n);
    expect((await world.ownerPay(payable)).ok).toBe(true);
    expect((await world.ownerPay(payable)).rejection).toBe("ALREADY_PAID");
    expect((await world.request(payable)).rejection).toBe("ALREADY_PAID");
    expect((await world.ownerPay(await world.addPayable(41n))).rejection).toBe("INSUFFICIENT_BALANCE");
    expect((await world.ownerPay("never_registered")).rejection).toBe("UNKNOWN_PAYABLE");
  });

  it("works while paused, because the owner is the escalation path", async () => {
    const world = await makeWorld(chain);
    const payable = await world.addPayable(10n);
    await world.admin.pause();
    expect((await world.ownerPay(payable)).ok).toBe(true);
  });

  it("refuses to pay an old recipient after the owner rotated the vendor, but a cap change does not block it", async () => {
    const world = await makeWorld(chain);
    const capOnly = await world.addPayable(10n);
    const rotated = await world.addPayable(10n);
    await world.admin.setVendor({ vendor_id: "vnd", display_name: "V", account_id: world.vendor.account_id, per_payment_cap_atomic: "5", active: true }, 1);
    expect((await world.ownerPay(capOnly)).ok).toBe(true);
    const fresh = await chain.account("rotated");
    await world.admin.setVendor({ vendor_id: "vnd", display_name: "V", account_id: fresh.account_id, per_payment_cap_atomic: "5", active: true }, 2);
    expect((await world.ownerPay(rotated)).rejection).toBe("STALE_REVISION");
  });
});
