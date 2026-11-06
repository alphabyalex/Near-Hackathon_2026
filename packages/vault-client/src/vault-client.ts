import type {
  OperationView,
  PayableView,
  PaymentRequest,
  PolicyView,
  RequestResult,
  SubmissionOutcome,
  UsageView,
  VaultTransport,
  VendorView,
} from "./types.js";

const DEFAULT_GAS = 100_000_000_000_000n;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class VaultClient {
  public constructor(
    private readonly transport: VaultTransport,
    public readonly contractId: string,
    private readonly gas: bigint = DEFAULT_GAS,
  ) {}

  public getPolicy(): Promise<PolicyView> {
    return this.transport.view({ contractId: this.contractId, methodName: "get_policy", args: {} });
  }

  public getUsage(): Promise<UsageView> {
    return this.transport.view({ contractId: this.contractId, methodName: "get_usage", args: {} });
  }

  public getPayable(payableRef: string): Promise<PayableView | null> {
    return this.transport.view({
      contractId: this.contractId,
      methodName: "get_payable",
      args: { payable_ref: payableRef },
    });
  }

  public getOperation(operationId: string): Promise<OperationView | null> {
    return this.transport.view({
      contractId: this.contractId,
      methodName: "get_operation",
      args: { operation_id: operationId },
    });
  }

  public getVendors(fromIndex = "0", limit = 100): Promise<readonly VendorView[]> {
    return this.transport.view({
      contractId: this.contractId,
      methodName: "get_vendors",
      args: { from_index: fromIndex, limit },
    });
  }

  public async requestPayment(request: PaymentRequest): Promise<SubmissionOutcome> {
    try {
      const result = await this.transport.call<RequestResult>({
        contractId: this.contractId,
        methodName: "request_payment",
        args: { request },
        gas: this.gas,
        deposit: 0n,
      });
      return { kind: "RESULT", result };
    } catch (error) {
      return this.reconcileObservation(request.payable_ref, error);
    }
  }

  private async reconcileObservation(payableRef: string, error: unknown): Promise<SubmissionOutcome> {
    let payable: PayableView | null = null;
    let operation: OperationView | null = null;
    try {
      payable = await this.getPayable(payableRef);
      if (payable?.operation_id != null) {
        operation = await this.getOperation(payable.operation_id);
      }
    } catch (reconciliationError) {
      return {
        kind: "OBSERVATION_AMBIGUOUS",
        payable: null,
        operation: null,
        cause: `${errorText(error)}; reconciliation failed: ${errorText(reconciliationError)}`,
        retry_allowed: false,
      };
    }
    return {
      kind: "OBSERVATION_AMBIGUOUS",
      payable,
      operation,
      cause: errorText(error),
      retry_allowed: false,
    };
  }
}
