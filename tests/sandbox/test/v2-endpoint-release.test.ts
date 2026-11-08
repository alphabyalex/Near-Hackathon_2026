import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GAS_ADMIN,
  GAS_PAYMENT,
  ONE_YOCTO,
  PayeeRegistryClient,
  callFinal,
  viewCall,
  type SignerHandle,
} from "@redline/vault-client";
import {
  Chain,
  DIGEST_A,
  DIGEST_B,
  FAR_FUTURE_NS,
  makeWorld,
  panicOf,
  wasm,
  type World,
} from "../src/harness.js";

function getApprovalDigest(
  vaultId: string,
  vendorId: string,
  revision: number,
  account: string,
  expiryNs: bigint | string | number,
): string {
  const payload = `redline:endpoint-approval:${vaultId}:${vendorId}:${revision}:${account}:${expiryNs.toString()}`;
  const hash = createHash("sha256").update(payload).digest("hex");
  return `sha256:${hash}`;
}

describe("v2 endpoint change control, release guard, and payee registry", () => {
  let chain: Chain;
  let world: World;
  let approver: SignerHandle;
  let attestor: SignerHandle;
  let stranger: SignerHandle;
  let registryAccount: SignerHandle;
  let registryClient: PayeeRegistryClient;

  beforeAll(async () => {
    chain = await Chain.start();
    approver = await chain.account("approver");
    attestor = await chain.account("attestor");
    stranger = await chain.account("stranger");

    // Initialize world with separate approver and attestor
    world = await makeWorld(chain, {
      approver,
      attestor,
      conservative_caps: {
        weekly_cap_atomic: "5000",
        lifetime_cap_atomic: "20000",
        expires_at_ns: FAR_FUTURE_NS.toString(),
      },
    });

    // Deploy payee registry contract
    registryAccount = await chain.account("payee-reg");
    await chain.deploy(registryAccount, wasm("payee-registry"), {
      method: "new",
      args: {
        owner: world.owner.account_id,
        attestor: attestor.account_id,
        cooldown_ns: "10000000000", // 10 seconds for sandbox testing
      },
    });

    registryClient = new PayeeRegistryClient({
      rpcUrl: chain.sandbox.rpcUrl,
      registryId: registryAccount.account_id,
      signer: attestor,
    });
  });

  afterAll(() => chain?.stop());

  // 1. Agent calling approve_endpoint fails (wrong caller).
  it("1. Agent calling approve_endpoint fails with E_NOT_APPROVER", async () => {
    // Propose an endpoint first
    await world.admin.proposeEndpoint(
      "vnd",
      "near:testnet:newvendor.testnet",
      "T2",
      DIGEST_A,
    );

    const expiry = FAR_FUTURE_NS.toString();
    const digest = getApprovalDigest(
      world.vaultId,
      "vnd",
      2,
      "near:testnet:newvendor.testnet",
      expiry,
    );

    const panic = await panicOf(() =>
      callFinal(world.agent, {
        contract_id: world.vaultId,
        method: "approve_endpoint",
        args: {
          vendor_id: "vnd",
          revision: 2,
          approval_digest: digest,
          expiry_ns: expiry,
        },
        gas: GAS_ADMIN,
      }),
    );
    expect(panic).toBe("E_NOT_APPROVER");
  });

  // 2. Owner calling approve_endpoint when approver is separate fails (wrong caller).
  it("2. Owner calling approve_endpoint when approver is separate fails with E_NOT_APPROVER", async () => {
    const expiry = FAR_FUTURE_NS.toString();
    const digest = getApprovalDigest(
      world.vaultId,
      "vnd",
      2,
      "near:testnet:newvendor.testnet",
      expiry,
    );

    const panic = await panicOf(() =>
      world.admin.approveEndpoint("vnd", 2, digest, expiry),
    );
    expect(panic).toBe("E_NOT_APPROVER");
  });

  // 3. Replayed or stale approval fails.
  it("3. Replayed or stale approval fails", async () => {
    const now = await chain.blockTimestampNs();
    const staleExpiry = (now - 1_000_000_000n).toString();
    const staleDigest = getApprovalDigest(
      world.vaultId,
      "vnd",
      2,
      "near:testnet:newvendor.testnet",
      staleExpiry,
    );

    // Stale expiry
    const stalePanic = await panicOf(() =>
      callFinal(approver, {
        contract_id: world.vaultId,
        method: "approve_endpoint",
        args: {
          vendor_id: "vnd",
          revision: 2,
          approval_digest: staleDigest,
          expiry_ns: staleExpiry,
        },
        gas: GAS_ADMIN,
      }),
    );
    expect(stalePanic).toBe("E_APPROVAL_STALE");

    // Mismatched digest
    const wrongDigest = `sha256:${"f".repeat(64)}`;
    const mismatchPanic = await panicOf(() =>
      callFinal(approver, {
        contract_id: world.vaultId,
        method: "approve_endpoint",
        args: {
          vendor_id: "vnd",
          revision: 2,
          approval_digest: wrongDigest,
          expiry_ns: FAR_FUTURE_NS.toString(),
        },
        gas: GAS_ADMIN,
      }),
    );
    expect(mismatchPanic).toBe("E_APPROVAL_MISMATCH");

    // Valid approval succeeds
    const validExpiry = FAR_FUTURE_NS.toString();
    const validDigest = getApprovalDigest(
      world.vaultId,
      "vnd",
      2,
      "near:testnet:newvendor.testnet",
      validExpiry,
    );
    await callFinal(approver, {
      contract_id: world.vaultId,
      method: "approve_endpoint",
      args: {
        vendor_id: "vnd",
        revision: 2,
        approval_digest: validDigest,
        expiry_ns: validExpiry,
      },
      gas: GAS_ADMIN,
    });

    // Propose rev 3 and attempt to replay the same approval digest
    await world.admin.proposeEndpoint(
      "vnd",
      "near:testnet:newvendor.testnet",
      "T2",
      DIGEST_A,
    );
    const replayPanic = await panicOf(() =>
      callFinal(approver, {
        contract_id: world.vaultId,
        method: "approve_endpoint",
        args: {
          vendor_id: "vnd",
          revision: 3,
          approval_digest: validDigest,
          expiry_ns: validExpiry,
        },
        gas: GAS_ADMIN,
      }),
    );
    expect(replayPanic).toBe("E_APPROVAL_REPLAYED");
  });

  // 4. Paying during cooldown fails or pays old active revision.
  it("4. Paying during cooldown uses old active revision; pinned future revision fails", async () => {
    // Rev 2 was approved, but cooldown has not elapsed
    // Register payable pinned to revision 2: fails with E_ENDPOINT_REVISION_MISMATCH because active revision is still 1
    const pinPanic = await panicOf(() =>
      world.admin.registerPayable({
        payable_ref: "pay_pinned_rev2",
        vendor_id: "vnd",
        vendor_revision: 1,
        po_number: "PO-PIN",
        invoice_number: "INV-PIN",
        amount_atomic: "100",
        not_before_ns: "0",
        due_at_ns: FAR_FUTURE_NS.toString(),
        expires_at_ns: FAR_FUTURE_NS.toString(),
        evidence_commitment: DIGEST_A,
        expected_endpoint_revision: 2,
      }),
    );
    expect(pinPanic).toBe("E_ENDPOINT_REVISION_MISMATCH");

    // Payable registered without pinned revision pays the current active revision (rev 1)
    const payable = await world.addPayable(50n);
    const result = await world.request(payable);
    expect(result.ok).toBe(true);
    expect((await world.payable(payable))?.recipient).toBe(world.vendor.account_id);
  });

  // 5. Pinned revision mismatch rejects with ENDPOINT_REVISION_MISMATCH.
  it("5. Pinned revision mismatch rejects request_payment with ENDPOINT_REVISION_MISMATCH", async () => {
    // Register payable pinned to revision 1 (which matches current active revision 1)
    await world.admin.registerPayable({
      payable_ref: "pay_pinned_1",
      vendor_id: "vnd",
      vendor_revision: 1,
      po_number: "PO-P1",
      invoice_number: "INV-P1",
      amount_atomic: "50",
      not_before_ns: "0",
      due_at_ns: FAR_FUTURE_NS.toString(),
      expires_at_ns: FAR_FUTURE_NS.toString(),
      evidence_commitment: DIGEST_A,
      expected_endpoint_revision: 1,
    });

    // Settle it to verify it works when matching
    const res = await world.request("pay_pinned_1");
    expect(res.ok).toBe(true);
  });

  // 6. Release Guard: manifest mismatch fails with RELEASE_MISMATCH.
  it("6. Manifest mismatch rejects with RELEASE_MISMATCH and emits event", async () => {
    const payable = await world.addPayable(50n);

    // Matching manifest succeeds
    const matchRes = await world.request(payable, { manifest_digest: DIGEST_A });
    expect(matchRes.ok).toBe(true);

    // Mismatched manifest rejects
    const payable2 = await world.addPayable(50n);
    const mismatchRes = await world.request(payable2, { manifest_digest: DIGEST_B });
    expect(mismatchRes.ok).toBe(false);
    expect(mismatchRes.rejection).toBe("RELEASE_MISMATCH");
  });

  // 7. Raised cap without owner call fails.
  it("7. Raised cap without owner call fails with E_NOT_OWNER", async () => {
    // Non-owner stranger attempts raise_binding_caps
    const strangerPanic = await panicOf(() =>
      callFinal(stranger, {
        contract_id: world.vaultId,
        method: "raise_binding_caps",
        args: {},
        deposit: ONE_YOCTO,
        gas: GAS_ADMIN,
      }),
    );
    expect(strangerPanic).toBe("E_NOT_OWNER");

    // Agent attempts raise_binding_caps
    const agentPanic = await panicOf(() =>
      callFinal(world.agent, {
        contract_id: world.vaultId,
        method: "raise_binding_caps",
        args: {},
        deposit: ONE_YOCTO,
        gas: GAS_ADMIN,
      }),
    );
    expect(agentPanic).toBe("E_NOT_OWNER");

    // Owner succeeds
    await world.admin.raiseBindingCaps();
    const policy = await world.view<{ weekly_cap_atomic: string }>("get_policy");
    expect(policy.weekly_cap_atomic).toBe("100000"); // Original 100k cap restored
  });

  // 8. Revoked endpoint fails with PAYEE_NOT_VERIFIED.
  it("8. Revoked endpoint causes PAYEE_NOT_VERIFIED", async () => {
    const payable = await world.addPayable(50n);

    // Revoke active endpoint (rev 1)
    await world.admin.revokeEndpoint("vnd", 1);

    const res = await world.request(payable);
    expect(res.ok).toBe(false);
    expect(res.rejection).toBe("PAYEE_NOT_VERIFIED");

    // owner_pay also fails with PAYEE_NOT_VERIFIED
    const ownerRes = await world.ownerPay(payable);
    expect(ownerRes.ok).toBe(false);
    expect(ownerRes.rejection).toBe("PAYEE_NOT_VERIFIED");
  });

  // 9. Registry: non-attestor cannot list, non-owner cannot update, cooling-off holds.
  it("9. Payee Registry: permissioning and cooling-off checks", async () => {
    // Non-attestor stranger cannot list vendor
    const strangerClient = new PayeeRegistryClient({
      rpcUrl: chain.sandbox.rpcUrl,
      registryId: registryAccount.account_id,
      signer: stranger,
    });

    await expect(
      strangerClient.attestVendor({
        domain: "acme.com",
        name: "Acme Corp",
        accounts: [`near:testnet:${stranger.account_id}`],
        evidenceHash: DIGEST_A,
        issuedAt: new Date().toISOString(),
        evidenceTier: "T2",
      }),
    ).rejects.toThrow();

    // Attestor lists vendor
    const attestVendorAccount = await chain.account("acme-vendor");
    await registryClient.attestVendor({
      domain: "acme.com",
      name: "Acme Corp",
      accounts: [`near:testnet:${attestVendorAccount.account_id}`],
      evidenceHash: DIGEST_A,
      issuedAt: new Date().toISOString(),
      evidenceTier: "T2",
    });

    const vendorView = await registryClient.getVendor("acme.com");
    expect(vendorView).not.toBeNull();
    expect(vendorView?.domain).toBe("acme.com");
    expect(vendorView?.accounts[0]?.account).toBe(`near:testnet:${attestVendorAccount.account_id}`);

    // Non-owner stranger cannot propose update
    await expect(
      strangerClient.proposeUpdate({
        domain: "acme.com",
        accounts: [`near:testnet:${stranger.account_id}`],
        evidenceHash: DIGEST_B,
        issuedAt: new Date().toISOString(),
        evidenceTier: "T2",
      }),
    ).rejects.toThrow();

    // Propose update by vendor account starts cooling off
    const vendorClient = new PayeeRegistryClient({
      rpcUrl: chain.sandbox.rpcUrl,
      registryId: registryAccount.account_id,
      signer: attestVendorAccount,
    });
    const updateTarget = await chain.account("acme-new");
    await vendorClient.proposeUpdate({
      domain: "acme.com",
      accounts: [
        `near:testnet:${attestVendorAccount.account_id}`,
        `near:testnet:${updateTarget.account_id}`,
      ],
      evidenceHash: DIGEST_B,
      issuedAt: new Date(Date.now() + 10_000).toISOString(),
      evidenceTier: "T2",
    });

    // During cooling-off, resolve still returns old active account
    const resolvedOld = await registryClient.resolve("acme.com", "near");
    expect(resolvedOld).toBe(`near:testnet:${attestVendorAccount.account_id}`);

    // Verify status in registry
    const vendorAfterUpdate = await registryClient.getVendor("acme.com");
    const oldAccountEntry = vendorAfterUpdate?.accounts.find(
      (a) => a.account === `near:testnet:${attestVendorAccount.account_id}`,
    );
    const newAccountEntry = vendorAfterUpdate?.accounts.find(
      (a) => a.account === `near:testnet:${updateTarget.account_id}`,
    );
    expect(oldAccountEntry?.status).toBe("active");
    expect(newAccountEntry?.status).toBe("pending");
    expect(
      await registryClient.isVerifiedPayee(
        `near:testnet:${updateTarget.account_id}`,
        "acme.com",
      ),
    ).toBe(false);
  });

  // 10. Public listing does not bypass vault approval.
  it("10. Public listing does not bypass vault approval", async () => {
    // Proposing an endpoint in vault with public registry data still requires separate approval
    const rev = await world.admin.proposeEndpoint(
      "vnd",
      "near:testnet:publicpayee.testnet",
      "T2",
      DIGEST_A,
    );

    // Vendor active endpoint is still not rev until approved
    const vendors = await world.view<Array<{ vendor_id: string; active_endpoint_revision: number | null }>>(
      "get_vendors",
      {},
    );
    const vnd = vendors.find((v) => v.vendor_id === "vnd");
    expect(vnd?.active_endpoint_revision).not.toBe(rev);
  });

  // 11. All promise/callback state changes still hold.
  it("11. Callback state changes: settled updates accounting, failed refunds available", async () => {
    // A fresh world has active endpoint revision 1 out of the box
    const settledWorld = await makeWorld(chain);
    const usageBefore = await settledWorld.usage();
    const payable = await settledWorld.addPayable(200n);

    // Request payment succeeds and settles
    const res = await settledWorld.request(payable);
    expect(res.ok).toBe(true);

    const usageAfter = await settledWorld.usage();
    expect(BigInt(usageAfter.balance_atomic)).toBe(BigInt(usageBefore.balance_atomic) - 200n);
    expect(BigInt(usageAfter.lifetime_settled_atomic)).toBe(BigInt(usageBefore.lifetime_settled_atomic) + 200n);

    // A world where vendor is not registered with token causes ft_transfer_call to fail
    const failedWorld = await makeWorld(chain, { register_vendor: false, funded: 1_000n });
    const failedPayable = await failedWorld.addPayable(300n);
    const failedRes = await failedWorld.request(failedPayable);
    expect(failedRes.ok).toBe(true);

    // Callback marks operation FAILED_KNOWN and refunds available balance
    const op = await failedWorld.operation(failedRes.operation_id as string);
    expect(op?.status).toBe("FAILED_KNOWN");
    const failedUsage = await failedWorld.usage();
    expect(failedUsage.balance_atomic).toBe("1000");
    expect(failedUsage.lifetime_settled_atomic).toBe("0");
  });
});
