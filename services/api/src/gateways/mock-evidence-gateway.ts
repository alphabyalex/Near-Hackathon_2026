import type { EvaluationReport, EvidenceGateway, ReportVerification } from "@wardline/schemas";

/** Serves example reports. It does not check anything on chain, so on_chain_digest is always null. */
export class MockEvidenceGateway implements EvidenceGateway {
  constructor(private readonly reports: EvaluationReport[]) {}

  async getReports(): Promise<EvaluationReport[]> {
    return this.reports;
  }

  async getReport(runId: string): Promise<EvaluationReport | null> {
    return this.reports.find((r) => r.run_id === runId) ?? null;
  }

  async verifyReport(runId: string): Promise<ReportVerification> {
    const report = await this.getReport(runId);
    if (!report) throw new Error(`unknown report ${runId}`);
    return { run_id: runId, matches: false, computed_digest: report.suite_commitment, on_chain_digest: null };
  }
}
