import type { Provider } from "near-api-js";
import {
  GAS_ADMIN,
  callFinal,
  makeProvider,
  viewCall,
  type SignerHandle,
  type TransportOptions,
} from "./transport.js";

export interface RegistryVendorAccount {
  account: string;
  status: "active" | "pending";
  activatesAt: string | null;
  evidenceTier?: string;
}

export interface RegistryVendor {
  domain: string;
  name: string;
  verifiedAt: string;
  accounts: RegistryVendorAccount[];
  legalName: string | null;
  legalNameSource: "vendor-claimed" | null;
  evidenceHash: string;
  issuedAt: string;
}

export interface AttestVendorInput {
  domain: string;
  name: string;
  accounts: string[];
  evidenceHash: string;
  issuedAt: string;
  legalName?: string | null;
  evidenceTier?: string;
}

export interface PayeeRegistryClientOptions extends TransportOptions {
  signer?: SignerHandle;
}

export interface PayeeRegistryClientConfig extends TransportOptions {
  contractId?: string;
  registryId?: string;
  rpcUrl?: string;
  provider?: Provider;
  signer?: SignerHandle;
}

/**
 * Client for Wardline public payee registry on NEAR.
 * Read methods work in browsers without fs imports.
 */
export class PayeeRegistryClient {
  readonly contractId: string;
  readonly provider: Provider;
  private readonly signer?: SignerHandle | undefined;
  private readonly options: PayeeRegistryClientOptions;

  constructor(
    contractIdOrConfig: string | PayeeRegistryClientConfig,
    providerOrUrl?: Provider | string,
    options: PayeeRegistryClientOptions = {},
  ) {
    if (typeof contractIdOrConfig === "object") {
      const cfg = contractIdOrConfig;
      this.contractId = cfg.contractId ?? cfg.registryId ?? "";
      this.provider =
        cfg.provider ??
        (cfg.rpcUrl ? makeProvider(cfg.rpcUrl) : makeProvider("https://rpc.testnet.near.org"));
      this.signer = cfg.signer;
      this.options = cfg;
    } else {
      this.contractId = contractIdOrConfig;
      this.provider =
        typeof providerOrUrl === "string"
          ? makeProvider(providerOrUrl)
          : providerOrUrl ?? makeProvider("https://rpc.testnet.near.org");
      this.signer = options.signer;
      this.options = options;
    }
  }

  // ---------- PayeeRegistry interface ----------

  async getVendor(domain: string): Promise<RegistryVendor | null> {
    return viewCall<RegistryVendor | null>(this.provider, this.contractId, "get_vendor", {
      domain,
    });
  }

  async listVendors(fromIndex = 0, limit = 100): Promise<RegistryVendor[]> {
    return viewCall<RegistryVendor[]>(this.provider, this.contractId, "list_vendors", {
      from_index: fromIndex,
      limit,
    });
  }

  async findByAccount(caip10: string): Promise<RegistryVendor | null> {
    return viewCall<RegistryVendor | null>(this.provider, this.contractId, "get_vendor_by_account", {
      caip10,
    });
  }

  async attestVendor(input: AttestVendorInput): Promise<RegistryVendor> {
    if (!this.signer) {
      throw new Error("PayeeRegistryClient: signer required for attestVendor");
    }
    const outcome = await callFinal(
      this.signer,
      {
        contract_id: this.contractId,
        method: "attest_vendor",
        args: { input },
        gas: GAS_ADMIN,
        deposit: 0n,
      },
      this.options,
    );
    return outcome.value as RegistryVendor;
  }

  // ---------- Additional Views & Actions ----------

  async resolve(domain: string, chain: string): Promise<string | null> {
    return viewCall<string | null>(this.provider, this.contractId, "resolve", {
      domain,
      chain,
    });
  }

  async isVerifiedPayee(account: string, domain: string): Promise<boolean> {
    return viewCall<boolean>(this.provider, this.contractId, "is_verified_payee", {
      account,
      domain,
    });
  }

  async proposeUpdate(
    domainOrInput:
      | string
      | {
          domain: string;
          accounts: string[];
          evidenceHash: string;
          issuedAt: string;
          legalName?: string | null;
          evidenceTier?: string;
        },
    accounts?: string[],
    evidenceHash?: string,
    issuedAt?: string,
    legalName?: string | null,
    evidenceTier?: string,
  ): Promise<RegistryVendor> {
    if (!this.signer) {
      throw new Error("PayeeRegistryClient: signer required for proposeUpdate");
    }
    const input =
      typeof domainOrInput === "object"
        ? domainOrInput
        : {
            domain: domainOrInput,
            accounts: accounts ?? [],
            evidenceHash: evidenceHash ?? "",
            issuedAt: issuedAt ?? "",
            legalName: legalName ?? null,
            evidenceTier: evidenceTier ?? null,
          };

    const outcome = await callFinal(
      this.signer,
      {
        contract_id: this.contractId,
        method: "propose_update",
        args: {
          domain: input.domain,
          accounts: input.accounts,
          evidence_hash: input.evidenceHash,
          issued_at: input.issuedAt,
          legal_name: input.legalName ?? null,
          evidence_tier: input.evidenceTier ?? null,
        },
        gas: GAS_ADMIN,
        deposit: 0n,
      },
      this.options,
    );
    return outcome.value as RegistryVendor;
  }

  async revokeVendor(domain: string): Promise<void> {
    if (!this.signer) {
      throw new Error("PayeeRegistryClient: signer required for revokeVendor");
    }
    await callFinal(
      this.signer,
      {
        contract_id: this.contractId,
        method: "revoke_vendor",
        args: { domain },
        gas: GAS_ADMIN,
        deposit: 0n,
      },
      this.options,
    );
  }
}
