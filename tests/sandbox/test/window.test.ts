import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Chain, WEEK_NS, makeWorld, type World } from "../src/harness.js";

const SECOND = 1_000_000_000n;
const MARGIN = 40n * SECOND;

/**
 * The rolling window on the real wasm, crossing the real 7-day boundary. The settled entry is
 * back-dated so the boundary is about 40 seconds away, then block time carries it across.
 * A block cannot be aimed at one exact nanosecond, so this asserts the rule at whichever block
 * times it gets: an entry counts if and only if `now < settled_at + 7 days`. The exact edges (1 ns
 * before, at, and 1 ns after) are in contracts/vault/src/tests.rs and packages/vault-sim/test.
 */
describe("rolling 7-day window", () => {
  let chain: Chain;
  let world: World;
  let boundary: bigint;

  beforeAll(async () => {
    chain = await Chain.start();
    world = await makeWorld(chain, { vendor_cap: 1_000n, weekly_cap: 1_000n, lifetime_cap: 100_000n });
    const result = await world.request(await world.addPayable(1_000n));
    const settledAt = BigInt((await world.operation(result.operation_id as string))?.resolved_at_ns as string);

    const now = await chain.blockTimestampNs();
    const aged = now + MARGIN - WEEK_NS; // The new settled_at: 7 days before (now + margin).
    expect(await chain.ageRolling(world.vaultId, settledAt - aged)).toBe(1);
    boundary = aged + WEEK_NS;
  });
  afterAll(() => chain?.stop());

  it("just before 7 days: it still counts, and it still blocks a payment", async () => {
    const payable = await world.addPayable(1n);
    const usage = await world.usage();
    const result = await world.request(payable);
    const after = await chain.blockTimestampNs();

    expect(after).toBeLessThan(boundary);
    expect(usage.weekly_settled_atomic).toBe("1000");
    expect(result.rejection).toBe("OVER_WEEKLY_CAP");
    expect(usage.lifetime_settled_atomic).toBe("1000");
  });

  it("after 7 days: it no longer counts, a payment goes through, and lifetime keeps it", async () => {
    await world.waitFor("block time to pass the boundary", async () => (await chain.blockTimestampNs()) >= boundary, 90_000);

    const usage = await world.usage();
    expect(usage.weekly_settled_atomic).toBe("0");
    expect(usage.lifetime_settled_atomic).toBe("1000");

    const result = await world.request(await world.addPayable(1_000n));
    expect(result.ok).toBe(true);
    const later = await world.usage();
    expect(later.weekly_settled_atomic).toBe("1000");
    expect(later.lifetime_settled_atomic).toBe("2000");
  });

  it("the expired entry was pruned, so it holds no capacity", async () => {
    // After the prune there is exactly one live entry, the payment above.
    expect(await chain.ageRolling(world.vaultId, 0n)).toBe(1);
  });
});
