import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAS_PAYMENT, ONE_YOCTO, callFinal, viewCall, type SignerHandle } from "@redline/vault-client";
import { Chain, DIGEST_A, accountedTotal, deployMockToken, fundVault, makeWorld, panicOf, registerWithToken } from "../src/harness.js";

describe("funding", () => {
  let chain: Chain;

  beforeAll(async () => {
    chain = await Chain.start();
  });
  afterAll(() => chain?.stop());

  it("the token reads as the labeled test token", async () => {
    const world = await makeWorld(chain);
    const metadata = await viewCall<{ name: string; symbol: string; decimals: number }>(chain.provider, world.token.account_id, "ft_metadata");
    expect(metadata).toMatchObject({ name: "Spend Gym Test Dollar", symbol: "sgUSD", decimals: 6 });
  });

  it("only ft_transfer_call credits, and funding never raises a limit", async () => {
    const world = await makeWorld(chain, { funded: 100n });
    const policy = await world.view("get_policy");
    await fundVault(world.token, world.owner, world.vaultId, 50n);
    expect((await world.usage()).balance_atomic).toBe("150");
    expect(await world.view("get_policy")).toEqual(policy);

    // A plain transfer lands in the token ledger but gives the vault no spendable credit.
    await callFinal(world.owner, { contract_id: world.token.account_id, method: "mint", args: { account_id: world.owner.account_id, amount: "25" } });
    await callFinal(world.owner, { contract_id: world.token.account_id, method: "ft_transfer", args: { receiver_id: world.vaultId, amount: "25" }, deposit: ONE_YOCTO });
    expect((await world.usage()).balance_atomic).toBe("150");
    expect(await world.tokenBalance(world.vaultId)).toBe(175n);
  });

  it("a different token cannot fund the vault, and its tokens are refunded", async () => {
    const world = await makeWorld(chain, { funded: 100n });
    const stranger = await chain.account("stranger");
    const otherToken = await deployMockToken(chain, stranger);
    await registerWithToken(otherToken, stranger, world.vaultId);
    await callFinal(stranger, { contract_id: otherToken.account_id, method: "mint", args: { account_id: stranger.account_id, amount: "500" } });

    await callFinal(stranger, {
      contract_id: otherToken.account_id,
      method: "ft_transfer_call",
      args: { receiver_id: world.vaultId, amount: "500", msg: "" },
      deposit: ONE_YOCTO,
      gas: GAS_PAYMENT,
    });

    expect((await world.usage()).balance_atomic).toBe("100");
    expect(await viewCall<string>(chain.provider, otherToken.account_id, "ft_balance_of", { account_id: stranger.account_id })).toBe("500");
  });

  it("calling ft_on_transfer directly is refused", async () => {
    const world = await makeWorld(chain, { funded: 100n });
    const stranger = await chain.account("stranger");
    const code = await panicOf(() =>
      callFinal(stranger, { contract_id: world.vaultId, method: "ft_on_transfer", args: { sender_id: stranger.account_id, amount: "1000000", msg: "" } }),
    );
    expect(code).toBe("E_WRONG_TOKEN");
    expect((await world.usage()).balance_atomic).toBe("100");
  });
});

describe("withdraw_available", () => {
  let chain: Chain;
  const withdraw = (owner: SignerHandle, vaultId: string, amount: string) =>
    callFinal(owner, { contract_id: vaultId, method: "withdraw_available", args: { amount }, deposit: ONE_YOCTO, gas: GAS_PAYMENT });

  beforeAll(async () => {
    chain = await Chain.start();
  });
  afterAll(() => chain?.stop());

  it("refuses when not paused, too much, nothing, or not the owner", async () => {
    const world = await makeWorld(chain, { funded: 100n });
    expect(await panicOf(() => withdraw(world.owner, world.vaultId, "1"))).toBe("E_NOT_PAUSED");
    await world.admin.pause();
    expect(await panicOf(() => withdraw(world.owner, world.vaultId, "101"))).toBe("E_INSUFFICIENT_BALANCE");
    expect(await panicOf(() => withdraw(world.owner, world.vaultId, "0"))).toBe("E_INSUFFICIENT_BALANCE");
    expect(await panicOf(() => withdraw(world.agent, world.vaultId, "1"))).toBe("E_NOT_OWNER");
    expect((await world.usage()).balance_atomic).toBe("100");
  });

  it("paused and clear: moves tokens to the owner and accounts for them", async () => {
    const world = await makeWorld(chain, { funded: 100n });
    await world.admin.pause();
    const before = await world.tokenBalance(world.owner.account_id);
    await withdraw(world.owner, world.vaultId, "40");
    expect((await world.tokenBalance(world.owner.account_id)) - before).toBe(40n);
    const usage = await world.usage();
    expect(usage.balance_atomic).toBe("60");
    expect(usage.withdrawn_atomic).toBe("40");
    expect(usage.withdrawal_in_flight_atomic).toBe("0");
    expect(accountedTotal(usage)).toBe(100n);
  });

  it("cannot touch reserved money: refused while a payment is pending", async () => {
    const world = await makeWorld(chain, { fake_token: true, funded: 1_000n });
    await world.setTokenMode("hold");
    const payable = await world.addPayable(300n);
    const held = world.request(payable);
    await world.waitFor("the transfer to be held", async () => (await world.transferCount()) > 0);
    await world.admin.pause();
    expect(await panicOf(() => withdraw(world.owner, world.vaultId, "1"))).toBe("E_PENDING_OPERATIONS");
    await world.releaseHeld("ok");
    await held;
    await world.setTokenMode("ok");
    await withdraw(world.owner, world.vaultId, "700"); // Exactly what is left.
    expect((await world.usage()).balance_atomic).toBe("0");
  });

  it("a failed withdrawal restores the balance once", async () => {
    const world = await makeWorld(chain, { fake_token: true, funded: 1_000n });
    await world.setTokenMode("fail");
    await world.admin.pause();
    await withdraw(world.owner, world.vaultId, "300");
    const usage = await world.usage();
    expect(usage.balance_atomic).toBe("1000");
    expect(usage.withdrawn_atomic).toBe("0");
    expect(usage.withdrawal_in_flight_atomic).toBe("0");
  });

  it("an unknown withdrawal result stays in flight, blocks others, and needs reconciling", async () => {
    const world = await makeWorld(chain, { fake_token: true, funded: 1_000n });
    await world.setTokenMode("weird");
    await world.admin.pause();
    await withdraw(world.owner, world.vaultId, "300");
    let usage = await world.usage();
    expect(usage.withdrawal_in_flight_atomic).toBe("300");
    expect(usage.balance_atomic).toBe("700");
    expect(accountedTotal(usage)).toBe(1_000n);
    expect(await panicOf(() => withdraw(world.owner, world.vaultId, "1"))).toBe("E_WITHDRAWAL_IN_FLIGHT");

    await world.admin.reconcileWithdrawal(false);
    usage = await world.usage();
    expect(usage.balance_atomic).toBe("1000");
    expect(usage.withdrawal_in_flight_atomic).toBe("0");
    expect(await panicOf(() => world.admin.reconcileWithdrawal(false))).toBe("E_NO_WITHDRAWAL");
  });

  it("a held withdrawal cannot be reconciled early, and forged callbacks are refused", async () => {
    const world = await makeWorld(chain, { fake_token: true, funded: 1_000n });
    await world.setTokenMode("hold");
    await world.admin.pause();
    const inFlight = withdraw(world.owner, world.vaultId, "300");
    await world.waitFor("the transfer to be held", async () => (await world.transferCount()) > 0);
    expect(await panicOf(() => world.admin.reconcileWithdrawal(true))).toBe("E_NOT_RECONCILABLE");
    expect(await panicOf(() => callFinal(world.agent, { contract_id: world.vaultId, method: "on_withdraw_result", args: { amount: "300" } }))).toContain("private");
    await world.releaseHeld("ok");
    await inFlight;
    expect((await world.usage()).withdrawn_atomic).toBe("300");
  });
});

void DIGEST_A;
