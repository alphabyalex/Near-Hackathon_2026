import type { Provider } from "near-api-js";
import { configFromEnv, type VaultClientConfig } from "./config.js";
import { callFinal, makeProvider, makeSigner, viewCall, type SignerHandle } from "./transport.js";

export type ExecutionStatus = "REGISTERED" | "COMPLETED" | "PARTIAL" | "FAILED";
export type AssessmentOutcome = "MET_THRESHOLDS" | "BELOW_THRESHOLDS" | "NOT_ASSESSED";

export interface SuiteMetadata {
  name: string;
  version: string;
  case_count: number;
}

export interface SuiteView {
  commitment: string;
  metadata: SuiteMetadata;
  issuer: string;
  committed_at_ns: string;
}

export interface RunView {
  run_id: string;
  manifest_digest: string;
  suite_commitment: string;
  issuer: string;
  registered_at_ns: string;
  execution_status: ExecutionStatus;
  assessment_outcome: AssessmentOutcome | null;
  report_digest: string | null;
  finished_at_ns: string | null;
}

export interface ReportVerificationResult {
  run_id: string;
  matches: boolean;
  computed_digest: string;
  on_chain_digest: string | null;
}

export interface PublishRunParams {
  run_id: string;
  suite_commitment: string;
  manifest_digest: string;
  report_digest: string;
  execution_status?: ExecutionStatus;
  assessment_outcome?: AssessmentOutcome;
}

/**
 * Client for Redline's evidence registry contract (contracts/evidence).
 *
 * Provides read-only views accessible to anyone, plus transaction methods
 * for designated issuers to commit suites, register runs, and publish digests.
 */
export class NearEvidenceClient {
  constructor(
    readonly provider: Provider,
    readonly contractId: string,
    readonly issuer?: SignerHandle,
  ) {}

  static fromConfig(
    config: VaultClientConfig,
    contractId?: string,
    issuerAccount?: { account_id: string; private_key: string },
  ): NearEvidenceClient {
    const provider = makeProvider(config.rpc_url);
    const cid =
      contractId ?? (config.network === "testnet" ? "evidence.redline-labs.testnet" : "evidence.sandbox");
    const signer = issuerAccount
      ? makeSigner(provider, issuerAccount.account_id, issuerAccount.private_key)
      : undefined;
    return new NearEvidenceClient(provider, cid, signer);
  }

  static fromEnv(
    contractId?: string,
    issuerAccount?: { account_id: string; private_key: string },
  ): NearEvidenceClient {
    return NearEvidenceClient.fromConfig(configFromEnv(), contractId, issuerAccount);
  }

  // Views (Read-only, anyone can call)

  async getSuite(commitment: string): Promise<SuiteView | null> {
    return viewCall<SuiteView | null>(this.provider, this.contractId, "get_suite", { commitment });
  }

  async getRun(runId: string): Promise<RunView | null> {
    return viewCall<RunView | null>(this.provider, this.contractId, "get_run", { run_id: runId });
  }

  async getRuns(fromIndex?: number, limit?: number): Promise<RunView[]> {
    return viewCall<RunView[]>(this.provider, this.contractId, "get_runs", {
      from_index: fromIndex,
      limit,
    });
  }

  async getIssuers(): Promise<string[]> {
    return viewCall<string[]>(this.provider, this.contractId, "get_issuers", {});
  }

  async getReportDigest(runId: string): Promise<string | null> {
    const run = await this.getRun(runId);
    return run?.report_digest ?? null;
  }

  async verifyReport(runId: string, computedReportDigest: string): Promise<ReportVerificationResult> {
    const onChainDigest = await this.getReportDigest(runId);
    return {
      run_id: runId,
      matches: onChainDigest !== null && onChainDigest === computedReportDigest,
      computed_digest: computedReportDigest,
      on_chain_digest: onChainDigest,
    };
  }

  // Mutations (Issuers sign transactions)

  async commitSuite(commitment: string, metadata: SuiteMetadata, signer?: SignerHandle): Promise<void> {
    const s = signer ?? this.requireIssuerSigner();
    await callFinal(s, {
      contract_id: this.contractId,
      method: "commit_suite",
      args: { commitment, metadata },
    });
  }

  async registerRun(
    runId: string,
    manifestDigest: string,
    suiteCommitment: string,
    signer?: SignerHandle,
  ): Promise<void> {
    const s = signer ?? this.requireIssuerSigner();
    await callFinal(s, {
      contract_id: this.contractId,
      method: "register_run",
      args: {
        run_id: runId,
        manifest_digest: manifestDigest,
        suite_commitment: suiteCommitment,
        issuer: s.account_id,
      },
    });
  }

  async publishResult(
    runId: string,
    reportDigest: string,
    executionStatus: ExecutionStatus = "COMPLETED",
    assessmentOutcome: AssessmentOutcome = "NOT_ASSESSED",
    signer?: SignerHandle,
  ): Promise<void> {
    const s = signer ?? this.requireIssuerSigner();
    await callFinal(s, {
      contract_id: this.contractId,
      method: "publish_result",
      args: {
        run_id: runId,
        report_digest: reportDigest,
        execution_status: executionStatus,
        assessment_outcome: assessmentOutcome,
      },
    });
  }

  /**
   * Convenience method executing register_run followed by publish_result in sequence.
   */
  async publishRun(params: PublishRunParams, signer?: SignerHandle): Promise<void> {
    const s = signer ?? this.requireIssuerSigner();
    await this.registerRun(params.run_id, params.manifest_digest, params.suite_commitment, s);
    await this.publishResult(
      params.run_id,
      params.report_digest,
      params.execution_status ?? "COMPLETED",
      params.assessment_outcome ?? "NOT_ASSESSED",
      s,
    );
  }

  async expireRun(runId: string, signer?: SignerHandle): Promise<void> {
    const s = signer ?? this.requireIssuerSigner();
    await callFinal(s, {
      contract_id: this.contractId,
      method: "expire_run",
      args: { run_id: runId },
    });
  }

  private requireIssuerSigner(): SignerHandle {
    if (!this.issuer) {
      throw new Error(`Evidence client on ${this.contractId} has no issuer signer configured for transactions`);
    }
    return this.issuer;
  }
}
