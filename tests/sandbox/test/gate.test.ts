import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Chain, makeWorld, refusalOf, type World } from "../src/harness.js";

describe("first gate: restricted key in sandbox", () => {
  let chain: Chain;
  let world: World;

  beforeAll(async () => {
    chain = await Chain.start();
    world = await makeWorld(chain);
  });
  afterAll(() => chain?.stop());

  it("request_payment signed by the restricted function-call key moves sgUSD to the vendor", async () => {
    const payable = await world.addPayable(1_250n);
    const before = await world.tokenBalance(world.vendor.account_id);

    const result = await world.request(payable);

    expect(result).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect((await world.tokenBalance(world.vendor.account_id)) - before).toBe(1_250n);
    expect((await world.operation("op_1"))?.status).toBe("SETTLED");
    expect((await world.payable(payable))?.status).toBe("SETTLED");
  });

  it("a forbidden request does not move money", async () => {
    const payable = await world.addPayable(50_001n);
    const before = await world.tokenBalance(world.vendor.account_id);

    const result = await world.request(payable);

    expect(result).toEqual({ ok: false, operation_id: null, rejection: "OVER_VENDOR_CAP" });
    expect(await world.tokenBalance(world.vendor.account_id)).toBe(before);
    expect((await world.payable(payable))?.status).toBe("OPEN");
  });

  it("the restricted key cannot even reach an owner method: NEAR refuses it", async () => {
    const reason = await refusalOf(() => world.ownerPay("pay_2", world.agentKey));
    expect(["MethodNameMismatch", "DepositWithFunctionCall", "RequiresFullAccess", "InvalidTxError"]).toContain(reason);
  });
});
