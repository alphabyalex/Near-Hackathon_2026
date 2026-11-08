import { randomBytes } from "node:crypto";
import type { Digest } from "@wardline/schemas";
import { z } from "zod";
import { DOMAIN, SALT_BYTES, domainDigest } from "./canonical.js";
import { countByCategory, type LoadedScenario } from "./fixtures.js";
import { HARNESS_ID, RUBRIC_VERSION } from "./rubric.js";

/**
 * Suite manifest: what the commitment binds. Kept private for the hidden set until reveal.
 * Includes the rubric version and harness id, so changing thresholds or the harness after
 * commitment produces a different digest.
 */
export const SuiteManifestSchema = z
  .object({
    schema: z.literal("wardline-suite-manifest-v1"),
    split: z.enum(["DEV", "ASSESSMENT"]),
    rubric_version: z.string().min(1),
    harness_id: z.string().min(1),
    counts: z.object({
      total: z.number().int(),
      legitimate: z.number().int(),
      adversarial: z.number().int(),
      exception: z.number().int(),
      final_challenge: z.number().int(),
      sequences: z.number().int(),
    }),
    scenario_hashes: z.array(z.object({ scenario_id: z.string().min(1), digest: z.string() })),
  })
  .strict();
export type SuiteManifest = z.infer<typeof SuiteManifestSchema>;

/** Public record. Safe to publish before reveal: it holds the commitment, never the salt. */
export const SuiteCommitmentSchema = z
  .object({
    schema: z.literal("wardline-suite-commitment-v1"),
    commitment: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    domain: z.literal(DOMAIN.suiteCommitment),
    construction: z.string(),
    split: z.enum(["DEV", "ASSESSMENT"]),
    rubric_version: z.string(),
    harness_id: z.string(),
    counts: SuiteManifestSchema.shape.counts,
    created_at: z.string(),
    salt_revealed: z.boolean(),
  })
  .strict();
export type SuiteCommitment = z.infer<typeof SuiteCommitmentSchema>;

export const CONSTRUCTION = "SHA-256(utf8(domain) || 0x00 || salt[32] || utf8(canonical_json(suite_manifest)))";

export function scenarioDigest(raw: unknown): Digest {
  return domainDigest(DOMAIN.scenario, raw);
}

export function buildSuiteManifest(suite: LoadedScenario[], split: SuiteManifest["split"]): SuiteManifest {
  const c = countByCategory(suite);
  return {
    schema: "wardline-suite-manifest-v1",
    split,
    rubric_version: RUBRIC_VERSION,
    harness_id: HARNESS_ID,
    counts: {
      total: suite.length,
      ...c,
      final_challenge: suite.filter((s) => s.scenario.split === "FINAL").length,
      sequences: new Set(suite.flatMap((s) => (s.state.sequence ? [s.state.sequence.sequence_id] : []))).size,
    },
    scenario_hashes: suite
      .map((s) => ({ scenario_id: s.scenario.scenario_id, digest: scenarioDigest(s.raw) }))
      .sort((a, b) => a.scenario_id.localeCompare(b.scenario_id)),
  };
}

export const newSalt = (): Buffer => randomBytes(SALT_BYTES);

export function saltFromHex(hex: string): Buffer {
  const clean = hex.trim();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("salt must be 64 lowercase hex chars");
  return Buffer.from(clean, "hex");
}

export function commitSuite(manifest: SuiteManifest, salt: Uint8Array): Digest {
  return domainDigest(DOMAIN.suiteCommitment, manifest, salt);
}

export function commitmentRecord(manifest: SuiteManifest, salt: Uint8Array, createdAt: string, saltRevealed: boolean): SuiteCommitment {
  return {
    schema: "wardline-suite-commitment-v1",
    commitment: commitSuite(manifest, salt),
    domain: DOMAIN.suiteCommitment,
    construction: CONSTRUCTION,
    split: manifest.split,
    rubric_version: manifest.rubric_version,
    harness_id: manifest.harness_id,
    counts: manifest.counts,
    created_at: createdAt,
    salt_revealed: saltRevealed,
  };
}
