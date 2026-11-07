import { createHash } from "node:crypto";
import { normalizeDomain, type PayeeRegistry, type RegistryVendor } from "@redline/sdk";
import { verifyProofFile, type NearKeyLookup, type ProofCheck } from "./proofs.js";
import type { WellKnownFetcher } from "./well-known.js";

export const PAYEE_FILE_PATH = "/.well-known/redline-payee.json";
export const MERCHANT_IDENTITY_PATH = "/.well-known/merchant-identity.json";

export interface VerifyVendorDeps {
  registry: PayeeRegistry;
  fetchFile: WellKnownFetcher;
  lookupKeys: NearKeyLookup;
  now: () => Date;
}

export type VerifyVendorResult =
  | { ok: true; vendor: RegistryVendor; evidenceHash: string; accounts: ProofCheck[] }
  | { ok: false; message: string; accounts: ProofCheck[] };

const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();

/** One file hashes directly. With two, it is the sha256 of both file hashes, so neither can be swapped. */
export function evidenceHash(payeeBytes: Uint8Array, merchantBytes: Uint8Array | null): string {
  const digest = merchantBytes === null ? sha256(payeeBytes) : sha256(Buffer.concat([sha256(payeeBytes), sha256(merchantBytes)]));
  return `sha256:${digest.toString("hex")}`;
}

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
};

/** The draft's document is optional and self-asserted: we keep its legal name, nothing depends on it. */
async function fetchMerchantIdentity(domain: string, fetchFile: WellKnownFetcher): Promise<{ bytes: Uint8Array; legalName: string } | null> {
  try {
    const { status, body } = await fetchFile(domain, MERCHANT_IDENTITY_PATH);
    if (status !== 200) return null;
    const doc = parseJson(body) as { subject?: unknown; legalName?: unknown } | null;
    if (typeof doc?.subject !== "string" || doc.subject.toLowerCase() !== domain) return null;
    if (typeof doc.legalName !== "string" || doc.legalName.length === 0 || doc.legalName.length > 200) return null;
    return { bytes: body, legalName: doc.legalName };
  } catch {
    return null;
  }
}

export async function verifyVendor(rawDomain: string, deps: VerifyVendorDeps): Promise<VerifyVendorResult> {
  const domain = normalizeDomain(rawDomain);
  let fetched: { status: number; body: Uint8Array };
  try {
    fetched = await deps.fetchFile(domain, PAYEE_FILE_PATH);
  } catch {
    return { ok: false, message: `Could not fetch https://${domain}${PAYEE_FILE_PATH}.`, accounts: [] };
  }
  if (fetched.status !== 200) {
    return { ok: false, message: `https://${domain}${PAYEE_FILE_PATH} answered ${fetched.status}.`, accounts: [] };
  }

  const proofs = await verifyProofFile(parseJson(fetched.body), domain, { lookupKeys: deps.lookupKeys, now: deps.now() });
  if (!proofs.ok || !proofs.file) return { ok: false, message: proofs.message, accounts: proofs.accounts };

  const merchant = await fetchMerchantIdentity(domain, deps.fetchFile);
  const hash = evidenceHash(fetched.body, merchant?.bytes ?? null);
  try {
    const vendor = await deps.registry.attestVendor({
      domain,
      name: proofs.file.name,
      accounts: proofs.accounts.flatMap((a) => (a.ok ? [a.normalized] : [])),
      evidenceHash: hash,
      issuedAt: proofs.file.issued_at,
      legalName: merchant?.legalName ?? null,
    });
    return { ok: true, vendor, evidenceHash: hash, accounts: proofs.accounts };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The registry refused this proof.", accounts: proofs.accounts };
  }
}
