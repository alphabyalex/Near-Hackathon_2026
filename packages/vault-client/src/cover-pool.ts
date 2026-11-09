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

function toIso(nsOrIso: string): string {
  if (!nsOrIso) return "";
  if (nsOrIso.endsWith("Z") || nsOrIso.includes("-")) return nsOrIso;
  const digits = nsOrIso.replace(/[^0-9]/g, "");
  if (!digits) return nsOrIso;
  const ns = BigInt(digits);
  return new Date(Number(ns / 1_000_000n)).toISOString();
}

export interface WardPricePoint {
  at: string;
  price: string;
  event: "launch" | "deposit" | "fees" | "claim" | "redeem";
}

export interface PoolView {
  tvl: string;
  junior: string;
  senior: string;
  junior_holder: string;
  ward_symbol: string;
  ward_name: string;
  ward_supply: string;
  ward_price: string;
  launch_price: string;
  price_history: WardPricePoint[];
  fees_earned: string;
  claims_paid: string;
  coverage_capacity: string;
  withdraw_delay_days: number;
  large_claim_threshold: string;
  trade_url: string | null;
  share_price?: string;
  senior_shares?: string;
}

export interface PendingRedemption {
  id: string;
  ward: string;
  shares?: string;
  value: string;
  requested_at: string;
  available_at: string;
}

export type MutualAction =
  | { type: "set_fee_bps"; tier: "bronze" | "silver" | "gold"; fee_bps: number }
  | { type: "set_coverage_multiplier"; multiplier_bps: number }
  | { type: "cover_model"; model_id: string; signing_address: string }
  | { type: "uncover_model"; model_id: string }
  | { type: "approve_payout"; claim_id: string };

export type MutualProposalStatus = "open" | "passed" | "rejected" | "executed";

export interface MutualProposalView {
  id: number;
  proposer: string;
  description: string;
  action: MutualAction;
  snapshot_at: string;
  snapshot_supply: string;
  votes_for: string;
  votes_against: string;
  voters: number;
  quorum: string;
  opens_at: string;
  closes_at: string;
  status: MutualProposalStatus;
  executed_at: string | null;
  tx: string | null;
}

export interface GovernanceParams {
  quorum_bps: number;
  voting_days: number;
}

export interface PoolPosition {
  account: string;
  ward: string;
  shares?: string;
  ward_locked: string;
  value: string;
  pending_withdrawals: PendingRedemption[];
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
  ward_price_before: string;
  ward_price_after: string;
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
    const raw = await viewCall<any>(this.provider, this.contractId, "get_pool", {});
    return {
      tvl: raw.tvl,
      junior: raw.junior,
      senior: raw.senior,
      junior_holder: raw.junior_holder,
      ward_symbol: raw.ward_symbol ?? "WARD",
      ward_name: raw.ward_name ?? "Wardline Mutual share",
      ward_supply: raw.ward_supply ?? raw.senior_shares ?? "0",
      ward_price: raw.ward_price ?? raw.share_price ?? "1000000",
      launch_price: raw.launch_price ?? "1000000",
      price_history: (raw.price_history ?? []).map((p: any) => ({
        at: toIso(p.at),
        price: p.price,
        event: p.event,
      })),
      fees_earned: raw.fees_earned,
      claims_paid: raw.claims_paid,
      coverage_capacity: raw.coverage_capacity,
      withdraw_delay_days: raw.withdraw_delay_days,
      large_claim_threshold: raw.large_claim_threshold,
      trade_url: raw.trade_url ?? null,
      share_price: raw.share_price ?? raw.ward_price,
      senior_shares: raw.senior_shares ?? raw.ward_supply,
    };
  }

  async getPosition(account: string): Promise<PoolPosition> {
    const raw = await viewCall<any>(
      this.provider,
      this.contractId,
      "get_position",
      { account },
    );
    const pendings: PendingRedemption[] = (raw.pending_withdrawals ?? []).map((w: any) => ({
      id: w.id,
      ward: w.ward ?? w.shares ?? "0",
      shares: w.shares ?? w.ward ?? "0",
      value: w.value,
      requested_at: toIso(w.requested_at),
      available_at: toIso(w.available_at),
    }));
    const locked = pendings.reduce((sum: bigint, w: any) => sum + BigInt(w.ward), 0n);
    const totalShares = BigInt(raw.shares ?? raw.ward ?? 0);
    const freeWard = raw.ward !== undefined ? raw.ward : (totalShares - locked).toString();

    return {
      account: raw.account,
      ward: freeWard,
      shares: raw.shares ?? freeWard,
      ward_locked: raw.ward_locked ?? locked.toString(),
      value: raw.value,
      pending_withdrawals: pendings,
    };
  }

  async deposit(
    account: string,
    amount: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string; ward: string; shares: string }> {
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
        gas: GAS_PAYMENT,
      },
      this.options,
    );
    const val = outcome.value as { tx: string; ward?: string; shares?: string };
    const ward = val.ward ?? val.shares?.toString() ?? "0";
    return {
      tx: val.tx ?? outcome.tx_hash,
      ward,
      shares: val.shares?.toString() ?? ward,
    };
  }

  async requestWithdraw(
    account: string,
    wardOrShares: string,
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
          shares: wardOrShares,
          ward: wardOrShares,
        },
        gas: GAS_PAYMENT,
      },
      this.options,
    );
    const val = outcome.value as { tx: string; id: string; available_at: string };
    return {
      tx: val.tx ?? outcome.tx_hash,
      id: val.id,
      available_at: toIso(val.available_at),
    };
  }

  async redeem(
    account: string,
    id: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string; usdc: string }> {
    if (!signer) throw new Error("Signer required for redeem");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "redeem",
        args: {
          account,
          id,
        },
        gas: GAS_PAYMENT,
      },
      this.options,
    );
    const val = outcome.value as { tx: string; usdc: string };
    return {
      tx: val.tx ?? outcome.tx_hash,
      usdc: val.usdc?.toString() ?? "0",
    };
  }

  async listClaims(): Promise<ClaimView[]> {
    try {
      const list = await viewCall<any[]>(
        this.provider,
        this.contractId,
        "list_claims",
        {},
      );
      return list.map((c) => ({
        claim_id: c.claim_id,
        subject: c.subject,
        claimant: c.claimant,
        amount: c.amount,
        reason: c.reason,
        status: (c.status === "paid" || c.status === "rejected" ? c.status : "pending_vote") as "paid" | "pending_vote" | "rejected",
        paid_from_junior: c.paid_from_junior,
        paid_from_senior: c.paid_from_senior,
        ward_price_before: c.ward_price_before ?? "",
        ward_price_after: c.ward_price_after ?? "",
        filed_at: toIso(c.filed_at),
        tx: c.tx ?? null,
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
        gas: GAS_PAYMENT,
      },
      this.options,
    );
    const val = outcome.value as any;
    return {
      claim_id: val.claim_id,
      subject: val.subject,
      claimant: val.claimant,
      amount: val.amount,
      reason: val.reason,
      status: (val.status === "paid" || val.status === "rejected" ? val.status : "pending_vote") as "paid" | "pending_vote" | "rejected",
      paid_from_junior: val.paid_from_junior,
      paid_from_senior: val.paid_from_senior,
      ward_price_before: val.ward_price_before ?? "",
      ward_price_after: val.ward_price_after ?? "",
      filed_at: toIso(val.filed_at),
      tx: val.tx ?? null,
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
        gas: GAS_PAYMENT,
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
        gas: GAS_PAYMENT,
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
        gas: GAS_PAYMENT,
      },
      this.options,
    );
  }

  async ftTotalSupply(): Promise<string> {
    const raw = await viewCall<string>(this.provider, this.contractId, "ft_total_supply", {});
    return raw;
  }

  async ftBalanceOf(accountId: string): Promise<string> {
    const raw = await viewCall<string>(this.provider, this.contractId, "ft_balance_of", { account_id: accountId });
    return raw;
  }

  async ftMetadata(): Promise<{ spec: string; name: string; symbol: string; decimals: number }> {
    return viewCall(this.provider, this.contractId, "ft_metadata", {});
  }

  async ftTransfer(
    receiverId: string,
    amount: string,
    memo?: string,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for ftTransfer");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "ft_transfer",
        args: { receiver_id: receiverId, amount, memo: memo ?? null },
        deposit: 1n,
        gas: GAS_PAYMENT,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async storageDeposit(
    accountId?: string,
    registrationOnly = false,
    deposit: string | bigint = 1250000000000000000000n,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ total: string; available: string }> {
    if (!signer) throw new Error("Signer required for storageDeposit");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "storage_deposit",
        args: {
          account_id: accountId ?? null,
          registration_only: registrationOnly,
        },
        deposit: typeof deposit === "bigint" ? deposit : BigInt(deposit),
        gas: GAS_PAYMENT,
      },
      this.options,
    );
    return outcome.value as { total: string; available: string };
  }

  async listProposals(): Promise<MutualProposalView[]> {
    try {
      const res = await viewCall<MutualProposalView[]>(
        this.provider,
        this.contractId,
        "list_proposals",
        {},
      );
      return res.map((p) => ({
        ...p,
        snapshot_at: toIso(p.snapshot_at),
        opens_at: toIso(p.opens_at),
        closes_at: toIso(p.closes_at),
        executed_at: p.executed_at ? toIso(p.executed_at) : null,
      }));
    } catch {
      return [];
    }
  }

  async getProposal(id: number): Promise<MutualProposalView | null> {
    try {
      const p = await viewCall<MutualProposalView>(
        this.provider,
        this.contractId,
        "get_proposal",
        { id },
      );
      if (!p) return null;
      return {
        ...p,
        snapshot_at: toIso(p.snapshot_at),
        opens_at: toIso(p.opens_at),
        closes_at: toIso(p.closes_at),
        executed_at: p.executed_at ? toIso(p.executed_at) : null,
      };
    } catch {
      return null;
    }
  }

  async propose(
    args: { description: string; action: MutualAction },
    signer: SignerHandle | undefined = this.signer,
  ): Promise<MutualProposalView> {
    if (!signer) throw new Error("Signer required for propose");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "propose",
        args: {
          description: args.description,
          action: args.action,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const id = outcome.value as number;
    const p = await this.getProposal(id);
    if (!p) throw new Error("Proposal created but not found");
    return p;
  }

  async vote(
    args: { id: number; support: "for" | "against" },
    signer: SignerHandle | undefined = this.signer,
  ): Promise<MutualProposalView> {
    if (!signer) throw new Error("Signer required for vote");
    await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "vote",
        args: {
          id: args.id,
          support: args.support,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const p = await this.getProposal(args.id);
    if (!p) throw new Error("Proposal not found after vote");
    return p;
  }

  async execute(
    id: number,
    signer: SignerHandle | undefined = this.signer,
  ): Promise<MutualProposalView> {
    if (!signer) throw new Error("Signer required for execute");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "execute",
        args: { id },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    const p = (outcome.value as MutualProposalView) || (await this.getProposal(id));
    if (!p) throw new Error("Proposal not found after execute");
    return {
      ...p,
      snapshot_at: toIso(p.snapshot_at),
      opens_at: toIso(p.opens_at),
      closes_at: toIso(p.closes_at),
      executed_at: p.executed_at ? toIso(p.executed_at) : null,
    };
  }

  async weightOf(id: number, voter: string): Promise<string> {
    try {
      const res = await viewCall<string>(
        this.provider,
        this.contractId,
        "weight_of",
        { id, voter },
      );
      return res.toString();
    } catch {
      return "0";
    }
  }

  async governanceParams(): Promise<GovernanceParams> {
    try {
      return await viewCall<GovernanceParams>(
        this.provider,
        this.contractId,
        "governance_params",
        {},
      );
    } catch {
      return { quorum_bps: 2000, voting_days: 3 };
    }
  }
}
