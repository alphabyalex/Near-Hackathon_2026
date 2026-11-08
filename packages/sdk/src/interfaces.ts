import type {
  EvidenceTier,
  PayeeCheckRequest,
  PayeeCheckResult,
  PayeeResolveRequest,
  PayeeResolveResult,
  PayeeSignals,
  PayeeVendor,
} from "@redline/schemas";

/** A registry record: the public vendor view plus what the registry keeps next to it. */
export interface RegistryVendor extends PayeeVendor {
  legalName: string | null;
  /** The legal name comes from the vendor's own merchant-identity.json, unverified. */
  legalNameSource: "vendor-claimed" | null;
  evidenceHash: string;
  issuedAt: string;
}

export interface AttestVendorInput {
  domain: string;
  name: string;
  /** Normalized CAIP-10 accounts, each already verified. */
  accounts: string[];
  /** sha256 of the fetched proof file or files, or of "seed" for seeded vendors. */
  evidenceHash: string;
  issuedAt: string;
  legalName?: string | null;
}

/** Same surface for the memory registry and the payee-registry contract. */
export interface PayeeRegistry {
  getVendor(domain: string): Promise<RegistryVendor | null>;
  listVendors(): Promise<RegistryVendor[]>;
  findByAccount(caip10: string): Promise<RegistryVendor | null>;
  attestVendor(input: AttestVendorInput): Promise<RegistryVendor>;
}

export interface PaymentRecord {
  payer: string;
  domain: string;
  /** Normalized CAIP-10 account. */
  account: string;
}

/** Past payments per payer, domain and chain. Feeds PAYEE_CHANGED. */
export interface PayeeHistoryStore {
  record(payment: PaymentRecord): Promise<void>;
  /** The account most recently paid by this payer for this domain on this chain, if any. */
  lastAccount(payer: string, domain: string, chain: string): Promise<string | null>;
  /** True when this payer has paid this account before, or its owner approved it. Raises a match to T3_RELATIONSHIP. */
  hasRelationship(payer: string, account: string): Promise<boolean>;
}

export interface SignalsProvider {
  signals(caip10: string): Promise<PayeeSignals>;
}

export interface EngineContext {
  registry: PayeeRegistry;
  history: PayeeHistoryStore;
  signals: SignalsProvider;
  /** NEAR network used to normalize a bare account id. */
  network: string;
}

export type { EvidenceTier };

export type EngineCheckResult = Omit<PayeeCheckResult, "receipt">;
export type EngineResolveResult = Omit<PayeeResolveResult, "receipt">;

/** The deterministic decision step. The stub and @redline/payee-check both sit behind this. */
export interface PayeeEngine {
  check(request: PayeeCheckRequest, context: EngineContext): Promise<EngineCheckResult>;
  resolve(request: PayeeResolveRequest, context: EngineContext): Promise<EngineResolveResult>;
}
