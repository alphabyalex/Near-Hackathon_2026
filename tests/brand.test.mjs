/**
 * Brand guard. Fails if an old product or token name appears anywhere outside the allowlist that
 * scripts/rebrand-wardline.mjs defines (legacy spans, plus paths marked legacy there), or if the
 * repository URL drifts from repo.config.json.
 *
 * Run: node --test tests/brand.test.mjs (part of pnpm test).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EXAMPLES, isBinary, LEGACY_SPANS, RETIRED_TOKEN, RETIRED_TOKEN_ALLOW, listFiles, OLD_NAMES, renamePath, repoRoot, rewrite, skipEntry } from "../scripts/rebrand-wardline.mjs";

const ROOT = repoRoot();
const FILES = listFiles(ROOT);

/** Lockfile integrity values are base64 and can spell anything. */
const maskIntegrity = (text) => text.replace(/sha(?:1|256|384|512)-[A-Za-z0-9+/=]+/g, "");

function maskLegacy(text) {
  let out = text;
  for (const { pattern } of LEGACY_SPANS) out = out.replace(pattern, "");
  return out;
}

test("no old product or token names outside the allowlist", () => {
  const hits = [];
  for (const file of FILES) {
    if (skipEntry(file)?.legacy) continue;
    const buf = readFileSync(join(ROOT, file));
    if (isBinary(file, buf)) continue;
    let text = buf.toString("utf8");
    if (file === "pnpm-lock.yaml") text = maskIntegrity(text);
    text.split(/\r?\n/).forEach((line, i) => {
      const found = maskLegacy(line).match(OLD_NAMES);
      if (found) hits.push(`${file}:${i + 1}: ${[...new Set(found)].join(", ")}`);
    });
  }
  assert.deepEqual(hits, [], `Old names found. Run node scripts/rebrand-wardline.mjs, or add a justified entry to its allowlist.\n${hits.join("\n")}`);
});

test("no old names in file or folder names", () => {
  const bad = FILES.filter((f) => !skipEntry(f)?.legacy && renamePath(f) !== f);
  assert.deepEqual(bad, []);
});

test("the codemod maps each example as intended, and a second pass changes nothing", () => {
  for (const [input, expected] of EXAMPLES) {
    const once = rewrite(input);
    assert.equal(once, expected, input);
    assert.equal(rewrite(once), once, input);
  }
});

test("the repository URL lives in repo.config.json, and every copy matches it", () => {
  const { url } = JSON.parse(readFileSync(join(ROOT, "repo.config.json"), "utf8"));
  const stale = [];
  for (const file of FILES) {
    if (file === "repo.config.json" || skipEntry(file)?.legacy) continue;
    const buf = readFileSync(join(ROOT, file));
    if (isBinary(file, buf)) continue;
    for (const m of buf.toString("utf8").matchAll(/https:\/\/github\.com\/alphabyalex\/[A-Za-z0-9_.-]+/g)) {
      if (m[0] !== url) stale.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(stale, [], `Update these to ${url}`);
});

/** Files that publish the hosted links, and which of repo.config.json's hosted values each must carry. */
export const HOSTED_FILES = {
  "README.md": ["web", "api", "mcp"],
  "apps/web/public/llms.txt": ["api", "mcp"],
  "docs/skills/wardline-payee-check/SKILL.md": ["api", "mcp"],
  "services/mcp/server.json": ["mcp"],
};

test("hosted links live in repo.config.json, and README, llms.txt, SKILL.md and server.json match them", () => {
  const { hosted } = JSON.parse(readFileSync(join(ROOT, "repo.config.json"), "utf8"));
  assert.ok(hosted && hosted.web && hosted.api && hosted.mcp, "repo.config.json needs hosted.web, hosted.api and hosted.mcp");
  const origins = new Set(Object.values(hosted).map((u) => new URL(u).origin));
  const problems = [];
  for (const [file, keys] of Object.entries(HOSTED_FILES)) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const key of keys) if (!text.includes(hosted[key])) problems.push(`${file}: missing hosted.${key} ${hosted[key]}`);
    // Any temporary tunnel URL must be one of the configured values.
    for (const m of text.matchAll(/https:\/\/[a-z0-9.-]+\.(?:trycloudflare\.com|ngrok(?:-free)?\.app|loca\.lt)[^\s"'`)<]*/gi)) {
      if (!origins.has(new URL(m[0]).origin)) problems.push(`${file}: ${m[0]} is not in repo.config.json hosted`);
    }
    // On the MCP host, only the configured MCP path.
    const mcpOrigin = new URL(hosted.mcp).origin;
    for (const m of text.matchAll(/https:\/\/[^\s"'`)<]+/g)) {
      if (m[0].startsWith(mcpOrigin) && !m[0].startsWith(hosted.mcp)) problems.push(`${file}: ${m[0]} should be ${hosted.mcp}`);
    }
  }
  assert.deepEqual(problems, [], "Change the hosted values in repo.config.json, then update these files to match.");
});

test("the retired test token appears nowhere outside its allowlist; all money is USDC", () => {
  const hits = [];
  for (const file of FILES) {
    if (RETIRED_TOKEN_ALLOW.some((a) => (a.path.endsWith("/") ? file.startsWith(a.path) : file === a.path))) continue;
    const buf = readFileSync(join(ROOT, file));
    if (isBinary(file, buf)) continue;
    buf.toString("utf8").split(/\r?\n/).forEach((line, i) => {
      if (RETIRED_TOKEN.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `Use USDC (WARDLINE_USDC_ACCOUNT) instead.\n${hits.join("\n")}`);
});
