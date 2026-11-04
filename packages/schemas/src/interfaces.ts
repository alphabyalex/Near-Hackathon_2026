import type { AgentBinding } from "./agent-binding.js";
import type { AgentContext } from "./agent-context.js";
import type { Decision } from "./decision.js";
import type { EvaluationReport } from "./evaluation-report.js";
import type { Intake } from "./intake.js";
import type { Operation } from "./operation.js";
import type { Payable } from "./payable.js";
import type { PaymentRequest } from "./payment-request.js";
import type { Policy } from "./policy.js";
import type { ReportVerification } from "./report-verification.js";
import type { RequestResult } from "./request-result.js";
import type { VaultUsage } from "./vault-usage.js";

/** Implemented by Kristian (services/agent). */
export interface AgentRunner {
  decide(intake: Intake, ctx: AgentContext): Promise<Decision>;
}

/** Current on-chain revisions the adapter pins into a PaymentRequest. */
export interface ExpectedRevisions {
  policy_revision: number;
  binding_revision: number;
}

/** Implemented by Kristian: the decision-to-request adapter. Throws if the decision is not a payable PAY. */
export interface DecisionAdapter {
  toPaymentRequest(decision: Decision, ctx: AgentContext, revisions: ExpectedRevisions): Promise<PaymentRequest>;
}

/**
 * Implemented by Tharun (packages/vault-client). Every method names its vault because
 * there is one vault per business. Rejections are returned as data, not thrown; a throw
 * from requestPayment or ownerPay means the outcome is unknown.
 */
export interface VaultGateway {
  requestPayment(vaultId: string, request: PaymentRequest): Promise<RequestResult>;
  ownerPay(vaultId: string, payableRef: string): Promise<RequestResult>;
  getPayable(vaultId: string, payableRef: string): Promise<Payable | null>;
  getOperation(vaultId: string, operationId: string): Promise<Operation | null>;
  getUsage(vaultId: string): Promise<VaultUsage>;
  getPolicy(vaultId: string): Promise<Policy>;
  getBinding(vaultId: string): Promise<AgentBinding | null>;
  pause(vaultId: string): Promise<void>;
  revokeAgent(vaultId: string, agentAccountId: string): Promise<void>;
}

/** Implemented by Lucy (services/evaluator) against Tharun's evidence contract. */
export interface EvidenceGateway {
  getReports(): Promise<EvaluationReport[]>;
  getReport(runId: string): Promise<EvaluationReport | null>;
  verifyReport(runId: string): Promise<ReportVerification>;
}
