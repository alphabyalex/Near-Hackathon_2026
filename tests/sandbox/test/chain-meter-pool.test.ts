import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NearCoverPoolClient,
  NearMeterClient,
  NearModelRegistryClient,
  type SignerHandle,
} from "@wardline/vault-client";
import { Chain, wasm } from "../src/harness.js";

describe("on-chain meter, model registry, and cover pool sandbox tests", () => {
  let chain: Chain;
  let owner: SignerHandle;
  let stranger: SignerHandle;
  let tokenAccount: SignerHandle;
  let registryAccount: SignerHandle;
  let poolAccount: SignerHandle;
  let meterAccount: SignerHandle;

  let registryClient: NearModelRegistryClient;
  let poolClient: NearCoverPoolClient;
  let meterClient: NearMeterClient;

  // Real NEAR AI fixture: DeepSeek V4.1 Flash signed response
  const REAL_PROOF = {
    model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    request_hash: "ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c",
    response_hash: "2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9",
    text: "deepseek-ai/DeepSeek-V4.1-Flash-1017:ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c:2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9",
    signature:
      "0xa3486136dcb0e7592a5aacef44edb867648ed75ac98e8b3e4621468a68795dc564e006f5aa2d192530c6a87437e76c0a1ce45fdc8c8edd576c84bc94da717e641c",
    signing_address: "0xfe0071895500a9755c18044948ab4f4e1a7f337e",
    chat_id: "chatcmpl-96068d70-a320-4475-a330-400be955d887",
  };

  beforeAll(async () => {
    chain = await Chain.start();
    owner = await chain.account("dao-owner");
    stranger = await chain.account("stranger");
    tokenAccount = await chain.account("mock-usdc");
    registryAccount = await chain.account("model-reg");
    poolAccount = await chain.account("cover-pool");
    meterAccount = await chain.account("ai-meter");

    // 1. Deploy Model Registry
    await chain.deploy(registryAccount, wasm("model-registry"), {
      method: "new",
      args: { owner: owner.account_id },
    });
    registryClient = new NearModelRegistryClient({
      contractId: registryAccount.account_id,
      provider: chain.provider,
      signer: owner,
    });

    // 2. Deploy Cover Pool
    await chain.deploy(poolAccount, wasm("cover-pool"), {
      method: "new",
      args: {
        owner: owner.account_id,
        token_contract: tokenAccount.account_id,
        junior_holder: owner.account_id,
        junior: "5000000",
        withdraw_delay_days: 7,
        large_claim_threshold: "1000000",
        max_claim_bps: 1000,
      },
    });
    poolClient = new NearCoverPoolClient({
      contractId: poolAccount.account_id,
      provider: chain.provider,
      signer: owner,
    });

    // 3. Deploy Meter
    await chain.deploy(meterAccount, wasm("meter"), {
      method: "new",
      args: {
        owner: owner.account_id,
        token_contract: tokenAccount.account_id,
        registry_contract: registryAccount.account_id,
        pool_contract: poolAccount.account_id,
        cover_fee_bps: 200,
      },
    });
    meterClient = new NearMeterClient({
      contractId: meterAccount.account_id,
      provider: chain.provider,
      signer: owner,
    });
  });

  afterAll(async () => {
    await chain.stop();
  });

  describe("Model Registry contract", () => {
    it("1. Verifies attested models seeded on init", async () => {
      const isDeepSeekAttested = await registryClient.isAttested(
        "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "0xfe0071895500a9755c18044948ab4f4e1a7f337e",
      );
      expect(isDeepSeekAttested).toBe(true);

      // Case-insensitivity verification
      const isMixedCaseAttested = await registryClient.isAttested(
        "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "0xFE0071895500A9755C18044948AB4F4E1A7F337E",
      );
      expect(isMixedCaseAttested).toBe(true);

      // Non-attested address returns false
      const isFakeAttested = await registryClient.isAttested(
        "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "0x1111111111111111111111111111111111111111",
      );
      expect(isFakeAttested).toBe(false);

      // Unknown model returns false
      const isUnknownAttested = await registryClient.isAttested(
        "unknown/model-xyz",
        "0xfe0071895500a9755c18044948ab4f4e1a7f337e",
      );
      expect(isUnknownAttested).toBe(false);
    });

    it("2. Lists models and allows owner to add new attested model", async () => {
      const initialModels = await registryClient.listModels();
      expect(initialModels.length).toBeGreaterThanOrEqual(3);

      await registryClient.addModel(
        "llama-3-sonar-large",
        "0x2222222222222222222222222222222222222222",
        "ecdsa",
        "NEAR AI Sonar attestation report",
        owner,
      );

      const isSonarAttested = await registryClient.isAttested(
        "llama-3-sonar-large",
        "0x2222222222222222222222222222222222222222",
      );
      expect(isSonarAttested).toBe(true);
    });

    it("3. Permissioning: stranger cannot add provider or model", async () => {
      await expect(
        registryClient.addProvider(
          "malicious-provider",
          stranger.account_id,
          ["deepseek-ai/DeepSeek-V4.1-Flash-1017"],
          stranger,
        ),
      ).rejects.toThrow();

      await expect(
        registryClient.addModel(
          "malicious-model",
          "0x3333333333333333333333333333333333333333",
          "ecdsa",
          "Unverified report",
          stranger,
        ),
      ).rejects.toThrow();
    });
  });

  describe("Cover Pool contract (Wardline Mutual)", () => {
    it("1. Reads initial pool state with junior first-loss capital", async () => {
      const pool = await poolClient.getPool();
      expect(pool.junior).toBe("5000000");
      expect(pool.senior).toBe("0");
      expect(pool.tvl).toBe("5000000");
      expect(pool.share_price).toBe("1000000"); // 1.0 scaled
      expect(pool.withdraw_delay_days).toBe(7);
    });

    it("2. Senior LP deposits and receives shares", async () => {
      const lp = await chain.account("senior-lp");
      const depositRes = await poolClient.deposit(lp.account_id, "10000000", lp);
      expect(depositRes.shares).toBe("10000000");

      const pool = await poolClient.getPool();
      expect(pool.senior).toBe("10000000");
      expect(pool.tvl).toBe("15000000");

      const pos = await poolClient.getPosition(lp.account_id);
      expect(pos.shares).toBe("10000000");
      expect(pos.value).toBe("10000000");
    });

    it("3. Fees from meter calls increase senior share price", async () => {
      await poolClient.addFees("500000", owner);

      const pool = await poolClient.getPool();
      expect(pool.fees_earned).toBe("500000");
      expect(pool.senior).toBe("10500000");
      // 10,500,000 / 10,000,000 = 1.05 per share
      expect(pool.share_price).toBe("1050000");
    });

    it("4. Small claims are paid automatically from junior first-loss tranche", async () => {
      const claimant = await chain.account("claimant");
      const claim = await poolClient.fileClaim(
        {
          subject: "model-mismatch-event",
          claimant: claimant.account_id,
          amount: "1000000", // <= large_claim_threshold (1,000,000)
          reason: "Swapped model delivered, refund requested",
        },
        claimant,
      );

      expect(claim.status).toBe("paid");
      expect(claim.paid_from_junior).toBe("1000000");
      expect(claim.paid_from_senior).toBe("0");

      // Junior absorbed 100% of the loss
      const pool = await poolClient.getPool();
      expect(pool.junior).toBe("4000000");
      expect(pool.senior).toBe("10500000"); // Senior is completely untouched!
      expect(pool.claims_paid).toBe("1000000");
    });

    it("5. Large claims require DAO vote and approval", async () => {
      const claimant = await chain.account("large-claimant");
      const claim = await poolClient.fileClaim(
        {
          subject: "major-exploit-incident",
          claimant: claimant.account_id,
          amount: "1200000", // > large_claim_threshold (1,000,000)
          reason: "Major incident payout request",
        },
        claimant,
      );

      expect(claim.status).toBe("pending_vote");

      // Stranger cannot approve
      await expect(poolClient.approveClaim(claim.claim_id, stranger)).rejects.toThrow();

      // DAO owner approves
      await poolClient.approveClaim(claim.claim_id, owner);

      const claims = await poolClient.listClaims();
      const updated = claims.find((c) => c.claim_id === claim.claim_id);
      expect(updated?.status).toBe("paid");
    });

    it("6. Withdrawal queue enforces delayed settlement and bounds", async () => {
      const lp = await chain.account("queue-lp");
      await poolClient.deposit(lp.account_id, "2000000", lp);

      const withdrawReq = await poolClient.requestWithdraw(lp.account_id, "1000000", lp);
      expect(withdrawReq.id).toBeDefined();

      const pos = await poolClient.getPosition(lp.account_id);
      expect(pos.pending_withdrawals.length).toBe(1);
      expect(pos.pending_withdrawals[0]?.shares).toBe("1000000");

      // Requesting more than available unqueued shares fails
      await expect(
        poolClient.requestWithdraw(lp.account_id, "2000000", lp),
      ).rejects.toThrow();
    });
  });

  describe("Pay-on-Proof Meter contract", () => {
    it("1. Creates an AI budget with member allowances", async () => {
      await meterClient.createBudget(
        {
          budget_id: "bgt_marketing",
          name: "Marketing AI Budget",
          owner: owner.account_id,
          deposit: "50000000",
          period: "week",
          members: [
            { member: owner.account_id, allowance: "10000000" },
            { member: stranger.account_id, allowance: "2000000" },
          ],
        },
        owner,
      );

      const budget = await meterClient.getBudget("bgt_marketing");
      expect(budget).not.toBeNull();
      expect(budget?.deposit).toBe("50000000");
      expect(budget?.spent).toBe("0");
      expect(budget?.reserved).toBe("0");
      expect(budget?.members.length).toBe(2);
    });

    it("2. Reserves amount against budget and member allowance", async () => {
      const res = await meterClient.reserve({
        budget_id: "bgt_marketing",
        member: owner.account_id,
        call_id: "call_deepseek_test_1",
        model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        max_amount: "1000",
        signer: owner,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.reserved).toBe("1000");
      }

      const budget = await meterClient.getBudget("bgt_marketing");
      expect(budget?.reserved).toBe("1000");
      expect(budget?.deposit).toBe("50000000");
      const unreserved =
        BigInt(budget?.deposit ?? "0") -
        BigInt(budget?.spent ?? "0") -
        BigInt(budget?.reserved ?? "0");
      expect(unreserved).toBe(49999000n);
    });

    it("3. Settles payment with genuine NEAR AI EIP-191 proof signature", async () => {
      const settleRes = await meterClient.settle({
        call_id: "call_deepseek_test_1",
        amount: "739",
        proof: REAL_PROOF,
        signer: owner,
      });

      expect(settleRes.ok).toBe(true);
      if (settleRes.ok) {
        expect(settleRes.amount).toBe("739");
        expect(settleRes.refund).toBe("261");
      }

      const budget = await meterClient.getBudget("bgt_marketing");
      expect(budget?.spent).toBe("739");
      expect(budget?.reserved).toBe("0");
      expect(budget?.deposit).toBe("50000000");
      const unreserved =
        BigInt(budget?.deposit ?? "0") - BigInt(budget?.spent ?? "0");
      expect(unreserved).toBe(49999261n);
    });

    it("4. Replay protection: reusing same chat_id is rejected on-chain", async () => {
      // Create a second reservation
      const reserveRes = await meterClient.reserve({
        budget_id: "bgt_marketing",
        member: owner.account_id,
        call_id: "call_deepseek_test_2",
        model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        max_amount: "1000",
        signer: owner,
      });
      expect(reserveRes.ok).toBe(true);

      // Attempt to settle with the identical proof and chat_id
      const replayRes = await meterClient.settle({
        call_id: "call_deepseek_test_2",
        amount: "739",
        proof: REAL_PROOF,
        signer: owner,
      });

      expect(replayRes.ok).toBe(false);
      if (!replayRes.ok) {
        expect(replayRes.reason).toBe("REPLAYED");
      }
    });

    it("5. Refusal on non-attested signer or mismatched proof", async () => {
      const reserveRes = await meterClient.reserve({
        budget_id: "bgt_marketing",
        member: owner.account_id,
        call_id: "call_deepseek_test_3",
        model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        max_amount: "1000",
        signer: owner,
      });
      expect(reserveRes.ok).toBe(true);

      // Tampered proof: wrong text
      const tamperedProof = {
        ...REAL_PROOF,
        text: "tampered:text:content",
        chat_id: "chatcmpl-unique-tampered-123",
      };

      const settleRes = await meterClient.settle({
        call_id: "call_deepseek_test_3",
        amount: "500",
        proof: tamperedProof,
        signer: owner,
      });

      expect(settleRes.ok).toBe(false);
      if (!settleRes.ok) {
        expect(settleRes.reason).toBe("PROOF_REJECTED");
      }
    });

    it("6. Releasing an unspent reservation refunds budget deposit", async () => {
      const reserveRes = await meterClient.reserve({
        budget_id: "bgt_marketing",
        member: owner.account_id,
        call_id: "call_to_release",
        model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        max_amount: "5000",
        signer: owner,
      });
      expect(reserveRes.ok).toBe(true);

      const beforeRelease = await meterClient.getBudget("bgt_marketing");
      // 1000 from test 4 + 1000 from test 5 + 5000 from test 6 = 7000
      expect(beforeRelease?.reserved).toBe("7000");

      const releaseRes = await meterClient.release(
        { call_id: "call_to_release", reason: "AI call timed out" },
        owner,
      );

      expect(releaseRes.refund).toBe("5000");

      const afterRelease = await meterClient.getBudget("bgt_marketing");
      expect(afterRelease?.reserved).toBe("2000");
    });

    it("7. Hard caps: member allowance exhaustion rejects reservation", async () => {
      // Stranger only has 2,000 allowance
      const reserveRes = await meterClient.reserve({
        budget_id: "bgt_marketing",
        member: stranger.account_id,
        call_id: "call_over_limit",
        model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        max_amount: "5000000", // Exceeds 2,000 allowance
        signer: stranger,
      });

      expect(reserveRes.ok).toBe(false);
      if (!reserveRes.ok) {
        expect(reserveRes.reason).toBe("ALLOWANCE_EXHAUSTED");
      }
    });
  });
});
