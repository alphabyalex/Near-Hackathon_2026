import { z } from "zod";

const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;

/** Integer string in atomic token units. Never a JS number, which would lose precision. */
export const AtomicAmountSchema = z.string().regex(UNSIGNED_INTEGER, "must be an unsigned integer string");
export type AtomicAmount = z.infer<typeof AtomicAmountSchema>;

/** Nanoseconds since the Unix epoch as an integer string. */
export const NanoTimestampSchema = z.string().regex(UNSIGNED_INTEGER, "must be an unsigned integer string");
export type NanoTimestamp = z.infer<typeof NanoTimestampSchema>;

/** Monotonic revision number of an on-chain record. */
export const RevisionSchema = z.number().int().nonnegative();
export type Revision = z.infer<typeof RevisionSchema>;

export const AccountIdSchema = z.string().regex(/^[a-z0-9._-]{2,64}$/, "must be a NEAR account id");
export type AccountId = z.infer<typeof AccountIdSchema>;

export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "must be sha256:<64 lowercase hex chars>");
export type Digest = z.infer<typeof DigestSchema>;
