import type { Provider } from "near-api-js";
import {
  GAS_ADMIN,
  GAS_PAYMENT,
  callFinal,
  makeProvider,
  viewCall,
  type SignerHandle,
  type TransportOptions,
} from "./transport.js";

export interface MemberView {
  member: string;
  allowance: string;
  used: string;
  reserved: string;
}

export interface ReputationView {
  budget_id: string;
  name: string;
  owner: string;
  tier: "bronze" | "silver" | "gold";
  proven_calls: number;
  refused_calls: number;
  claims: number;
  clean_calls: number;
  next_tier_at: number | null;
  fee_bps: number;
  coverage_cap: string;
  spent: string;
  fees_paid: string;
}

export interface BudgetView {
  budget_id: string;
  name: string;
  owner: string;
  deposit: string;
  spent: string;
  reserved: string;
  period: "day" | "week" | "month";
  period_start: string;
  members: MemberView[];
}

export interface SettlementProof {
  model_id: string;
  request_hash: string;
  response_hash: string;
  text: string;
  signature: string;
  signing_address: string;
  chat_id: string;
}

export type ReserveRefusal =
  | "UNKNOWN_BUDGET"
  | "UNKNOWN_MEMBER"
  | "ALLOWANCE_EXHAUSTED"
  | "BUDGET_EXHAUSTED"
  | "DUPLICATE_CALL";

export type ReserveResult =
  | { ok: true; reserved: string }
  | { ok: false; reason: ReserveRefusal; detail: string };

export type SettleResult =
  | { ok: true; tx: string; amount: string; refund: string }
  | {
      ok: false;
      reason:
        | "NO_RESERVATION"
        | "PROOF_REJECTED"
        | "REPLAYED"
        | "OVER_RESERVATION"
        | "TRANSFER_FAILED";
      detail: string;
    };

export interface MeterClientConfig extends TransportOptions {
  contractId?: string | undefined;
  meterId?: string | undefined;
  rpcUrl?: string | undefined;
  provider?: Provider | undefined;
  signer?: SignerHandle | undefined;
}

export class NearMeterClient {
  readonly mode = "near" as const;
  readonly contractId: string;
  readonly provider: Provider;
  private readonly signer?: SignerHandle | undefined;
  private readonly options: TransportOptions;

  constructor(
    contractIdOrConfig: string | MeterClientConfig,
    providerOrUrl?: Provider | string,
    options: TransportOptions & { signer?: SignerHandle } = {},
  ) {
    if (typeof contractIdOrConfig === "object") {
      const cfg = contractIdOrConfig;
      this.contractId = cfg.contractId ?? cfg.meterId ?? "";
      this.provider =
        cfg.provider ??
        (cfg.rpcUrl ? makeProvider(cfg.rpcUrl) : (null as unknown as Provider));
      this.signer = cfg.signer;
      this.options = cfg;
    } else {
      this.contractId = contractIdOrConfig;
      this.provider =
        typeof providerOrUrl === "string"
          ? makeProvider(providerOrUrl)
          : (providerOrUrl as Provider);
      this.signer = options.signer;
      this.options = options;
    }
  }

  async listBudgets(): Promise<BudgetView[]> {
    try {
      const list = await viewCall<BudgetView[]>(
        this.provider,
        this.contractId,
        "list_budgets",
        {},
      );
      return list.map((b) => ({
        ...b,
        period: (b.period === "day" || b.period === "month" ? b.period : "week") as "day" | "week" | "month",
      }));
    } catch {
      return [];
    }
  }

  async getBudget(budgetId: string): Promise<BudgetView | null> {
    try {
      const b = await viewCall<BudgetView | null>(
        this.provider,
        this.contractId,
        "get_budget",
        { budget_id: budgetId },
      );
      if (!b) return null;
      return {
        ...b,
        period: (b.period === "day" || b.period === "month" ? b.period : "week") as "day" | "week" | "month",
      };
    } catch {
      return null;
    }
  }

  async reserve(args: {
    budget_id: string;
    member: string;
    call_id: string;
    model_id: string;
    max_amount: string;
    signer?: SignerHandle;
  }): Promise<ReserveResult> {
    const signer = args.signer ?? this.signer;
    if (!signer) throw new Error("Signer required for reserve");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "reserve",
        args: {
          budget_id: args.budget_id,
          member: args.member,
          call_id: args.call_id,
          model_id: args.model_id,
          max_amount: args.max_amount,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const val = outcome.value as { ok: boolean; reserved?: string; reason?: ReserveRefusal; detail?: string };
    if (val.ok && val.reserved !== undefined) {
      return { ok: true, reserved: val.reserved };
    }
    return {
      ok: false,
      reason: val.reason ?? "BUDGET_EXHAUSTED",
      detail: val.detail ?? "Reservation failed",
    };
  }

  async settle(args: {
    call_id: string;
    amount: string;
    proof: SettlementProof;
    pay_to?: string;
    signer?: SignerHandle;
  }): Promise<SettleResult> {
    const signer = args.signer ?? this.signer;
    if (!signer) throw new Error("Signer required for settle");
    const callArgs: Record<string, unknown> = {
      call_id: args.call_id,
      amount: args.amount,
      proof: args.proof,
    };
    if (args.pay_to) {
      callArgs.pay_to = args.pay_to;
    }
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "settle",
        args: callArgs,
        gas: GAS_PAYMENT,
      },
      this.options,
    );
    const val = outcome.value as {
      ok: boolean;
      tx?: string;
      amount?: string;
      refund?: string;
      reason?: "NO_RESERVATION" | "PROOF_REJECTED" | "REPLAYED" | "OVER_RESERVATION" | "TRANSFER_FAILED";
      detail?: string;
    };
    if (val.ok && val.amount !== undefined && val.refund !== undefined) {
      return {
        ok: true,
        tx: val.tx ?? outcome.tx_hash,
        amount: val.amount,
        refund: val.refund,
      };
    }
    return {
      ok: false,
      reason: val.reason ?? "PROOF_REJECTED",
      detail: val.detail ?? "Settlement failed",
    };
  }

  async release(
    args: { call_id: string; reason: string },
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string; refund: string }> {
    if (!signer) throw new Error("Signer required for release");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "release",
        args: {
          call_id: args.call_id,
          reason: args.reason,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const val = outcome.value as { tx: string; refund: string };
    return {
      tx: val.tx ?? outcome.tx_hash,
      refund: val.refund?.toString() ?? "0",
    };
  }

  async createBudget(
    args: {
      budget_id: string;
      name: string;
      owner: string;
      deposit: string;
      period: string;
      members: Array<{ member: string; allowance: string }>;
    },
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for createBudget");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "create_budget",
        args,
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async fund(
    budgetId: string,
    amount: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for fund");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "fund",
        args: {
          budget_id: budgetId,
          amount,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async setAllowance(
    budgetId: string,
    member: string,
    allowance: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for setAllowance");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "set_allowance",
        args: {
          budget_id: budgetId,
          member,
          allowance,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async updateAttestedModel(
    args: { model_id: string; signing_address: string },
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for updateAttestedModel");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "update_attested_model",
        args: {
          model_id: args.model_id,
          signing_address: args.signing_address,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async getReputation(budgetId: string): Promise<ReputationView | null> {
    try {
      return await viewCall<ReputationView>(
        this.provider,
        this.contractId,
        "get_reputation",
        { budget_id: budgetId },
      );
    } catch {
      return null;
    }
  }

  async listReputations(): Promise<ReputationView[]> {
    try {
      return await viewCall<ReputationView[]>(
        this.provider,
        this.contractId,
        "list_reputations",
        {},
      );
    } catch {
      return [];
    }
  }

  async recordClaim(
    budgetId: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for recordClaim");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "record_claim",
        args: { budget_id: budgetId },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }
}
