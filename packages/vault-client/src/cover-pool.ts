import type { Provider } from "near-api-js";
import {
  GAS_ADMIN,
  callFinal,
  makeProvider,
  viewCall,
  type SignerHandle,
  type TransportOptions,
} from "./transport.js";

export interface PoolView {
  tvl: string;
  junior: string;
  senior: string;
  junior_holder: string;
  share_price: string;
  senior_shares: string;
  fees_earned: string;
  claims_paid: string;
  coverage_capacity: string;
  withdraw_delay_days: number;
  large_claim_threshold: string;
}

export interface PoolPosition {
  account: string;
  shares: string;
  value: string;
  pending_withdrawals: {
    id: string;
    shares: string;
    value: string;
    requested_at: string;
    available_at: string;
  }[];
}

export interface ClaimView {
  claim_id: string;
  subject: string;
  claimant: string;
  amount: string;
  reason: string;
  status: "paid" | "pending_vote" | "rejected";
  paid_from_junior: string;
  paid_from_senior: string;
  filed_at: string;
  tx: string | null;
}

export interface CoverPoolClientConfig extends TransportOptions {
  contractId?: string | undefined;
  poolId?: string | undefined;
  rpcUrl?: string | undefined;
  provider?: Provider | undefined;
  signer?: SignerHandle | undefined;
}

export class NearCoverPoolClient {
  readonly mode = "near" as const;
  readonly contractId: string;
  readonly provider: Provider;
  private readonly signer?: SignerHandle | undefined;
  private readonly options: TransportOptions;

  constructor(
    contractIdOrConfig: string | CoverPoolClientConfig,
    providerOrUrl?: Provider | string,
    options: TransportOptions & { signer?: SignerHandle } = {},
  ) {
    if (typeof contractIdOrConfig === "object") {
      const cfg = contractIdOrConfig;
      this.contractId = cfg.contractId ?? cfg.poolId ?? "";
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

  async getPool(): Promise<PoolView> {
    return viewCall<PoolView>(this.provider, this.contractId, "get_pool", {});
  }

  async getPosition(account: string): Promise<PoolPosition> {
    return viewCall<PoolPosition>(
      this.provider,
      this.contractId,
      "get_position",
      { account },
    );
  }

  async deposit(
    account: string,
    amount: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string; shares: string }> {
    if (!signer) throw new Error("Signer required for deposit");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "deposit",
        args: {
          account,
          amount,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const val = outcome.value as { tx: string; shares: string };
    return {
      tx: val.tx ?? outcome.tx_hash,
      shares: val.shares?.toString() ?? "0",
    };
  }

  async requestWithdraw(
    account: string,
    shares: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string; id: string; available_at: string }> {
    if (!signer) throw new Error("Signer required for requestWithdraw");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "request_withdraw",
        args: {
          account,
          shares,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const val = outcome.value as { tx: string; id: string; available_at: string };
    return {
      tx: val.tx ?? outcome.tx_hash,
      id: val.id,
      available_at: val.available_at,
    };
  }

  async listClaims(): Promise<ClaimView[]> {
    try {
      const list = await viewCall<ClaimView[]>(
        this.provider,
        this.contractId,
        "list_claims",
        {},
      );
      return list.map((c) => ({
        ...c,
        status: (c.status === "paid" || c.status === "rejected" ? c.status : "pending_vote") as "paid" | "pending_vote" | "rejected",
      }));
    } catch {
      return [];
    }
  }

  async fileClaim(
    args: { subject: string; claimant: string; amount: string; reason: string },
    signer: SignerHandle | undefined = this.signer,
  ): Promise<ClaimView> {
    if (!signer) throw new Error("Signer required for fileClaim");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "file_claim",
        args: {
          subject: args.subject,
          claimant: args.claimant,
          amount: args.amount,
          reason: args.reason,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const val = outcome.value as ClaimView;
    return {
      ...val,
      status: (val.status === "paid" || val.status === "rejected" ? val.status : "pending_vote") as "paid" | "pending_vote" | "rejected",
    };
  }

  async approveClaim(
    claimId: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for approveClaim");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "approve_claim",
        args: { claim_id: claimId },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async setParam(
    name: string,
    value: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for setParam");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "set_param",
        args: { name, value },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async addFees(
    amount: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<void> {
    if (!signer) throw new Error("Signer required for addFees");
    await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "add_fees",
        args: { amount },
        gas: GAS_ADMIN,
      },
      this.options,
    );
  }
}
