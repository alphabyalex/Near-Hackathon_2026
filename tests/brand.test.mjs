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
import { EXAMPLES, isBinary, LEGACY_SPANS, listFiles, OLD_NAMES, renamePath, repoRoot, rewrite, skipEntry } from "../scripts/rebrand-wardline.mjs";

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
