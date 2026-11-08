import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NearEvidenceClient, callFinal, viewCall, type SignerHandle } from "@wardline/vault-client";
import { Chain, DIGEST_A, DIGEST_B, panicOf, wasm } from "../src/harness.js";

const REPORT = `sha256:${"c".repeat(64)}`;

interface Run {
  execution_status: string;
  assessment_outcome: string | null;
  report_digest: string | null;
  issuer: string;
}

describe("evidence registry", () => {
  let chain: Chain;
  let registry: SignerHandle;
  let issuer: SignerHandle;
  let other: SignerHandle;

  beforeAll(async () => {
    chain = await Chain.start();
    const owner = await chain.account("owner");
    issuer = await chain.account("issuer");
    other = await chain.account("other");
    registry = await chain.account("evidence");
    await chain.deploy(registry, wasm("evidence"), { method: "new", args: { owner: owner.account_id, issuers: [issuer.account_id] } });
    await callFinal(issuer, {
      contract_id: registry.account_id,
      method: "commit_suite",
      args: { commitment: DIGEST_A, metadata: { name: "assessment", version: "1", case_count: 20 } },
    });
  });
  afterAll(() => chain?.stop());

  const call = (signer: SignerHandle, method: string, args: object) => callFinal(signer, { contract_id: registry.account_id, method, args });
  const getRun = (run_id: string) => viewCall<Run | null>(chain.provider, registry.account_id, "get_run", { run_id });
  const register = (run_id: string) => call(issuer, "register_run", { run_id, manifest_digest: DIGEST_B, suite_commitment: DIGEST_A, issuer: issuer.account_id });

  it("a run goes from registered to a terminal state, with its issuer recorded", async () => {
    await register("run_ok");
    expect((await getRun("run_ok"))?.execution_status).toBe("REGISTERED");
    await call(issuer, "publish_result", { run_id: "run_ok", report_digest: REPORT, execution_status: "COMPLETED", assessment_outcome: "MET_THRESHOLDS" });
    const run = await getRun("run_ok");
    expect(run).toMatchObject({ execution_status: "COMPLETED", assessment_outcome: "MET_THRESHOLDS", report_digest: REPORT, issuer: issuer.account_id });
  });

  it("is append-only: a result, a suite and a run id cannot be overwritten", async () => {
    expect(await panicOf(() => call(issuer, "publish_result", { run_id: "run_ok", report_digest: DIGEST_A, execution_status: "FAILED", assessment_outcome: "NOT_ASSESSED" }))).toBe("E_RUN_FINISHED");
    expect(await panicOf(() => call(issuer, "commit_suite", { commitment: DIGEST_A, metadata: { name: "x", version: "2", case_count: 1 } }))).toBe("E_DUPLICATE_SUITE");
    expect(await panicOf(() => register("run_ok"))).toBe("E_DUPLICATE_RUN");
  });

  it("only listed issuers, in their own name, on a committed suite", async () => {
    expect(await panicOf(() => call(other, "commit_suite", { commitment: REPORT, metadata: { name: "x", version: "1", case_count: 1 } }))).toBe("E_NOT_ISSUER");
    expect(await panicOf(() => call(other, "register_run", { run_id: "r", manifest_digest: DIGEST_B, suite_commitment: DIGEST_A, issuer: issuer.account_id }))).toBe("E_NOT_ISSUER");
    expect(await panicOf(() => call(issuer, "register_run", { run_id: "r", manifest_digest: DIGEST_B, suite_commitment: DIGEST_A, issuer: other.account_id }))).toBe("E_ISSUER_MISMATCH");
    expect(await panicOf(() => call(issuer, "register_run", { run_id: "r", manifest_digest: DIGEST_B, suite_commitment: REPORT, issuer: issuer.account_id }))).toBe("E_UNKNOWN_SUITE");
  });

  it("nobody else can publish, and an incomplete run cannot claim an assessment", async () => {
    await register("run_partial");
    expect(await panicOf(() => call(other, "publish_result", { run_id: "run_partial", report_digest: REPORT, execution_status: "COMPLETED", assessment_outcome: "MET_THRESHOLDS" }))).toBe("E_NOT_RUN_ISSUER");
    expect(await panicOf(() => call(issuer, "publish_result", { run_id: "run_partial", report_digest: REPORT, execution_status: "PARTIAL", assessment_outcome: "MET_THRESHOLDS" }))).toBe("E_INVALID_INPUT");
    await call(issuer, "publish_result", { run_id: "run_partial", report_digest: REPORT, execution_status: "PARTIAL", assessment_outcome: "NOT_ASSESSED" });
    expect((await getRun("run_partial"))?.execution_status).toBe("PARTIAL");
  });

  it("a silent run cannot be closed before its deadline", async () => {
    await register("run_silent");
    expect(await panicOf(() => call(other, "expire_run", { run_id: "run_silent" }))).toBe("E_DEADLINE_NOT_REACHED");
    expect((await getRun("run_silent"))?.execution_status).toBe("REGISTERED");
  });

  it("NearEvidenceClient: verifies report digests and executes convenient publishRun", async () => {
    const client = new NearEvidenceClient(chain.provider, registry.account_id, issuer);

    // Test getSuite
    const suite = await client.getSuite(DIGEST_A);
    expect(suite?.metadata).toEqual({ name: "assessment", version: "1", case_count: 20 });
    expect(suite?.issuer).toBe(issuer.account_id);

    // Test verifyReport for run_ok
    const verificationOk = await client.verifyReport("run_ok", REPORT);
    expect(verificationOk.matches).toBe(true);
    expect(verificationOk.on_chain_digest).toBe(REPORT);

    const verificationBad = await client.verifyReport("run_ok", DIGEST_A);
    expect(verificationBad.matches).toBe(false);

    // Test publishRun convenience method
    await client.publishRun({
      run_id: "run_client_convenience",
      suite_commitment: DIGEST_A,
      manifest_digest: DIGEST_B,
      report_digest: REPORT,
      execution_status: "COMPLETED",
      assessment_outcome: "MET_THRESHOLDS",
    });

    const run = await client.getRun("run_client_convenience");
    expect(run).toMatchObject({
      run_id: "run_client_convenience",
      execution_status: "COMPLETED",
      assessment_outcome: "MET_THRESHOLDS",
      report_digest: REPORT,
      issuer: issuer.account_id,
    });

    const digest = await client.getReportDigest("run_client_convenience");
    expect(digest).toBe(REPORT);
  });
});
