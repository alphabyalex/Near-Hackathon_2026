import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actions } from "near-api-js";
import { GAS_PAYMENT, NearVaultGateway, ONE_YOCTO, VaultOutcomeUnknownError, callFinal, readFinalOutcome, type SignerHandle } from "@wardline/vault-client";
import type { RequestResult } from "@wardline/schemas";
import { Chain, DIGEST_A, DIGEST_B, accountedTotal, makeWorld, panicOf, registerWithToken, wasm, type World } from "../src/harness.js";

/** Signs requests one after another, then sends them all at once, so they race on chain. */
async function raceRequests(world: World, requests: Array<{ payable_ref: string; request_digest: string }>): Promise<RequestResult[]> {
  const revisions = await world.revisions();
  const signed = [];
  for (const request of requests) {
    signed.push(
      await world.agentKey.account.createSignedTransaction({
        receiverId: world.vaultId,
        actions: [
          actions.functionCall(
            "request_payment",
            {
              ...request,
              expected_vendor_revision: revisions.vendor,
              expected_policy_revision: revisions.policy,
              expected_binding_revision: revisions.binding,
            },
            GAS_PAYMENT,
            0n,
          ),
        ],
      }),
    );
  }
  const outcomes = await Promise.all(signed.map((tx) => world.chain.provider.sendTransactionUntil(tx, "FINAL")));
  return outcomes.map((outcome) => readFinalOutcome(outcome).value as RequestResult);
}

describe("concurrency", () => {
  let chain: Chain;

  beforeAll(async () => {
    chain = await Chain.start();
  });
  afterAll(() => chain?.stop());

  it("two concurrent requests for the same payable with the same digest pay once and return one operation", async () => {
    const world = await makeWorld(chain);
    const payable = await world.addPayable(700n);
    const before = await world.tokenBalance(world.vendor.account_id);

    const results = await raceRequests(world, [
      { payable_ref: payable, request_digest: DIGEST_A },
      { payable_ref: payable, request_digest: DIGEST_A },
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]?.operation_id).toBe(results[1]?.operation_id);
    expect((await world.tokenBalance(world.vendor.account_id)) - before).toBe(700n);
    const usage = await world.usage();
    expect(usage.lifetime_settled_atomic).toBe("700");
    expect(usage.lifetime_reserved_atomic).toBe("0");
    expect(accountedTotal(usage)).toBe(10_000_000n);
  });

  it("two concurrent requests with different digests: one wins, the other is locked out", async () => {
    const world = await makeWorld(chain);
    const payable = await world.addPayable(700n);
    const before = await world.tokenBalance(world.vendor.account_id);

    const results = await raceRequests(world, [
      { payable_ref: payable, request_digest: DIGEST_A },
      { payable_ref: payable, request_digest: DIGEST_B },
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(["ALREADY_PENDING", "ALREADY_PAID"]).toContain(loser?.rejection);
    expect((await world.tokenBalance(world.vendor.account_id)) - before).toBe(700n);
  });

  it("distinct payables racing for the last of the weekly budget: exactly one pays", async () => {
    const world = await makeWorld(chain, { vendor_cap: 1_000n, weekly_cap: 1_000n, lifetime_cap: 100_000n });
    const a = await world.addPayable(600n);
    const b = await world.addPayable(600n);
    const before = await world.tokenBalance(world.vendor.account_id);

    const results = await raceRequests(world, [
      { payable_ref: a, request_digest: DIGEST_A },
      { payable_ref: b, request_digest: DIGEST_A },
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.rejection).toBe("OVER_WEEKLY_CAP");
    expect((await world.tokenBalance(world.vendor.account_id)) - before).toBe(600n);
  });

  it("distinct payables racing for the last of the balance: exactly one pays", async () => {
    const world = await makeWorld(chain, { funded: 1_000n });
    const a = await world.addPayable(600n);
    const b = await world.addPayable(600n);

    const results = await raceRequests(world, [
      { payable_ref: a, request_digest: DIGEST_A },
      { payable_ref: b, request_digest: DIGEST_A },
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.rejection).toBe("INSUFFICIENT_BALANCE");
    expect((await world.usage()).balance_atomic).toBe("400");
  });
});

describe("token failure", () => {
  let chain: Chain;

  beforeAll(async () => {
    chain = await Chain.start();
  });
  afterAll(() => chain?.stop());

  it("recipient not registered with the token: known failure, released once, retry works after registration", async () => {
    const world = await makeWorld(chain, { register_vendor: false, funded: 1_000n });
    const payable = await world.addPayable(300n);
    const vaultBefore = await world.tokenBalance(world.vaultId);

    const result = await world.request(payable);
    // The request was accepted, and the transfer then failed. `ok` is about the request.
    expect(result.ok).toBe(true);
    const operation = await world.operation(result.operation_id as string);
    expect(operation?.status).toBe("FAILED_KNOWN");
    expect((await world.payable(payable))?.status).toBe("FAILED_KNOWN");

    const usage = await world.usage();
    expect(usage.balance_atomic).toBe("1000");
    expect(usage.lifetime_reserved_atomic).toBe("0");
    expect(usage.lifetime_settled_atomic).toBe("0");
    expect(usage.weekly_settled_atomic).toBe("0");
    expect(usage.pending_count).toBe(0);
    expect(await world.tokenBalance(world.vaultId)).toBe(vaultBefore);

    // A failed payable is not open to the agent until the owner reopens it.
    expect((await world.request(payable)).rejection).toBe("UNKNOWN_PAYABLE");
    expect(await panicOf(() => callFinal(world.agent, { contract_id: world.vaultId, method: "reopen_failed_payable", args: { payable_ref: payable }, deposit: ONE_YOCTO }))).toBe("E_NOT_OWNER");

    await registerWithToken(world.token, world.owner, world.vendor.account_id);
    await world.admin.reopenFailedPayable(payable);
    const retry = await world.request(payable);
    expect(retry.operation_id).not.toBe(result.operation_id);
    const settled = await world.operation(retry.operation_id as string);
    expect(settled?.status).toBe("SETTLED");
    expect(settled?.attempt).toBe(2);
    expect(await world.tokenBalance(world.vendor.account_id)).toBe(300n);
    expect(accountedTotal(await world.usage())).toBe(1_000n);
  });

  it("owner_pay to an unregistered recipient fails the same way", async () => {
    const world = await makeWorld(chain, { register_vendor: false, funded: 1_000n });
    const payable = await world.addPayable(300n);
    const result = await world.ownerPay(payable);
    expect((await world.operation(result.operation_id as string))?.status).toBe("FAILED_KNOWN");
    const usage = await world.usage();
    expect(usage.owner_paid_atomic).toBe("0");
    expect(usage.owner_reserved_atomic).toBe("0");
    expect(usage.balance_atomic).toBe("1000");
  });

  it("fake token panics: released once", async () => {
    const world = await makeWorld(chain, { fake_token: true, funded: 1_000n });
    await world.setTokenMode("fail");
    const result = await world.request(await world.addPayable(300n));
    expect((await world.operation(result.operation_id as string))?.status).toBe("FAILED_KNOWN");
    expect((await world.usage()).balance_atomic).toBe("1000");
    expect(await world.transferCount()).toBe(0); // The panic reverted the token's own counter too.
  });

  it("anything else: an unexpected success value stays reserved until the owner reconciles", async () => {
    const world = await makeWorld(chain, { fake_token: true, funded: 1_000n, vendor_cap: 1_000n, weekly_cap: 1_000n });
    await world.setTokenMode("weird");
    const payable = await world.addPayable(300n);
    const result = await world.request(payable);
    const operationId = result.operation_id as string;

    expect((await world.operation(operationId))?.status).toBe("OUTCOME_UNCERTAIN");
    expect((await world.payable(payable))?.status).toBe("PENDING");
    let usage = await world.usage();
    expect(usage.lifetime_reserved_atomic).toBe("300");
    expect(usage.balance_atomic).toBe("700");
    expect(usage.pending_count).toBe(1);

    // It holds the lock and the budget.
    expect((await world.request(payable, { request_digest: DIGEST_B })).rejection).toBe("ALREADY_PENDING");
    expect((await world.ownerPay(payable)).rejection).toBe("ALREADY_PENDING");
    expect((await world.request(await world.addPayable(701n))).rejection).toBe("OVER_WEEKLY_CAP");

    await world.admin.reconcileOperation(operationId, true);
    usage = await world.usage();
    expect((await world.operation(operationId))?.status).toBe("SETTLED");
    expect(usage.lifetime_settled_atomic).toBe("300");
    expect(usage.lifetime_reserved_atomic).toBe("0");
    expect(accountedTotal(usage)).toBe(1_000n);
    expect(await panicOf(() => world.admin.reconcileOperation(operationId, false))).toBe("E_NOT_RECONCILABLE");
  });

  it("reconciling as failed releases the reservation", async () => {
    const world = await makeWorld(chain, { fake_token: true, funded: 1_000n });
    await world.setTokenMode("weird");
    const result = await world.request(await world.addPayable(300n));
    await world.admin.reconcileOperation(result.operation_id as string, false);
    expect((await world.operation(result.operation_id as string))?.status).toBe("FAILED_KNOWN");
    expect((await world.usage()).balance_atomic).toBe("1000");
  });
});

describe("while a payment is pending", () => {
  let chain: Chain;
  let forger: SignerHandle;

  beforeAll(async () => {
    chain = await Chain.start();
    forger = await chain.account("forger");
  });
  afterAll(() => chain?.stop());

  /** Starts a request the fake token holds open. Returns the in-flight result and its payable. */
  async function heldPayment(world: World, amount = 300n): Promise<{ payable: string; result: Promise<RequestResult> }> {
    await world.setTokenMode("hold");
    const payable = await world.addPayable(amount);
    const result = world.request(payable);
    await world.waitFor("the transfer to be held", async () => (await world.view<unknown>("get_payable", { payable_ref: payable }), (await world.payable(payable))?.status === "PENDING" && (await world.transferCount()) > 0));
    return { payable, result };
  }

  const heldWorld = () => makeWorld(chain, { fake_token: true, funded: 1_000n, vendor_cap: 1_000n, weekly_cap: 1_000n, lifetime_cap: 1_000n });

  it("reservation is real: A and R move before the transfer resolves, retries pay nothing extra", async () => {
    const world = await heldWorld();
    const { payable, result } = await heldPayment(world);

    const usage = await world.usage();
    expect(usage.balance_atomic).toBe("700");
    expect(usage.weekly_reserved_atomic).toBe("300");
    expect(usage.lifetime_reserved_atomic).toBe("300");
    expect(usage.pending_count).toBe(1);
    expect((await world.operation("op_1"))?.status).toBe("RESERVED");

    expect(await world.request(payable)).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect((await world.request(payable, { request_digest: DIGEST_B })).rejection).toBe("ALREADY_PENDING");
    expect((await world.ownerPay(payable)).rejection).toBe("ALREADY_PENDING");
    expect(await world.transferCount()).toBe(1);

    await world.releaseHeld("ok");
    expect(await result).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect((await world.operation("op_1"))?.status).toBe("SETTLED");
    expect((await world.usage()).lifetime_settled_atomic).toBe("300");
    expect(await world.transferCount()).toBe(1);
  });

  it("pending money counts against the caps", async () => {
    const world = await heldWorld();
    const { result } = await heldPayment(world, 800n);
    expect((await world.request(await world.addPayable(201n))).rejection).toBe("OVER_WEEKLY_CAP");
    await world.releaseHeld("ok");
    await result;
  });

  it("a held transfer that then fails releases once", async () => {
    const world = await heldWorld();
    const { payable, result } = await heldPayment(world);
    await world.releaseHeld("fail");
    await result;
    expect((await world.operation("op_1"))?.status).toBe("FAILED_KNOWN");
    expect((await world.payable(payable))?.status).toBe("FAILED_KNOWN");
    const usage = await world.usage();
    expect(usage.balance_atomic).toBe("1000");
    expect(usage.lifetime_reserved_atomic).toBe("0");
    expect(accountedTotal(usage)).toBe(1_000n);
  });

  it("pause while pending: the callback still settles, and new requests stop", async () => {
    const world = await heldWorld();
    const { payable, result } = await heldPayment(world);
    await world.admin.pause();
    expect((await world.request(await world.addPayable(1n))).rejection).toBe("PAUSED");
    await world.releaseHeld("ok");
    await result;
    expect((await world.payable(payable))?.status).toBe("SETTLED");
    expect((await world.usage()).lifetime_settled_atomic).toBe("300");
  });

  it("vendor change while pending: the locked recipient and amount stand", async () => {
    const world = await heldWorld();
    const { result } = await heldPayment(world);
    const lockedRecipient = world.vendor.account_id;
    await world.admin.setVendor({ vendor_id: "vnd", display_name: "V", account_id: forger.account_id, per_payment_cap_atomic: "1", active: false }, 1);
    await world.releaseHeld("ok");
    await result;
    const operation = await world.operation("op_1");
    expect(operation?.status).toBe("SETTLED");
    expect(operation?.recipient).toBe(lockedRecipient);
    expect(operation?.amount_atomic).toBe("300");
  });

  it("revoke while pending: it still resolves", async () => {
    const world = await heldWorld();
    const { result } = await heldPayment(world);
    await world.admin.revokeAgent(world.agent.account_id);
    await world.releaseHeld("ok");
    await result;
    expect((await world.operation("op_1"))?.status).toBe("SETTLED");
  });

  it("policy change while pending cannot drop C below S + R, and does not clear R", async () => {
    const world = await heldWorld();
    const { result } = await heldPayment(world);
    const change = (c: string) => ({ weekly_cap_atomic: "1", lifetime_cap_atomic: c, expires_at_ns: "4000000000000000000" });
    expect(await panicOf(() => world.admin.setPolicy(change("299"), 1))).toBe("E_BELOW_COMMITTED");
    await world.admin.setPolicy(change("300"), 1);
    expect((await world.usage()).lifetime_reserved_atomic).toBe("300");
    await world.releaseHeld("ok");
    await result;
    expect((await world.usage()).lifetime_settled_atomic).toBe("300");
  });

  it("the owner cannot reconcile a fresh pending operation to pay around it", async () => {
    const world = await heldWorld();
    const { result } = await heldPayment(world);
    expect(await panicOf(() => world.admin.reconcileOperation("op_1", false))).toBe("E_NOT_RECONCILABLE");
    await world.releaseHeld("ok");
    await result;
  });

  it("forged callback while pending: refused from any account, from the agent, and through a proxy", async () => {
    const world = await heldWorld();
    const { result } = await heldPayment(world);
    const args = { operation_id: "op_1" };
    expect(await panicOf(() => callFinal(forger, { contract_id: world.vaultId, method: "on_payment_result", args }))).toContain("private");
    expect(await panicOf(() => callFinal(world.agent, { contract_id: world.vaultId, method: "on_payment_result", args }))).toContain("private");
    expect(await panicOf(() => callFinal(world.owner, { contract_id: world.vaultId, method: "on_payment_result", args }))).toContain("private");

    const proxy = await chain.account("proxy");
    await chain.deploy(proxy, wasm("test-proxy"));
    expect(
      await panicOf(() =>
        callFinal(forger, {
          contract_id: proxy.account_id,
          method: "forward",
          args: { receiver: world.vaultId, method: "on_payment_result", args_json: JSON.stringify(args), gas_tgas: 30 },
          gas: GAS_PAYMENT,
        }),
      ),
    ).toContain("private");

    // None of that resolved anything: the real callback still decides.
    expect((await world.operation("op_1"))?.status).toBe("RESERVED");
    expect((await world.usage()).lifetime_reserved_atomic).toBe("300");
    await world.releaseHeld("ok");
    await result;
    expect((await world.operation("op_1"))?.status).toBe("SETTLED");
  });

  it("the client does not call a timeout a failure, and a retry cannot pay twice", async () => {
    const world = await heldWorld();
    await world.setTokenMode("hold");
    const payable = await world.addPayable(300n);
    const rpcUrl = chain.sandbox.rpcUrl;
    const signers = { [world.vaultId]: { agent: { account_id: world.agent.account_id, private_key: world.agentKey.private_key } } };
    const impatient = new NearVaultGateway({ network: "sandbox", rpc_url: rpcUrl, signers, final_timeout_ms: 500, poll_interval_ms: 100 });
    const request = await world.requestFor(payable);

    await expect(impatient.requestPayment(world.vaultId, request)).rejects.toBeInstanceOf(VaultOutcomeUnknownError);
    await world.waitFor("the reservation", async () => (await world.payable(payable))?.status === "PENDING");
    expect((await world.operation("op_1"))?.status).toBe("RESERVED");

    // Retrying while the first attempt is in flight returns that attempt.
    const patient = new NearVaultGateway({ network: "sandbox", rpc_url: rpcUrl, signers });
    expect(await patient.requestPayment(world.vaultId, request)).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect(await world.transferCount()).toBe(1);

    await world.releaseHeld("ok");
    await world.waitFor("settlement", async () => (await world.operation("op_1"))?.status === "SETTLED");
    expect(await patient.requestPayment(world.vaultId, request)).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect(await world.transferCount()).toBe(1);
    expect((await patient.getOperation(world.vaultId, "op_1"))?.tx_hash).toEqual(expect.any(String));
  });
});

describe("the gateway end to end", () => {
  it("implements VaultGateway against the real contract", async () => {
    const chain = await Chain.start();
    try {
      const world = await makeWorld(chain, { vendor_cap: 100n, funded: 10_000n });
      const gateway = new NearVaultGateway({
        network: "sandbox",
        rpc_url: chain.sandbox.rpcUrl,
        signers: {
          [world.vaultId]: {
            agent: { account_id: world.agent.account_id, private_key: world.agentKey.private_key },
            owner: { account_id: world.owner.account_id, private_key: (world.owner as SignerHandle & { private_key: string }).private_key },
          },
        },
      });

      const payable = await world.addPayable(50n);
      const paid = await gateway.requestPayment(world.vaultId, await world.requestFor(payable));
      expect(paid.ok).toBe(true);
      expect((await gateway.getOperation(world.vaultId, paid.operation_id as string))?.status).toBe("SETTLED");
      expect((await gateway.getPayable(world.vaultId, payable))?.status).toBe("SETTLED");
      expect(await gateway.getPayable(world.vaultId, "nope")).toBeNull();
      expect(await gateway.getOperation(world.vaultId, "op_404")).toBeNull();

      const big = await world.addPayable(500n);
      const rejected = await gateway.requestPayment(world.vaultId, await world.requestFor(big));
      expect(rejected).toEqual({ ok: false, operation_id: null, rejection: "OVER_VENDOR_CAP" });
      expect((await gateway.ownerPay(world.vaultId, big)).ok).toBe(true);

      expect((await gateway.getUsage(world.vaultId)).lifetime_settled_atomic).toBe("50");
      expect((await gateway.getPolicy(world.vaultId)).revision).toBe(1);
      expect((await gateway.getBinding(world.vaultId))?.agent_account_id).toBe(world.agent.account_id);
      expect(await gateway.getVendors(world.vaultId)).toHaveLength(1);
      expect(await gateway.getPayables(world.vaultId)).toHaveLength(2);

      await gateway.pause(world.vaultId);
      expect((await gateway.getPolicy(world.vaultId)).paused).toBe(true);
      await gateway.revokeAgent(world.vaultId, world.agent.account_id);
      expect((await gateway.getBinding(world.vaultId))?.enabled).toBe(false);
    } finally {
      await chain.stop();
    }
  });
});

void DIGEST_A;
