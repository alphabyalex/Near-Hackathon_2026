import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ManifestSchema } from "@redline/schemas";
import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, MANIFEST_DIR, MODEL_ID } from "../src/agent-config.js";
import { canonicalJson, digestOf } from "../src/canonical.js";
import { buildManifest, harnessDigest, manifestDigest } from "../src/manifest.js";
import { PROMPTS, promptDigest } from "../src/prompts.js";

const reversedKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reversedKeys(v)]),
    );
  }
  return value;
};

describe("canonical JSON", () => {
  it("does not depend on key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
  });

  it("follows RFC 8785 number formatting", () => {
    expect(canonicalJson({ n: 1.0, e: 1e21, z: 0.000001 })).toBe('{"e":1e+21,"n":1,"z":0.000001}');
  });
});

describe("manifest", () => {
  it.each(["A", "B"] as const)("version %s is a valid manifest with no tools", (version) => {
    const manifest = buildManifest(version);
    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({ model_id: MODEL_ID, model_provider: "near-ai-cloud", tools: [] });
    expect(AGENT_TOOLS).toEqual([]);
  });

  it("has a digest that is stable across key order", () => {
    const manifest = buildManifest("A");
    const shuffled = reversedKeys(manifest) as typeof manifest;
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(manifest));
    expect(manifestDigest(shuffled)).toBe(manifestDigest(manifest));
  });

  it("has a digest that is stable across rebuilds", () => {
    expect(manifestDigest(buildManifest("A"))).toBe(manifestDigest(buildManifest("A")));
  });

  it("gives A and B different digests, differing only in the prompt", () => {
    const a = buildManifest("A");
    const b = buildManifest("B");
    expect(manifestDigest(a)).not.toBe(manifestDigest(b));
    expect(a.prompt_digest).not.toBe(b.prompt_digest);
    expect(a.harness_digest).toBe(b.harness_digest);
    expect(a.settings).toEqual(b.settings);
  });

  it("is sensitive to everything that decides behavior", () => {
    const base = buildManifest("A");
    const digest = manifestDigest(base);
    expect(manifestDigest({ ...base, model_id: "other" })).not.toBe(digest);
    expect(manifestDigest({ ...base, model_provider: "other" })).not.toBe(digest);
    expect(manifestDigest({ ...base, prompt_digest: promptDigest("B") })).not.toBe(digest);
    expect(manifestDigest({ ...base, harness_digest: promptDigest("B") })).not.toBe(digest);
    expect(manifestDigest({ ...base, settings: { ...base.settings, temperature: 1 } })).not.toBe(digest);
    expect(manifestDigest({ ...base, tools: ["web_search"] })).not.toBe(digest);
  });

  it("ignores labels", () => {
    const base = buildManifest("A");
    expect(manifestDigest({ ...base, created_at: "2030-01-01T00:00:00Z", name: "x", version: "y" })).toBe(manifestDigest(base));
  });

  it("B changes the prompt on purpose", () => {
    expect(PROMPTS.B.system).not.toBe(PROMPTS.A.system);
    expect(PROMPTS.B.user).toBe(PROMPTS.A.user);
  });

  it("hashes the harness to a digest", () => {
    expect(harnessDigest()).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it.each(["A", "B"] as const)("committed manifests/version-%s.json matches the code (if this fails: pnpm --filter agent manifest --write, and note it in docs/status/kristian.md)", (version) => {
    const committed = JSON.parse(readFileSync(join(MANIFEST_DIR, `version-${version}.json`), "utf8")) as { manifest_digest: string; manifest: unknown };
    const manifest = buildManifest(version);
    expect(committed.manifest).toEqual(manifest);
    expect(committed.manifest_digest).toBe(manifestDigest(manifest));
  });
});
