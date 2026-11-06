import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_NS,
  DEFAULT_GAS,
  captureFailure,
  rejectionCode,
  request,
  setupSandbox,
} from "./helpers.mjs";

async function withSandbox(options, body) {
  const fixture = await setupSandbox(options);
  try {
    await body(fixture);
  } finally {
    await fixture.tearDown();
  }
}

test("authorization, key, proxy, revocation, and tenant boundaries", async () => {
  await withSandbox({}, async (fixture) => {
    const {
      root,
      vaultA,
      vaultB,
      proxy,
      agentA,
      agentAKey,
      wrongAgentKey,
      outsider,
      nowNs,
    } = fixture;
    await fixture.registerDefaultPayable();

    const wrongCaller = await outsider.call(vaultA, "request_payment", {
      request: request("payable-1", "sha256:wrong-caller"),
    });
    assert.equal(rejectionCode(wrongCaller), "AGENT_ACCOUNT_MISMATCH");

    const wrongKey = await agentA.call(
      vaultA,
      "request_payment",
      { request: request("payable-1", "sha256:wrong-key") },
      { signWithKey: wrongAgentKey, gas: DEFAULT_GAS },
    );
    assert.equal(rejectionCode(wrongKey), "AGENT_KEY_MISMATCH");

    const proxyResult = await outsider.call(
      proxy,
      "forward_request",
      {
        vault_id: vaultA.accountId,
        request: request("payable-1", "sha256:proxy"),
      },
      { gas: DEFAULT_GAS },
    );
    assert.equal(rejectionCode(proxyResult), "CALLER_SIGNER_MISMATCH");

    const ownerMethodFailure = await captureFailure(() =>
      agentA.call(vaultA, "pause", {}, { signWithKey: agentAKey, gas: DEFAULT_GAS }));
    assert.match(ownerMethodFailure, /method|permission|access key|does not have/i);

    const crossTenantFailure = await captureFailure(() =>
      agentA.call(
        vaultB,
        "request_payment",
        { request: request("payable-b", "sha256:cross-tenant") },
        { signWithKey: agentAKey, gas: DEFAULT_GAS },
      ));
    assert.match(crossTenantFailure, /receiver|permission|access key|does not have/i);

    await root.call(vaultA, "revoke_agent", { expected_revision: 1 });
    const revoked = await agentA.call(
      vaultA,
      "request_payment",
      { request: request("payable-1", "sha256:revoked", { policy: 1, vendor: 1, binding: 2 }) },
      { signWithKey: agentAKey, gas: DEFAULT_GAS },
    );
    assert.equal(rejectionCode(revoked), "AGENT_BINDING_DISABLED");

    await root.call(vaultA, "activate_agent", {
      input: {
        account_id: agentA.accountId,
        public_key: agentAKey.getPublicKey().toString(),
        manifest_digest: "sha256:expired-binding",
        valid_from_ns: (nowNs - 3n * DAY_NS).toString(),
        expires_at_ns: (nowNs - DAY_NS).toString(),
      },
      expected_revision: 2,
    });
    const expired = await agentA.call(
      vaultA,
      "request_payment",
      { request: request("payable-1", "sha256:expired", { policy: 1, vendor: 1, binding: 3 }) },
      { signWithKey: agentAKey, gas: DEFAULT_GAS },
    );
    assert.equal(rejectionCode(expired), "AGENT_BINDING_EXPIRED");
  });
});

test("payable lifecycle, stale revisions, vendor cap, and replay behavior", async () => {
  await withSandbox({}, async (fixture) => {
    const { root, vaultA, nowNs } = fixture;
    const unknown = await fixture.requestA("missing", "sha256:unknown");
    assert.equal(rejectionCode(unknown), "UNKNOWN_PAYABLE");

    await fixture.registerDefaultPayable({
      payableRef: "early",
      notBefore: nowNs + 2n * DAY_NS,
      dueAt: nowNs + 3n * DAY_NS,
      expiresAt: nowNs + 4n * DAY_NS,
    });
    assert.equal(rejectionCode(await fixture.requestA("early", "sha256:early")), "PAYABLE_TOO_EARLY");

    await fixture.registerDefaultPayable({
      payableRef: "expired",
      notBefore: nowNs - 4n * DAY_NS,
      dueAt: nowNs - 2n * DAY_NS,
      expiresAt: nowNs - DAY_NS,
    });
    assert.equal(rejectionCode(await fixture.requestA("expired", "sha256:expired")), "PAYABLE_EXPIRED");

    await fixture.registerDefaultPayable({ payableRef: "stale", amount: 100n });
    await root.call(vaultA, "set_vendor", {
      input: {
        vendor_id: "vendor-a",
        recipient: fixture.vendorA.accountId,
        per_payment_cap_atomic: fixture.vendorCap.toString(),
        enabled: true,
      },
      expected_revision: 1,
    });
    assert.equal(
      rejectionCode(await fixture.requestA("stale", "sha256:stale", { policy: 1, vendor: 2, binding: 1 })),
      "STALE_VENDOR_REVISION",
    );

    await fixture.registerDefaultPayable({
      payableRef: "over-cap",
      vendorRevision: 2,
      amount: fixture.vendorCap + 1n,
    });
    assert.equal(
      rejectionCode(await fixture.requestA("over-cap", "sha256:over-cap", { policy: 1, vendor: 2, binding: 1 })),
      "AMOUNT_OVER_VENDOR_CAP",
    );

    await fixture.registerDefaultPayable({
      payableRef: "exact-cap",
      vendorRevision: 2,
      amount: fixture.vendorCap,
    });
    const digest = "sha256:exact-cap";
    const paid = await fixture.requestA("exact-cap", digest, { policy: 1, vendor: 2, binding: 1 });
    assert.equal(paid.accepted, true);
    assert.equal(paid.status, "SETTLED");

    const replay = await fixture.requestA("exact-cap", digest, { policy: 1, vendor: 2, binding: 1 });
    assert.equal(replay.accepted, true);
    assert.equal(replay.existing, true);
    const conflict = await fixture.requestA("exact-cap", "sha256:conflict", {
      policy: 1,
      vendor: 2,
      binding: 1,
    });
    assert.equal(rejectionCode(conflict), "REQUEST_DIGEST_CONFLICT");
  });
});

test("weekly and lifetime exact boundaries reject the next atomic unit", async () => {
  await withSandbox({ weeklyCap: 500n, lifetimeCeiling: 5_000n, vendorCap: 1_000n }, async (fixture) => {
    await fixture.registerDefaultPayable({ payableRef: "weekly-exact", amount: 500n });
    const exact = await fixture.requestA("weekly-exact", "sha256:weekly-exact");
    assert.equal(exact.accepted, true);
    await fixture.registerDefaultPayable({ payableRef: "weekly-plus-one", amount: 1n });
    assert.equal(
      rejectionCode(await fixture.requestA("weekly-plus-one", "sha256:weekly-plus-one")),
      "WEEKLY_CAP_EXCEEDED",
    );
  });

  await withSandbox({ weeklyCap: 5_000n, lifetimeCeiling: 500n, vendorCap: 1_000n }, async (fixture) => {
    await fixture.registerDefaultPayable({ payableRef: "lifetime-exact", amount: 500n });
    const exact = await fixture.requestA("lifetime-exact", "sha256:lifetime-exact");
    assert.equal(exact.accepted, true);
    await fixture.registerDefaultPayable({ payableRef: "lifetime-plus-one", amount: 1n });
    assert.equal(
      rejectionCode(await fixture.requestA("lifetime-plus-one", "sha256:lifetime-plus-one")),
      "LIFETIME_CEILING_EXCEEDED",
    );
  });
});

test("token failure releases once, owner escalation bypasses caps, callbacks stay private", async () => {
  await withSandbox({ vendorCap: 100n }, async (fixture) => {
    const { root, vaultA, outsider, nowNs } = fixture;
    await fixture.registerDefaultPayable({
      payableRef: "missing-storage",
      vendorId: "vendor-missing-storage",
      amount: 80n,
    });
    const failed = await fixture.requestA("missing-storage", "sha256:missing-storage");
    assert.equal(failed.accepted, true);
    assert.equal(failed.status, "FAILED_KNOWN");
    const usageAfterFailure = await vaultA.view("get_usage", {});
    assert.equal(usageAfterFailure.reserved_agent_total_atomic, "0");
    assert.equal(usageAfterFailure.available_balance_atomic, "10000");

    await root.call(vaultA, "reopen_failed_payable", { payable_ref: "missing-storage" });
    const reopened = await vaultA.view("get_payable", { payable_ref: "missing-storage" });
    assert.equal(reopened.status, "OPEN");

    await fixture.registerDefaultPayable({ payableRef: "owner-over-cap", amount: 200n });
    const ownerPaid = await root.call(vaultA, "owner_pay", { payable_ref: "owner-over-cap" }, {
      gas: DEFAULT_GAS,
    });
    assert.equal(ownerPaid.accepted, true);
    assert.equal(ownerPaid.status, "SETTLED");
    const ownerUsage = await vaultA.view("get_usage", {});
    assert.equal(ownerUsage.owner_paid_total_atomic, "200");
    assert.equal(ownerUsage.settled_agent_total_atomic, "0");

    const forged = await captureFailure(() =>
      outsider.call(vaultA, "on_payment_result", { operation_id: 1 }, { gas: DEFAULT_GAS }));
    assert.match(forged, /private|predecessor|contract itself/i);

    await root.call(vaultA, "pause", {});
    const beforeVendor = BigInt(await fixture.token.view("ft_balance_of", {
      account_id: fixture.vendorA.accountId,
    }));
    const withdrawal = await root.call(vaultA, "withdraw_available", {
      recipient: fixture.vendorA.accountId,
      amount_atomic: "50",
    }, { gas: DEFAULT_GAS });
    assert.equal(withdrawal.status, "SETTLED");
    const afterVendor = BigInt(await fixture.token.view("ft_balance_of", {
      account_id: fixture.vendorA.accountId,
    }));
    assert.equal(afterVendor - beforeVendor, 50n);

    const failedWithdrawal = await root.call(vaultA, "withdraw_available", {
      recipient: fixture.unregisteredVendor.accountId,
      amount_atomic: "25",
    }, { gas: DEFAULT_GAS });
    assert.equal(failedWithdrawal.status, "FAILED_KNOWN");
    const finalUsage = await vaultA.view("get_usage", {});
    assert.equal(finalUsage.pending_operations, 0);
    assert.ok(BigInt(finalUsage.available_balance_atomic) > 0n);
    assert.ok(nowNs > 0n);
  });
});

test("concurrent requests preserve a single paid lock and last-budget containment", async () => {
  await withSandbox({ weeklyCap: 500n, lifetimeCeiling: 5_000n, vendorCap: 500n }, async (fixture) => {
    await fixture.registerDefaultPayable({ payableRef: "same", amount: 100n });
    const sameDigest = "sha256:concurrent-same";
    const sameResults = await Promise.all([
      fixture.requestA("same", sameDigest),
      fixture.requestA("same", sameDigest),
    ]);
    assert.equal(sameResults.filter((result) => result.accepted).length, 2);
    assert.equal(sameResults.filter((result) => result.existing).length, 1);
    const samePayable = await fixture.vaultA.view("get_payable", { payable_ref: "same" });
    assert.equal(samePayable.status, "SETTLED");

    await fixture.registerDefaultPayable({ payableRef: "race-a", amount: 400n });
    await fixture.registerDefaultPayable({ payableRef: "race-b", amount: 400n });
    const raceResults = await Promise.all([
      fixture.requestA("race-a", "sha256:race-a"),
      fixture.requestA("race-b", "sha256:race-b"),
    ]);
    const accepted = raceResults.filter((result) => result.accepted);
    const rejected = raceResults.filter((result) => !result.accepted);
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejectionCode(rejected[0]), "WEEKLY_CAP_EXCEEDED");
    const usage = await fixture.vaultA.view("get_usage", {});
    assert.equal(usage.reserved_agent_total_atomic, "0");
    assert.equal(usage.rolling_settled_atomic, "500");
  });
});

test("rolling capacity expires after the seven-day window in sandbox time", async () => {
  await withSandbox({ weeklyCap: 400n, lifetimeCeiling: 1_000n, vendorCap: 500n }, async (fixture) => {
    await fixture.registerDefaultPayable({ payableRef: "rolling-first", amount: 400n });
    assert.equal((await fixture.requestA("rolling-first", "sha256:rolling-first")).accepted, true);
    await fixture.registerDefaultPayable({ payableRef: "rolling-second", amount: 1n });
    assert.equal(
      rejectionCode(await fixture.requestA("rolling-second", "sha256:rolling-before")),
      "WEEKLY_CAP_EXCEEDED",
    );

    await fixture.worker.provider.fastForward(605_000);
    const after = await fixture.requestA("rolling-second", "sha256:rolling-after");
    assert.equal(after.accepted, true);
  });
});
