import type { Provider } from "near-api-js";
import {
  GAS_ADMIN,
  callFinal,
  makeProvider,
  viewCall,
  type SignerHandle,
  type TransportOptions,
} from "./transport.js";

export interface AttestedModel {
  model_id: string;
  signing_address: string;
  signing_algo: "ecdsa";
  source: string;
  attested_at: string;
}

export interface ProviderRecord {
  provider_id: string;
  pay_to: string;
  model_ids: string[];
}

export interface ModelRegistryClientConfig extends TransportOptions {
  contractId?: string | undefined;
  registryId?: string | undefined;
  rpcUrl?: string | undefined;
  provider?: Provider | undefined;
  signer?: SignerHandle | undefined;
}

export class NearModelRegistryClient {
  readonly mode = "near" as const;
  readonly contractId: string;
  readonly provider: Provider;
  private readonly signer?: SignerHandle | undefined;
  private readonly options: TransportOptions;

  constructor(
    contractIdOrConfig: string | ModelRegistryClientConfig,
    providerOrUrl?: Provider | string,
    options: TransportOptions & { signer?: SignerHandle } = {},
  ) {
    if (typeof contractIdOrConfig === "object") {
      const cfg = contractIdOrConfig;
      this.contractId = cfg.contractId ?? cfg.registryId ?? "";
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

  async isAttested(modelId: string, signer: string): Promise<boolean> {
    try {
      return await viewCall<boolean>(
        this.provider,
        this.contractId,
        "is_attested",
        {
          model_id: modelId,
          signer: signer.toLowerCase(),
        },
      );
    } catch {
      return false;
    }
  }

  async listModels(): Promise<AttestedModel[]> {
    try {
      const models = await viewCall<AttestedModel[]>(
        this.provider,
        this.contractId,
        "list_models",
        {},
      );
      return models.map((m) => ({
        ...m,
        signing_algo: "ecdsa",
      }));
    } catch {
      return [];
    }
  }

  async addModel(
    modelId: string,
    signingAddress: string,
    signingAlgo = "ecdsa",
    source = "Attestation report",
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for addModel");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "add_model",
        args: {
          model_id: modelId,
          signing_address: signingAddress.toLowerCase(),
          signing_algo: signingAlgo,
          source,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }

  async addProvider(
    providerId: string,
    payTo: string,
    modelIds: string[],
    signer: SignerHandle | undefined = this.signer,
  ): Promise<{ tx: string }> {
    if (!signer) throw new Error("Signer required for addProvider");
    const outcome = await callFinal(
      signer,
      {
        contract_id: this.contractId,
        method: "add_provider",
        args: {
          provider_id: providerId,
          pay_to: payTo,
          model_ids: modelIds,
        },
        gas: GAS_ADMIN,
      },
      this.options,
    );
    return { tx: outcome.tx_hash };
  }
}
