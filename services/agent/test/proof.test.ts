import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectProof } from "../src/proof.js";
import { sha256Digest } from "../src/canonical.js";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });
function proofDir() { const dir = mkdtempSync(join(tmpdir(), "redline-proof-")); dirs.push(dir); vi.stubEnv("REDLINE_PROOF_DIR", dir); return dir; }

it("preserves exact bytes and fetches completion-specific evidence without storing the key", async () => {
  const dir = proofDir(); const urls: string[] = [];
  const fetcher: typeof fetch = async (url) => { urls.push(String(url)); return Response.json({ signature_kind: "provider_tee" }); };
  const proof = await collectProof("https://example.test/v1", "secret-key", fetcher, "chat/1", '{ "x": 1 }', '{"id":"chat/1"}');
  expect(proof).toMatchObject({ status: "collected", verified: false, request_hash: sha256Digest('{ "x": 1 }') });
  expect(urls[0]).toContain("signature/chat%2F1?");
  expect(urls[1]).toContain(`nonce=${proof.nonce}`);
  const saved = readFileSync(join(dir, readdirSync(dir)[0]!), "utf8");
  expect(saved).not.toContain("secret-key");
  expect(JSON.parse(saved).request).toBe('{ "x": 1 }');
});

it("records unavailable evidence on endpoint failure without claiming verification", async () => {
  proofDir();
  const proof = await collectProof("https://example.test/v1", "secret", async () => new Response("no", { status: 503 }), "chat1", "{}", "{}");
  expect(proof).toMatchObject({ status: "unavailable", verified: false, error: "Proof endpoint HTTP 503" });
});
