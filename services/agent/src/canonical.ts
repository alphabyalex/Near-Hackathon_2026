import { createHash } from "node:crypto";
import type { Digest } from "@redline/schemas";
import canonicalize from "canonicalize";

/** RFC 8785 canonical JSON: key order and number formatting cannot change the output. */
export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("value cannot be represented as canonical JSON");
  return out;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export const sha256Digest = (text: string): Digest => `sha256:${sha256Hex(text)}`;

/** The digest of a value's canonical JSON. */
export const digestOf = (value: unknown): Digest => sha256Digest(canonicalJson(value));
