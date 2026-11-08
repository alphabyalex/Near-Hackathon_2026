import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Digest, type Manifest, ManifestSchema } from "@wardline/schemas";
import { AGENT_TOOLS, LLM_SETTINGS, MODEL_ID, MODEL_PROVIDER, PACKAGE_ROOT } from "./agent-config.js";
import { digestOf, sha256Digest } from "./canonical.js";
import { type PromptVersion, promptDigest } from "./prompts.js";

/**
 * Source files that decide how the model's input is built and how its output is treated.
 * prompts.ts is left out on purpose: it is covered by prompt_digest, and it holds both versions.
 */
export const HARNESS_FILES = ["checks.ts", "decisions.ts", "guard.ts", "llm-agent.ts", "llm-client.ts", "money.ts", "render.ts", "proof.ts"];

/** Line endings are normalized so a Windows and a Linux checkout get the same digest. */
export function harnessDigest(): Digest {
  const files = HARNESS_FILES.map((name) => ({
    name,
    digest: sha256Digest(readFileSync(join(PACKAGE_ROOT, "src", name), "utf8").replace(/\r\n/g, "\n")),
  }));
  return digestOf(files);
}

/** Fixed per version, so rebuilding a manifest later gives a byte-identical file. */
const CREATED_AT: Record<PromptVersion, string> = {
  A: "2026-11-05T00:00:00Z",
  B: "2026-11-05T00:00:00Z",
};

export function buildManifest(version: PromptVersion): Manifest {
  return ManifestSchema.parse({
    schema: "wardline-manifest-v1",
    name: "wardline-invoice-agent",
    version,
    model_provider: MODEL_PROVIDER,
    model_id: MODEL_ID,
    prompt_digest: promptDigest(version),
    harness_digest: harnessDigest(),
    tools: AGENT_TOOLS,
    settings: LLM_SETTINGS,
    created_at: CREATED_AT[version],
  });
}

/**
 * RFC 8785 canonical JSON hashed with SHA-256, over what decides behavior: provider, model,
 * prompt, harness, settings and tools. The name, version label and created_at are labels, so
 * they are left out: relabeling an agent must not make it look like a different agent.
 */
export function manifestDigest(manifest: Manifest): Digest {
  return digestOf({
    schema: manifest.schema,
    model_provider: manifest.model_provider,
    model_id: manifest.model_id,
    prompt_digest: manifest.prompt_digest,
    harness_digest: manifest.harness_digest,
    tools: manifest.tools,
    settings: manifest.settings,
  });
}
