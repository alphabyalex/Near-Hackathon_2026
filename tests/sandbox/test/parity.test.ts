import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Chain, DIGEST_B, makeWorld, type WorldOptions } from "../src/harness.js";
import { runParity, type Step, type TokenMode } from "../src/parity.js";

describe("parity: the simulator and the contract give identical outcomes", () => {
  let chain: Chain;

  beforeAll(async () => {
    chain = await Chain.start();
  });
  afterAll(() => chain?.stop());

  async function expectParity(options: WorldOptions, steps: Step[]): Promise<Record<string, number>> {
    const report = await runParity(chain, (o) => makeWorld(chain, o), options, steps);
    expect(report.mismatch).toBeNull();
    expect(report.steps).toBe(steps.length);
    return report.outcomes;
  }

  it("every rejection code a request can produce", async () => {
    await expectParity({ fake_token: true, vendor_cap: 500n, weekly_cap: 1_000n, lifetime_cap: 1_500n, funded: 1_700n }, [
      { op: "request", ref: "never_registered" },
      { op: "register", ref: "ok", amount: 500n },
      { op: "request", ref: "ok", caller: "stranger" },
      { op: "request", ref: "ok", caller: "agent_other_key" },
      { op: "request", ref: "ok", stale: "vendor" },
      { op: "request", ref: "ok", stale: "policy" },
      { op: "request", ref: "ok", stale: "binding" },
      { op: "pause" },
      { op: "request", ref: "ok" },
      { op: "unpause" },
      { op: "revoke" },
      { op: "request", ref: "ok" },
      { op: "reactivate" },
      { op: "register", ref: "early", amount: 1n, window: "early" },
      { op: "request", ref: "early" },
      { op: "register", ref: "expired", amount: 1n, window: "expired" },
      { op: "request", ref: "expired" },
      { op: "request", ref: "ok" },
      { op: "request", ref: "ok" },
      { op: "request", ref: "ok", digest: DIGEST_B },
      { op: "register", ref: "over_vendor", amount: 501n },
      { op: "request", ref: "over_vendor" },
      { op: "register", ref: "w1", amount: 500n },
      { op: "request", ref: "w1" },
      { op: "register", ref: "over_week", amount: 1n },
      { op: "request", ref: "over_week" },
      { op: "cancel", ref: "over_week" },
      { op: "request", ref: "over_week" },
    ]);
  });

  it("caps, exactly at and one over, then lifetime and balance", async () => {
    await expectParity({ fake_token: true, vendor_cap: 1_000n, weekly_cap: 1_000n, lifetime_cap: 1_000n, funded: 5_000n }, [
      { op: "register", ref: "over", amount: 1_001n },
      { op: "request", ref: "over" },
      { op: "register", ref: "exact", amount: 1_000n },
      { op: "request", ref: "exact" },
      { op: "register", ref: "one", amount: 1n },
      { op: "request", ref: "one" },
      { op: "set_policy", weekly: 10_000n, lifetime: 1_000n },
      { op: "request", ref: "one" },
      { op: "set_policy", weekly: 10_000n, lifetime: 999n },
      { op: "set_policy", weekly: 10_000n, lifetime: 20_000n, expected: 99 },
      { op: "set_policy", weekly: 10_000n, lifetime: 20_000n },
      { op: "request", ref: "one" },
      { op: "set_vendor", cap: 10_000n },
      { op: "register", ref: "broke", amount: 4_000n },
      { op: "request", ref: "broke" },
    ]);
  });

  it("owner_pay: over cap, separate accounting, locks, rotated vendor", async () => {
    await expectParity({ fake_token: true, vendor_cap: 100n, weekly_cap: 100n, lifetime_cap: 100n, funded: 10_000n }, [
      { op: "register", ref: "big", amount: 5_000n },
      { op: "request", ref: "big" },
      { op: "owner_pay", ref: "big", as: "agent" },
      { op: "owner_pay", ref: "big" },
      { op: "owner_pay", ref: "big" },
      { op: "request", ref: "big" },
      { op: "owner_pay", ref: "nope" },
      { op: "register", ref: "huge", amount: 5_001n },
      { op: "owner_pay", ref: "huge" },
      { op: "pause" },
      { op: "register", ref: "paused", amount: 10n },
      { op: "owner_pay", ref: "paused" },
      { op: "register", ref: "cap_only", amount: 10n },
      { op: "register", ref: "rotated", amount: 10n },
      { op: "set_vendor", cap: 5n },
      { op: "owner_pay", ref: "cap_only" },
      { op: "set_vendor", rotate: true },
      { op: "owner_pay", ref: "rotated" },
    ]);
  });

  it("known failure on the real token: unregistered recipient, release, reopen, retry", async () => {
    await expectParity({ register_vendor: false, funded: 1_000n }, [
      { op: "register", ref: "p", amount: 300n },
      { op: "request", ref: "p" },
      { op: "request", ref: "p" },
      { op: "owner_pay", ref: "p" },
      { op: "reopen", ref: "p" },
      { op: "request", ref: "p" },
      { op: "reopen", ref: "p" },
      { op: "register_vendor" },
      { op: "request", ref: "p" },
      { op: "reopen", ref: "p" },
      { op: "cancel", ref: "p" },
    ]);
  });

  it("uncertain results stay reserved until reconciled", async () => {
    await expectParity({ fake_token: true, vendor_cap: 1_000n, weekly_cap: 1_000n, lifetime_cap: 5_000n, funded: 5_000n }, [
      { op: "token", mode: "weird" },
      { op: "register", ref: "a", amount: 400n },
      { op: "request", ref: "a" },
      { op: "request", ref: "a", digest: DIGEST_B },
      { op: "owner_pay", ref: "a" },
      { op: "register", ref: "b", amount: 601n },
      { op: "request", ref: "b" },
      { op: "reconcile", operation: "op_1", settled: true },
      { op: "reconcile", operation: "op_1", settled: false },
      { op: "request", ref: "a" },
      { op: "register", ref: "c", amount: 100n },
      { op: "request", ref: "c" },
      { op: "reconcile", operation: "op_2", settled: false },
      { op: "reconcile", operation: "op_404", settled: false },
      { op: "reopen", ref: "c" },
      { op: "token", mode: "ok" },
      { op: "request", ref: "c" },
    ]);
  });

  it("pending: pause, vendor change, retries, caps, withdrawal, then release", async () => {
    await expectParity({ fake_token: true, vendor_cap: 1_000n, weekly_cap: 1_000n, lifetime_cap: 1_000n, funded: 2_000n }, [
      { op: "token", mode: "hold" },
      { op: "register", ref: "a", amount: 800n },
      { op: "request_held", ref: "a" },
      { op: "request", ref: "a" },
      { op: "request", ref: "a", digest: DIGEST_B },
      { op: "owner_pay", ref: "a" },
      { op: "reconcile", operation: "op_1", settled: true },
      { op: "cancel", ref: "a" },
      { op: "set_policy", weekly: 1_000n, lifetime: 799n },
      { op: "register", ref: "b", amount: 201n },
      { op: "request", ref: "b" },
      { op: "pause" },
      { op: "withdraw", amount: 1n },
      { op: "set_vendor", cap: 1n, rotate: true },
      { op: "release", outcome: "ok" },
      { op: "request", ref: "a" },
      { op: "unpause" },
      { op: "token", mode: "ok" },
      { op: "request", ref: "b" },
    ]);
  });

  it("a failed hold releases, and withdrawals account the same", async () => {
    await expectParity({ fake_token: true, funded: 1_000n }, [
      { op: "token", mode: "hold" },
      { op: "register", ref: "a", amount: 300n },
      { op: "request_held", ref: "a" },
      { op: "release", outcome: "fail" },
      { op: "request", ref: "a" },
      { op: "token", mode: "ok" },
      { op: "withdraw", amount: 1n },
      { op: "pause" },
      { op: "withdraw", amount: 1_001n },
      { op: "withdraw", amount: 0n },
      { op: "withdraw", amount: 1n, as: "agent" },
      { op: "withdraw", amount: 100n },
      { op: "token", mode: "fail" },
      { op: "withdraw", amount: 100n },
      { op: "fund", amount: 50n },
    ]);
  });

  it("capacities", async () => {
    await expectParity(
      { fake_token: true, capacities: { max_vendors: 4, max_payables: 4, max_pending: 1, max_rolling: 2, max_operations: 3 } },
      [
        { op: "token", mode: "hold" },
        { op: "register", ref: "a", amount: 1n },
        { op: "register", ref: "b", amount: 1n },
        { op: "request_held", ref: "a" },
        { op: "request", ref: "b" },
        { op: "owner_pay", ref: "b" },
        { op: "release", outcome: "ok" },
        { op: "token", mode: "ok" },
        { op: "request", ref: "b" },
        { op: "register", ref: "c", amount: 1n },
        { op: "request", ref: "c" },
        { op: "owner_pay", ref: "c" },
        { op: "register", ref: "d", amount: 1n },
        { op: "owner_pay", ref: "d" },
        { op: "register", ref: "e", amount: 1n },
      ],
    );
  });

  it("the rolling window clears at the same point on both", async () => {
    await expectParity({ fake_token: true, vendor_cap: 1_000n, weekly_cap: 1_000n, lifetime_cap: 5_000n }, [
      { op: "register", ref: "a", amount: 1_000n },
      { op: "request", ref: "a" },
      { op: "register", ref: "b", amount: 1n },
      { op: "request", ref: "b" },
      { op: "days", days: 6 },
      { op: "request", ref: "b" },
      { op: "days", days: 2 },
      { op: "request", ref: "b" },
    ]);
  });

  /** A small deterministic generator, so a failure can be replayed from its seed. */
  function randomSteps(seed: number, count: number): Step[] {
    let state = seed >>> 0;
    const next = (max: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 2 ** 32) * max);
    };
    const refs: string[] = [];
    const pick = (): string => refs[next(refs.length)] ?? "none";
    const steps: Step[] = [];
    for (let i = 0; i < count; i++) {
      const roll = next(100);
      if (roll < 22 || refs.length === 0) {
        const ref = `r${i}`;
        refs.push(ref);
        const windowRoll = next(10);
        steps.push({ op: "register", ref, amount: BigInt(1 + next(700)), window: windowRoll === 0 ? "early" : windowRoll === 1 ? "expired" : "open" });
      } else if (roll < 60) {
        const variant = next(10);
        if (variant === 0) steps.push({ op: "request", ref: pick(), caller: "stranger" });
        else if (variant === 1) steps.push({ op: "request", ref: pick(), stale: "policy" });
        else if (variant === 2) steps.push({ op: "request", ref: pick(), digest: DIGEST_B });
        else steps.push({ op: "request", ref: pick() });
      } else if (roll < 68) steps.push({ op: "owner_pay", ref: pick() });
      else if (roll < 74) steps.push({ op: "token", mode: (["ok", "ok", "fail", "weird"] as TokenMode[])[next(4)] as TokenMode });
      else if (roll < 79) steps.push({ op: "reopen", ref: pick() });
      else if (roll < 83) steps.push({ op: "cancel", ref: pick() });
      else if (roll < 87) steps.push({ op: "set_policy", weekly: BigInt(500 + next(2_000)), lifetime: BigInt(1_000 + next(10_000)) });
      else if (roll < 90) steps.push({ op: "set_vendor", cap: BigInt(100 + next(900)) });
      else if (roll < 94) steps.push({ op: "reconcile", operation: `op_${1 + next(8)}`, settled: next(2) === 0 });
      else if (roll < 97) steps.push({ op: next(2) === 0 ? "pause" : "unpause" });
      else steps.push({ op: next(2) === 0 ? "revoke" : "reactivate" });
    }
    return steps;
  }

  it.each([[1], [20261105]])("a generated sequence from seed %i", async (seed) => {
    const outcomes = await expectParity({ fake_token: true, vendor_cap: 700n, weekly_cap: 1_500n, lifetime_cap: 6_000n, funded: 20_000n }, randomSteps(seed, 60));
    console.log(`seed ${seed} outcomes: ${JSON.stringify(outcomes)}`);
    // A sequence that only ever hit one answer would prove nothing.
    expect(outcomes.ACCEPTED ?? 0).toBeGreaterThan(0);
    expect(Object.keys(outcomes).filter((label) => label !== "done" && label !== "ACCEPTED").length).toBeGreaterThanOrEqual(4);
  }, 600_000);
});
