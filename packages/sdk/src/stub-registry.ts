import type { PayeeSignals } from "@wardline/schemas";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { parseAccount, normalizeDomain } from "./caip.js";
import type { AttestVendorInput, PayeeRegistry, RegistryVendor, SignalsProvider } from "./interfaces.js";

const HOUR_MS = 3_600_000;
export const DEFAULT_COOLING_OFF_HOURS = 72;
const SEEDED_AT = "2026-11-01T00:00:00.000Z";

export const SEED_EVIDENCE_HASH = `sha256:${bytesToHex(sha256(utf8ToBytes("seed")))}`;

export interface SeedVendor {
  domain: string;
  name: string;
  nearId: string;
}

/** The registry the stub engine starts with. */
export const STUB_VENDORS: readonly SeedVendor[] = [
  { domain: "northwind.example", name: "Northwind Trading", nearId: "northwind.testnet" },
  { domain: "fernhill.example", name: "Fernhill Cloud Hosting", nearId: "fernhillcloud.testnet" },
  { domain: "larkspur.example", name: "Larkspur Office Supply", nearId: "larkspuroffice.testnet" },
  { domain: "quarrylane.example", name: "Quarry Lane Legal", nearId: "quarrylanelegal.testnet" },
];

/** The stub vendors plus six more, for scripts/seed-payees.ts. */
export const ALL_SEED_VENDORS: readonly SeedVendor[] = [
  ...STUB_VENDORS,
  { domain: "aldergate.example", name: "Aldergate Freight", nearId: "aldergatefreight.testnet" },
  { domain: "brightwater.example", name: "Brightwater Media", nearId: "brightwatermedia.testnet" },
  { domain: "tollgate.example", name: "Tollgate Analytics", nearId: "tollgateanalytics.testnet" },
  { domain: "marrowstone.example", name: "Marrowstone Payroll", nearId: "marrowstonepayroll.testnet" },
  { domain: "kestrel.example", name: "Kestrel Facilities", nearId: "kestrelfacilities.testnet" },
  { domain: "ostler.example", name: "Ostler Printing", nearId: "ostlerprinting.testnet" },
];

/** Seed EVM and Solana addresses are hashes of the domain: stable across runs, and no key exists for them. */
export const seedEvmAddress = (domain: string): string => `0x${bytesToHex(sha256(utf8ToBytes(`evm:${domain}`))).slice(0, 40)}`;
export const seedSolanaAddress = (domain: string): string => base58.encode(sha256(utf8ToBytes(`solana:${domain}`)));

export const seedAccounts = (vendor: SeedVendor): string[] => [
  `near:testnet:${vendor.nearId}`,
  `eip155:84532:${seedEvmAddress(vendor.domain)}`,
  `solana:devnet:${seedSolanaAddress(vendor.domain)}`,
];

export const seedAttestation = (vendor: SeedVendor): AttestVendorInput => ({
  domain: vendor.domain,
  name: vendor.name,
  accounts: seedAccounts(vendor),
  evidenceHash: SEED_EVIDENCE_HASH,
  issuedAt: SEEDED_AT,
});

export interface MemoryRegistryOptions {
  vendors?: readonly SeedVendor[];
  coolingOffHours?: number;
  now?: () => Date;
}

interface StoredAccount {
  account: string;
  activatesAt: string | null;
}

interface StoredVendor extends Omit<RegistryVendor, "accounts"> {
  accounts: StoredAccount[];
}

/**
 * In-memory registry. A vendor's first linked accounts are active at once. An account added later
 * waits out the cooling-off period, so a hijacked website cannot redirect payments right away.
 */
export function createMemoryRegistry(options: MemoryRegistryOptions = {}): PayeeRegistry {
  const now = options.now ?? (() => new Date());
  const coolingOffMs = (options.coolingOffHours ?? DEFAULT_COOLING_OFF_HOURS) * HOUR_MS;
  const vendors = new Map<string, StoredVendor>();

  const view = (stored: StoredVendor): RegistryVendor => ({
    ...stored,
    accounts: stored.accounts.map(({ account, activatesAt }) => {
      const pending = activatesAt !== null && new Date(activatesAt).getTime() > now().getTime();
      // Every account here signed for itself and is listed in its domain's file, which is T2.
      return {
        account,
        status: pending ? ("pending" as const) : ("active" as const),
        activatesAt: pending ? activatesAt : null,
        evidenceTier: "T2_DOMAIN_LINKED" as const,
      };
    }),
  });

  const attest = (input: AttestVendorInput, at: string): StoredVendor => {
    const domain = normalizeDomain(input.domain);
    const existing = vendors.get(domain);
    if (existing && new Date(input.issuedAt).getTime() < new Date(existing.issuedAt).getTime()) {
      throw new Error(`This proof for ${domain} is older than the one on record.`);
    }
    const activatesAt = new Date(new Date(at).getTime() + coolingOffMs).toISOString();
    const accounts = input.accounts.map((raw): StoredAccount => {
      const account = parseAccount(raw).caip10;
      const known = existing?.accounts.find((a) => a.account === account);
      if (known) return known;
      return { account, activatesAt: existing ? activatesAt : null };
    });
    const stored: StoredVendor = {
      domain,
      name: input.name,
      verifiedAt: at,
      accounts,
      legalName: input.legalName ?? null,
      legalNameSource: input.legalName ? "vendor-claimed" : null,
      evidenceHash: input.evidenceHash,
      issuedAt: input.issuedAt,
    };
    vendors.set(domain, stored);
    return stored;
  };

  for (const vendor of options.vendors ?? []) attest(seedAttestation(vendor), SEEDED_AT);

  return {
    async getVendor(domain) {
      const stored = vendors.get(normalizeDomain(domain));
      return stored ? view(stored) : null;
    },
    async listVendors() {
      return [...vendors.values()].sort((a, b) => a.domain.localeCompare(b.domain)).map(view);
    },
    async findByAccount(caip10) {
      const stored = [...vendors.values()].find((v) => v.accounts.some((a) => a.account === caip10));
      return stored ? view(stored) : null;
    },
    async attestVendor(input) {
      return view(attest(input, now().toISOString()));
    },
  };
}

const HEALTHY_NEAR_SIGNALS: PayeeSignals = {
  supported: true,
  accountExists: true,
  createdAtBlock: 180_000_000,
  ageDays: 400,
  fullAccessKeysAddedLast7d: 0,
  codeChangedLast7d: false,
  hasContract: false,
  lookalikeOf: null,
};

const UNSUPPORTED_SIGNALS: PayeeSignals = {
  supported: false,
  accountExists: null,
  createdAtBlock: null,
  ageDays: null,
  fullAccessKeysAddedLast7d: null,
  codeChangedLast7d: null,
  hasContract: null,
  lookalikeOf: null,
};

const BUILT_IN_SIGNALS: Record<string, Partial<PayeeSignals> | null> = {
  "near:testnet:vanished-vendor.testnet": { accountExists: false, createdAtBlock: null, ageDays: null, hasContract: null },
  "near:testnet:brand-new-payee.testnet": { ageDays: 1 },
  "near:testnet:rotated-keys.testnet": { fullAccessKeysAddedLast7d: 1 },
  "near:testnet:changed-code.testnet": { codeChangedLast7d: true, hasContract: true },
  "near:testnet:unreadable.testnet": null,
};

/**
 * Deterministic signals. NEAR accounts look healthy unless listed; other chains are unsupported.
 * A null entry means the signals could not be read.
 */
export function createStubSignals(overrides: Record<string, Partial<PayeeSignals> | null> = {}): SignalsProvider {
  const table = { ...BUILT_IN_SIGNALS, ...overrides };
  return {
    async signals(caip10) {
      if (!caip10.startsWith("near:")) return UNSUPPORTED_SIGNALS;
      const entry = table[caip10];
      if (entry === null) throw new Error("signals unavailable");
      return { ...HEALTHY_NEAR_SIGNALS, ...entry };
    },
  };
}
