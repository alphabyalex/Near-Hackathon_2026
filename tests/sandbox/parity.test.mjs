import assert from "node:assert/strict";
import test from "node:test";
import {
  OperationStatus,
  SettlementOutcome,
  VaultSimulator,
} from "@spendgym/vault-sim";
import { DAY_NS, rejectionCode, request, setupSandbox } from "./helpers.mjs";

function simRequest(payableRef, digest, revisions = { policy: 1, vendor: 1, binding: 1 }) {
  return {
    payableRef,
    requestDigest: digest,
    expectedPolicyRevision: revisions.policy,
    expectedVendorRevision: revisions.vendor,
    expectedBindingRevision: revisions.binding,
  };
}

test("simulator and sandbox contract return the same policy outcomes and final accounting", async () => {
  const fixture = await setupSandbox({ weeklyCap: 1_000n, lifetimeCeiling: 3_000n, vendorCap: 500n });
  try {
    const owner = { predecessorAccountId: fixture.root.accountId, nowNs: fixture.nowNs };
    const sim = new VaultSimulator({
      vaultId: fixture.vaultA.accountId,
      ownerId: fixture.root.accountId,
      tokenContractId: fixture.token.accountId,
      tokenDecimals: 6,
      weeklyCapAtomic: 1_000n,
      lifetimeCeilingAtomic: 3_000n,
      capacities: {
        maxVendors: fixture.capacities.max_vendors,
        maxPayables: fixture.capacities.max_payables,
        maxOperations: fixture.capacities.max_operations,
        maxPendingOperations: fixture.capacities.max_pending_operations,
        maxRollingEntries: fixture.capacities.max_rolling_entries,
        maxIdentifierLength: fixture.capacities.max_identifier_length,
        maxDigestLength: fixture.capacities.max_digest_length,
      },
    });
    sim.setVendor(owner, {
      vendorId: "vendor-a",
      recipient: fixture.vendorA.accountId,
      perPaymentCapAtomic: 500n,
      enabled: true,
    }, 0);
    sim.activateAgent(owner, {
      accountId: fixture.agentA.accountId,
      publicKey: fixture.agentAKey.getPublicKey().toString(),
      manifestDigest: "sha256:sandbox-agent-a-v1",
      validFromNs: fixture.nowNs - DAY_NS,
      expiresAtNs: fixture.nowNs + 30n * DAY_NS,
    }, 0);
    sim.fund(fixture.token.accountId, 10_000n);
    sim.unpause(owner);

    const callContext = {
      currentAccountId: fixture.vaultA.accountId,
      predecessorAccountId: fixture.agentA.accountId,
      signerAccountId: fixture.agentA.accountId,
      signerPublicKey: fixture.agentAKey.getPublicKey().toString(),
      attachedDepositYocto: 0n,
      nowNs: fixture.nowNs,
    };

    const unknownSim = sim.requestPayment(callContext, simRequest("unknown", "sha256:unknown"));
    const unknownChain = await fixture.requestA("unknown", "sha256:unknown");
    assert.equal(unknownSim.accepted, false);
    assert.equal(unknownSim.rejection.code, rejectionCode(unknownChain));

    const early = {
      payableRef: "parity-early",
      vendorId: "vendor-a",
      vendorRevision: 1,
      amountAtomic: 100n,
      poNumber: "PO-parity-early",
      notBeforeNs: fixture.nowNs + 2n * DAY_NS,
      dueAtNs: fixture.nowNs + 3n * DAY_NS,
      expiresAtNs: fixture.nowNs + 4n * DAY_NS,
    };
    sim.registerPayable(owner, early);
    await fixture.registerDefaultPayable({
      payableRef: early.payableRef,
      amount: early.amountAtomic,
      notBefore: early.notBeforeNs,
      dueAt: early.dueAtNs,
      expiresAt: early.expiresAtNs,
    });
    const earlySim = sim.requestPayment(callContext, simRequest(early.payableRef, "sha256:early"));
    const earlyChain = await fixture.requestA(early.payableRef, "sha256:early");
    assert.equal(earlySim.accepted, false);
    assert.equal(earlySim.rejection.code, rejectionCode(earlyChain));

    const overCap = {
      payableRef: "parity-over-cap",
      vendorId: "vendor-a",
      vendorRevision: 1,
      amountAtomic: 501n,
      poNumber: "PO-parity-over-cap",
      notBeforeNs: fixture.nowNs - DAY_NS,
      dueAtNs: fixture.nowNs + 5n * DAY_NS,
      expiresAtNs: fixture.nowNs + 10n * DAY_NS,
    };
    sim.registerPayable(owner, overCap);
    await fixture.registerDefaultPayable({ payableRef: overCap.payableRef, amount: overCap.amountAtomic });
    const overSim = sim.requestPayment(callContext, simRequest(overCap.payableRef, "sha256:over-cap"));
    const overChain = await fixture.requestA(overCap.payableRef, "sha256:over-cap");
    assert.equal(overSim.accepted, false);
    assert.equal(overSim.rejection.code, rejectionCode(overChain));

    const routine = {
      payableRef: "parity-routine",
      vendorId: "vendor-a",
      vendorRevision: 1,
      amountAtomic: 400n,
      poNumber: "PO-parity-routine",
      notBeforeNs: fixture.nowNs - DAY_NS,
      dueAtNs: fixture.nowNs + 5n * DAY_NS,
      expiresAtNs: fixture.nowNs + 10n * DAY_NS,
    };
    sim.registerPayable(owner, routine);
    await fixture.registerDefaultPayable({ payableRef: routine.payableRef, amount: routine.amountAtomic });
    const digest = "sha256:parity-routine";
    const pendingSim = sim.requestPayment(callContext, simRequest(routine.payableRef, digest));
    assert.equal(pendingSim.accepted, true);
    const settledSim = sim.settlePayment(
      pendingSim.operationId,
      SettlementOutcome.SUCCESS,
      fixture.nowNs + 1n,
    );
    assert.equal(settledSim.status, OperationStatus.SETTLED);

    const settledChain = await fixture.requestA(routine.payableRef, digest);
    assert.equal(settledChain.accepted, true);
    assert.equal(settledChain.status, "SETTLED");

    const simPayable = sim.getPayable(routine.payableRef);
    const chainPayable = await fixture.vaultA.view("get_payable", { payable_ref: routine.payableRef });
    assert.equal(simPayable.status, chainPayable.status);
    assert.equal(simPayable.recipient, chainPayable.recipient);
    assert.equal(simPayable.amountAtomic.toString(), chainPayable.amount_atomic);

    const simUsage = sim.getUsage(fixture.nowNs + 1n);
    const chainUsage = await fixture.vaultA.view("get_usage", {});
    assert.equal(simUsage.settledAgentTotalAtomic.toString(), chainUsage.settled_agent_total_atomic);
    assert.equal(simUsage.reservedAgentTotalAtomic.toString(), chainUsage.reserved_agent_total_atomic);
    assert.equal(simUsage.availableBalanceAtomic.toString(), chainUsage.available_balance_atomic);
    assert.equal(simUsage.pendingOperations, chainUsage.pending_operations);
    assert.equal(simUsage.pendingAgentOperations, chainUsage.pending_agent_operations);

    const replaySim = sim.requestPayment(callContext, simRequest(routine.payableRef, digest));
    const replayChain = await fixture.requestA(routine.payableRef, digest);
    assert.equal(replaySim.accepted, true);
    assert.equal(replayChain.accepted, true);
    assert.equal(replaySim.existing, replayChain.existing);
    sim.assertInvariants(fixture.nowNs + 1n);
  } finally {
    await fixture.tearDown();
  }
});
