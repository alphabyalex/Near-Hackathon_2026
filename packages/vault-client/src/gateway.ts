import {
  AgentBindingSchema,
  OperationSchema,
  PayableSchema,
  PaymentRequestSchema,
  PolicySchema,
  RequestResultSchema,
  VaultUsageSchema,
  VendorSchema,
  type AgentBinding,
  type Operation,
  type Payable,
  type PaymentRequest,
  type Policy,
  type RequestResult,
  type VaultGateway,
  type VaultUsage,
  type Vendor,
} from "@wardline/schemas";
import { z } from "zod";
import { VaultAdmin } from "./admin.js";
import { configFromEnv, type SignerConfig, type VaultClientConfig } from "./config.js";
import { MissingSignerError, VaultExecutionError } from "./errors.js";
import { NearEvidenceClient } from "./evidence.js";
import { GAS_ADMIN, GAS_PAYMENT, ONE_YOCTO, callFinal, makeProvider, makeSigner, viewCall, type FinalOutcome, type SignerHandle } from "./transport.js";
import type { Provider } from "near-api-js";

export type OperationWithOrigin = Operation & { origin?: "AGENT" | "OWNER"; request_digest?: string | null };

/**
 * The real `VaultGateway`, against sandbox or testnet. Rejections come back as data. A throw from
 * `requestPayment` or `ownerPay` means the outcome is unknown, so read the payable before acting.
 *
 * `ok: true` means the vault accepted the request and the operation exists, not that money moved. A
 * transfer can still fail: read `getOperation` for SETTLED, FAILED_KNOWN or OUTCOME_UNCERTAIN.
 */
export class NearVaultGateway implements VaultGateway {
  readonly provider: Provider;
  private readonly signers = new Map<string, SignerHandle>();
  /** `get_operation` cannot know a transaction hash on chain, so this fills it in when it is known. */
  private readonly txHashes = new Map<string, string>();

  constructor(private readonly config: VaultClientConfig) {
    this.provider = makeProvider(config.rpc_url);
  }

  static fromEnv(env?: Record<string, string | undefined>): NearVaultGateway {
    return new NearVaultGateway(configFromEnv(env));
  }

  async requestPayment(vaultId: string, request: PaymentRequest): Promise<RequestResult> {
    const parsed = PaymentRequestSchema.parse(request);
    const outcome = await this.send(vaultId, "agent", "request_payment", parsed, 0n, GAS_PAYMENT);
    return this.toRequestResult(vaultId, outcome);
  }

  async ownerPay(vaultId: string, payableRef: string): Promise<RequestResult> {
    const outcome = await this.send(vaultId, "owner", "owner_pay", { payable_ref: payableRef }, ONE_YOCTO, GAS_PAYMENT);
    return this.toRequestResult(vaultId, outcome);
  }

  async pause(vaultId: string): Promise<void> {
    const role = this.config.signers[vaultId]?.owner ? "owner" : "guardian";
    await this.send(vaultId, role, "pause", {}, 0n, GAS_ADMIN);
  }

  async unpause(vaultId: string): Promise<void> {
    await this.send(vaultId, "owner", "unpause", {}, ONE_YOCTO, GAS_ADMIN);
  }

  admin(vaultId: string): VaultAdmin {
    const ownerSigner = this.signerFor(vaultId, "owner");
    return new VaultAdmin(ownerSigner, vaultId, {
      final_timeout_ms: this.config.final_timeout_ms,
      poll_interval_ms: this.config.poll_interval_ms,
    });
  }

  evidence(contractId?: string, issuerAccount?: { account_id: string; private_key: string }): NearEvidenceClient {
    return NearEvidenceClient.fromConfig(this.config, contractId, issuerAccount);
  }

  async revokeAgent(vaultId: string, agentAccountId: string): Promise<void> {
    await this.send(vaultId, "owner", "revoke_agent", { agent_account_id: agentAccountId }, 0n, GAS_ADMIN);
  }

  async getPayable(vaultId: string, payableRef: string): Promise<Payable | null> {
    const payable = await viewCall<unknown>(this.provider, vaultId, "get_payable", { payable_ref: payableRef });
    return payable === null ? null : PayableSchema.parse(payable);
  }

  async getPayables(vaultId: string, fromIndex = 0, limit = 100): Promise<Payable[]> {
    const payables = await viewCall<unknown[]>(this.provider, vaultId, "get_payables", { from_index: fromIndex, limit });
    return z.array(PayableSchema).parse(payables);
  }

  async getOperation(vaultId: string, operationId: string): Promise<Operation | null> {
    const operation = await viewCall<unknown>(this.provider, vaultId, "get_operation", { operation_id: operationId });
    if (operation === null) return null;
    const parsed = OperationSchema.parse(operation);
    return { ...parsed, tx_hash: this.txHashes.get(`${vaultId}/${operationId}`) ?? parsed.tx_hash };
  }

  async getUsage(vaultId: string): Promise<VaultUsage> {
    return VaultUsageSchema.parse(await viewCall(this.provider, vaultId, "get_usage"));
  }

  async getPolicy(vaultId: string): Promise<Policy> {
    return PolicySchema.parse(await viewCall(this.provider, vaultId, "get_policy"));
  }

  async getBinding(vaultId: string): Promise<AgentBinding | null> {
    const binding = await viewCall<unknown>(this.provider, vaultId, "get_binding");
    return binding === null ? null : AgentBindingSchema.parse(binding);
  }

  async getVendors(vaultId: string, fromIndex = 0, limit = 100): Promise<Vendor[]> {
    const vendors = await viewCall<unknown[]>(this.provider, vaultId, "get_vendors", { from_index: fromIndex, limit });
    return z.array(VendorSchema).parse(vendors);
  }

  private toRequestResult(vaultId: string, outcome: FinalOutcome): RequestResult {
    const parsed = RequestResultSchema.safeParse(outcome.value);
    if (!parsed.success) {
      throw new VaultExecutionError(`Transaction ${outcome.tx_hash} returned something that is not a RequestResult`, outcome.tx_hash, null, outcome.value);
    }
    if (parsed.data.operation_id) this.txHashes.set(`${vaultId}/${parsed.data.operation_id}`, outcome.tx_hash);
    return parsed.data;
  }

  private send(vaultId: string, role: "agent" | "owner" | "guardian", method: string, args: object, deposit: bigint, gas: bigint): Promise<FinalOutcome> {
    return callFinal(
      this.signerFor(vaultId, role),
      { contract_id: vaultId, method, args, deposit, gas },
      {
        final_timeout_ms: this.config.final_timeout_ms,
        poll_interval_ms: this.config.poll_interval_ms,
      },
    );
  }

  private signerFor(vaultId: string, role: "agent" | "owner" | "guardian"): SignerHandle {
    const cacheKey = `${vaultId}/${role}`;
    const cached = this.signers.get(cacheKey);
    if (cached) return cached;
    const config: SignerConfig | undefined = this.config.signers[vaultId]?.[role];
    if (!config) throw new MissingSignerError(vaultId, role);
    const signer = makeSigner(this.provider, config.account_id, config.private_key);
    this.signers.set(cacheKey, signer);
    return signer;
  }
}
