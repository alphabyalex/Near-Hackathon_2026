import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAS_ADMIN, GAS_PAYMENT, ONE_YOCTO, callFinal, type SignerHandle } from "@wardline/vault-client";
import { Chain, DIGEST_A, deployMockToken, makeWorld, panicOf, refusalOf, wasm, type World } from "../src/harness.js";

describe("who can call what", () => {
  let chain: Chain;
  let world: World;
  let stranger: SignerHandle;
  let agentFullKey: SignerHandle;

  beforeAll(async () => {
    chain = await Chain.start();
    world = await makeWorld(chain, { guardian: true });
    stranger = await chain.account("stranger");
    agentFullKey = world.agent;
  });
  afterAll(() => chain?.stop());

  describe("request_payment callers", () => {
    it("wrong account gets BAD_CALLER, nothing moves", async () => {
      const payable = await world.addPayable(10n);
      const result = await world.request(payable, {}, stranger);
      expect(result).toEqual({ ok: false, operation_id: null, rejection: "BAD_CALLER" });
      expect((await world.payable(payable))?.status).toBe("OPEN");
    });

    it("the agent's own account with a key that is not enrolled gets BAD_CALLER", async () => {
      const payable = await world.addPayable(10n);
      const otherKey = await chain.restrictedKey(world.agent, world.vaultId, ["request_payment"]);
      expect((await world.request(payable, {}, otherKey)).rejection).toBe("BAD_CALLER");
      expect((await world.request(payable, {}, agentFullKey)).rejection).toBe("BAD_CALLER");
    });

    it("a proxy contract in the middle gets BAD_CALLER, even signed by the enrolled key", async () => {
      // The enrolled key must be able to call the proxy for this case, so enroll a full-access key.
      const proxied = await makeWorld(chain);
      const proxy = await chain.account("proxy");
      await chain.deploy(proxy, wasm("test-proxy"));
      await proxied.admin.activateAgent(
        {
          agent_account_id: proxied.agent.account_id,
          public_key: proxied.agent.public_key,
          manifest_digest: DIGEST_A,
          assessment_ref: "run_test",
          expires_at_ns: "4000000000000000000",
        },
        1,
      );
      const payable = await proxied.addPayable(10n);
      const outcome = await callFinal(proxied.agent, {
        contract_id: proxy.account_id,
        method: "forward",
        args: {
          receiver: proxied.vaultId,
          method: "request_payment",
          args_json: JSON.stringify(await proxied.requestFor(payable)),
          gas_tgas: 80,
        },
        gas: GAS_PAYMENT,
      });
      expect(outcome.value).toEqual({ ok: false, operation_id: null, rejection: "BAD_CALLER" });
      // The same signer calling directly is accepted, so it was the proxy that failed the check.
      expect((await proxied.request(payable, {}, proxied.agent)).ok).toBe(true);
    });

    it("a revoked binding gets BINDING_INACTIVE and bumps the revision", async () => {
      const revoked = await makeWorld(chain);
      const payable = await revoked.addPayable(10n);
      await revoked.admin.revokeAgent(revoked.agent.account_id);
      expect((await revoked.request(payable, { expected_binding_revision: 1 })).rejection).toBe("BINDING_INACTIVE");
      expect((await revoked.revisions()).binding).toBe(2);
    });

    it("an expired binding gets BINDING_INACTIVE", async () => {
      const expired = await makeWorld(chain);
      const payable = await expired.addPayable(10n);
      await expired.admin.activateAgent(
        {
          agent_account_id: expired.agent.account_id,
          public_key: expired.agentKey.public_key,
          manifest_digest: DIGEST_A,
          assessment_ref: "run_test",
          expires_at_ns: "1",
        },
        1,
      );
      expect((await expired.request(payable)).rejection).toBe("BINDING_INACTIVE");
    });

    it("an expired policy gets BINDING_INACTIVE", async () => {
      const lapsed = await makeWorld(chain, { policy_expires_at_ns: 1n });
      const payable = await lapsed.addPayable(10n);
      expect((await lapsed.request(payable)).rejection).toBe("BINDING_INACTIVE");
    });

    it("a paused vault gets PAUSED", async () => {
      const paused = await makeWorld(chain);
      const payable = await paused.addPayable(10n);
      await paused.admin.pause();
      expect((await paused.request(payable)).rejection).toBe("PAUSED");
    });

    it("a new vault starts paused", async () => {
      const fresh = await makeWorld(chain, { unpaused: false });
      const payable = await fresh.addPayable(10n);
      expect((await fresh.request(payable)).rejection).toBe("PAUSED");
    });

    it("a malformed digest gets BAD_CALLER", async () => {
      const payable = await world.addPayable(10n);
      expect((await world.request(payable, { request_digest: "sha256:nothex" })).rejection).toBe("BAD_CALLER");
    });

    it("an attached deposit panics, which refunds it", async () => {
      const payable = await world.addPayable(10n);
      const message = await panicOf(() =>
        callFinal(agentFullKey, {
          contract_id: world.vaultId,
          method: "request_payment",
          args: { payable_ref: payable, request_digest: DIGEST_A, expected_vendor_revision: 1, expected_policy_revision: 1, expected_binding_revision: 1 },
          deposit: 1n,
          gas: GAS_PAYMENT,
        }),
      );
      expect(message).toContain("doesn't accept deposit");
    });

    it("too little gas panics with no reservation left behind", async () => {
      const payable = await world.addPayable(10n);
      const code = await panicOf(() =>
        callFinal(world.agentKey, {
          contract_id: world.vaultId,
          method: "request_payment",
          args: { payable_ref: payable, request_digest: DIGEST_A, expected_vendor_revision: 1, expected_policy_revision: 1, expected_binding_revision: 1 },
          gas: 40_000_000_000_000n,
        }),
      );
      expect(code).toBe("E_INSUFFICIENT_GAS");
      expect((await world.payable(payable))?.status).toBe("OPEN");
      expect((await world.usage()).pending_count).toBe(0);
    });
  });

  describe("the restricted agent key at the protocol level", () => {
    it.each([
      ["set_vendor", {}],
      ["set_policy", {}],
      ["pause", {}],
      ["unpause", {}],
      ["revoke_agent", { agent_account_id: "x" }],
      ["withdraw_available", { amount: "1" }],
      ["on_payment_result", { operation_id: "op_1" }],
    ])("NEAR refuses %s", async (method, args) => {
      const reason = await refusalOf(() => callFinal(world.agentKey, { contract_id: world.vaultId, method, args }));
      expect(reason).toBe("MethodNameMismatch");
    });

    it("NEAR refuses a call to any other contract", async () => {
      const reason = await refusalOf(() => callFinal(world.agentKey, { contract_id: world.token.account_id, method: "request_payment", args: {} }));
      expect(reason).toBe("ReceiverMismatch");
    });

    it("NEAR refuses an attached deposit", async () => {
      const reason = await refusalOf(() =>
        callFinal(world.agentKey, { contract_id: world.vaultId, method: "request_payment", args: {}, deposit: 1n }),
      );
      expect(reason).toBe("DepositWithFunctionCall");
    });

    it("the key really is restricted, and is the only key the binding accepts", async () => {
      const key = await world.agent.account.getAccessKey(world.agentKey.public_key);
      expect(JSON.stringify(key.permission)).toContain("request_payment");
      expect(JSON.stringify(key.permission)).toContain(world.vaultId);
      const binding = await world.view<{ public_key: string }>("get_binding");
      expect(binding.public_key).toBe(world.agentKey.public_key);
    });
  });

  describe("owner methods", () => {
    const anyVendor = { vendor_id: "x", display_name: "X", account_id: "x.sandbox", per_payment_cap_atomic: "1", active: true };
    const anyPolicy = { weekly_cap_atomic: "1", lifetime_cap_atomic: "1", expires_at_ns: "1" };

    it.each([
      ["set_vendor", { vendor: anyVendor, expected_revision: 0 }, ONE_YOCTO],
      ["set_policy", { change: anyPolicy, expected_revision: 1 }, ONE_YOCTO],
      ["activate_agent", { binding: { agent_account_id: "x.sandbox", public_key: "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp", manifest_digest: DIGEST_A, assessment_ref: "x", expires_at_ns: "1" }, expected_revision: 1 }, ONE_YOCTO],
      ["revoke_agent", { agent_account_id: "x.sandbox" }, 0n],
      ["unpause", {}, ONE_YOCTO],
      ["withdraw_available", { amount: "1" }, ONE_YOCTO],
      ["reconcile_operation", { operation_id: "op_1", settled: true }, ONE_YOCTO],
      ["reconcile_withdrawal", { settled: true }, ONE_YOCTO],
      ["reopen_failed_payable", { payable_ref: "x" }, ONE_YOCTO],
      ["cancel_payable", { payable_ref: "x" }, ONE_YOCTO],
    ] as Array<[string, object, bigint]>)("the agent's full-access key cannot call %s", async (method, args, deposit) => {
      const code = await panicOf(() => callFinal(agentFullKey, { contract_id: world.vaultId, method, args, deposit, gas: GAS_PAYMENT }));
      expect(code).toBe("E_NOT_OWNER");
    });

    it("the agent's full-access key gets BAD_CALLER from owner_pay", async () => {
      const payable = await world.addPayable(10n);
      expect((await world.ownerPay(payable, agentFullKey)).rejection).toBe("BAD_CALLER");
      expect((await world.payable(payable))?.status).toBe("OPEN");
    });

    it("money and limit methods need the 1 yocto, so an owner function-call key cannot use them", async () => {
      const code = await panicOf(() =>
        callFinal(world.owner, { contract_id: world.vaultId, method: "unpause", args: {}, gas: GAS_ADMIN }),
      );
      expect(code).toContain("Requires attached deposit of exactly 1 yoctoNEAR");
    });

    it("guardian can pause, and nothing else", async () => {
      const guarded = await makeWorld(chain, { guardian: true });
      const guardian = guarded.guardian as SignerHandle;
      expect(await panicOf(() => callFinal(guardian, { contract_id: guarded.vaultId, method: "unpause", args: {}, deposit: ONE_YOCTO }))).toBe("E_NOT_OWNER");
      await callFinal(guardian, { contract_id: guarded.vaultId, method: "pause", args: {} });
      expect((await guarded.view<{ paused: boolean }>("get_policy")).paused).toBe(true);
      expect(await panicOf(() => callFinal(world.agent, { contract_id: guarded.vaultId, method: "pause", args: {} }))).toBe("E_NOT_OWNER_OR_GUARDIAN");
    });

    it("new cannot run twice, and only the vault account can run it", async () => {
      const config = {
        owner: stranger.account_id,
        guardian: null,
        token_contract: world.token.account_id,
        token_decimals: 6,
        policy: { weekly_cap_atomic: "1", lifetime_cap_atomic: "1", expires_at_ns: "1" },
        capacities: null,
      };
      const byStranger = await panicOf(() => callFinal(stranger, { contract_id: world.vaultId, method: "new", args: { config } }));
      expect(byStranger).toContain("private");
      const byItself = await panicOf(() => callFinal(world.vault, { contract_id: world.vaultId, method: "new", args: { config } }));
      expect(byItself).toContain("already");
    });
  });

  describe("tenant separation: two vaults on one token", () => {
    let a: World;
    let b: World;

    beforeAll(async () => {
      const owner = await chain.account("shared-owner");
      const token = await deployMockToken(chain, owner);
      a = await makeWorld(chain, {}, { token, tokenOwner: owner });
      b = await makeWorld(chain, {}, { token, tokenOwner: owner });
    });

    it("NEAR refuses tenant A's restricted key on vault B", async () => {
      const reason = await refusalOf(() => callFinal(a.agentKey, { contract_id: b.vaultId, method: "request_payment", args: {} }));
      expect(reason).toBe("ReceiverMismatch");
    });

    it("tenant A's agent with a full-access key is still BAD_CALLER on vault B", async () => {
      const payable = await b.addPayable(10n);
      expect((await b.request(payable, {}, a.agent)).rejection).toBe("BAD_CALLER");
      expect((await b.payable(payable))?.status).toBe("OPEN");
    });

    it("tenant A's payable does not exist on vault B", async () => {
      const payable = await a.addPayable(10n, { payable_ref: "only_on_a" });
      expect((await b.request(payable)).rejection).toBe("UNKNOWN_PAYABLE");
      expect((await a.payable(payable))?.status).toBe("OPEN");
    });

    it("usage and funds stay separate", async () => {
      const before = await b.usage();
      const payable = await a.addPayable(10n);
      expect((await a.request(payable)).ok).toBe(true);
      expect(await b.usage()).toEqual(before);
    });

    it("a different owner cannot touch the other vault", async () => {
      const other = await makeWorld(chain);
      expect(await panicOf(() => callFinal(other.owner, { contract_id: a.vaultId, method: "unpause", args: {}, deposit: ONE_YOCTO }))).toBe("E_NOT_OWNER");
      const payable = await a.addPayable(10n);
      expect((await a.ownerPay(payable, other.owner)).rejection).toBe("BAD_CALLER");
    });
  });
});
