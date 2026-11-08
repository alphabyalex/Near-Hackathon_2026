import { createHash } from "node:crypto";
import type { Digest } from "@wardline/schemas";

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, keys with undefined
 * values dropped. Only safe integers are allowed as numbers so the encoding has exactly one
 * spelling. Amounts are already integer strings in our schemas.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) throw new Error(`canonicalJson: non-integer number ${value}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256Bytes(data: string | Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

/** Domain tags. Each kind of digest gets its own so one can never be passed off as another. */
export const DOMAIN = {
  scenario: "wardline/scenario/v1",
  suiteCommitment: "wardline/suite-commitment/v1",
  report: "wardline/report/v1",
  runRecord: "wardline/run-record/v1",
  manifest: "wardline/manifest/v1",
  paymentRequest: "wardline/payment-request/v1",
} as const;
export type Domain = (typeof DOMAIN)[keyof typeof DOMAIN];

export const SALT_BYTES = 32;

/**
 * SHA-256( domain || 0x00 || salt || canonicalJson(value) ).
 * Domain tags contain no NUL byte and the salt, when present, is exactly 32 bytes, so the
 * framing is unambiguous. Unsalted digests use domains that are never used salted.
 */
export function domainDigest(domain: Domain, value: unknown, salt?: Uint8Array): Digest {
  if (salt !== undefined && salt.length !== SALT_BYTES) throw new Error(`salt must be ${SALT_BYTES} bytes`);
  const h = createHash("sha256");
  h.update(domain, "utf8");
  h.update(Uint8Array.of(0));
  if (salt !== undefined) h.update(salt);
  h.update(canonicalJson(value), "utf8");
  return `sha256:${h.digest("hex")}`;
}
