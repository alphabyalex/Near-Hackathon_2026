/**
 * Secrets guard. Fails if an env file, a credential file or a key-shaped string is tracked by git, or if
 * .gitignore stops covering them. The values are never printed: a failure names the file and the kind.
 *
 * Run: node --test tests/secrets.test.mjs (part of pnpm test). It reads the files git tracks, so a secret
 * that is staged or committed is caught; one that is only ignored on disk (.env) is exactly what should be there.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const TRACKED = git("ls-files", "-z").split("\0").filter(Boolean);

/** Paths that must never be tracked. Templates (.env.example) are fine. */
const FORBIDDEN_PATH = [
  { kind: "env file", test: (p) => /(^|\/)\.env($|\.)/.test(p) && !/\.env\.(example|sample|template)$/.test(p) },
  { kind: "private key file", test: (p) => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(p) || /(^|\/)id_(rsa|ed25519|ecdsa)(\.|$)/.test(p) },
  { kind: "credentials file", test: (p) => /(^|\/)(credentials|signers)(\.[a-z0-9-]+)?\.json$/i.test(p) || /(^|\/)\.near-credentials(\/|$)/.test(p) || /(^|\/)\.wardline(\/|$)/.test(p) },
];

/** Key-shaped strings. A signature or public key in a recorded fixture is not matched: these need a secret-naming label. */
const SECRET_PATTERNS = [
  { kind: "NEAR secret key assigned to a secret-named field", re: /(private[_-]?key|secret[_-]?key|PRIVATE_KEY|SECRET_KEY)["']?\s*[:=]\s*["']?ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/ },
  { kind: "hex private key assigned to a secret-named field", re: /(private|secret)[_a-zA-Z]*["']?\s*[:=]\s*["']?0x[0-9a-fA-F]{64}\b/ },
  { kind: "sk- API key", re: /\bsk-[A-Za-z0-9_-]{24,}/ },
  { kind: "PEM private key", re: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: "Slack or Stripe live token", re: /\b(xox[baprs]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,})/ },
  { kind: "secret env var assigned a literal value", re: /\b(NEAR_AI_API_KEY|WARDLINE_[A-Z_]*(KEY|SECRET|TOKEN|SEED))\s*=\s*["']?(?!["']?\s*$)(?![<$({]|your|example|changeme|replace|xxx|\.\.\.)[A-Za-z0-9:_/+=-]{20,}/ },
];

/** A file that may match a pattern, and why. Keep this empty unless a hit is a documented, public value. */
const ALLOW = new Map([]);

const isText = (buf) => !buf.subarray(0, 8000).includes(0);

test("no env file, key file or credentials file is tracked", () => {
  const hits = [];
  for (const path of TRACKED) for (const rule of FORBIDDEN_PATH) if (rule.test(path)) hits.push(`${path}: ${rule.kind}`);
  assert.deepEqual(hits, [], `Tracked files that should be ignored. Remove with git rm --cached and add to .gitignore.\n${hits.join("\n")}`);
});

test("no tracked file contains a key-shaped secret", () => {
  const hits = [];
  for (const path of TRACKED) {
    if (path === "pnpm-lock.yaml" || path === "tests/secrets.test.mjs") continue;
    let buf;
    try {
      buf = readFileSync(join(ROOT, path));
    } catch {
      continue;
    }
    if (buf.length > 5_000_000 || !isText(buf)) continue;
    const lines = buf.toString("utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { kind, re } of SECRET_PATTERNS) if (re.test(line) && !ALLOW.has(`${path}|${kind}`)) hits.push(`${path}:${i + 1}: ${kind}`);
    });
  }
  assert.deepEqual(hits, [], `Secret-shaped strings are tracked. Remove them and rotate the key; do not just delete the line.\n${hits.join("\n")}`);
});

test(".env.example sets no secret to a real-looking value", () => {
  const hits = [];
  for (const path of TRACKED.filter((p) => /\.env\.(example|sample|template)$/.test(p))) {
    readFileSync(join(ROOT, path), "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const m = /^([A-Z0-9_]*(KEY|SECRET|TOKEN|SEED|PASSWORD)[A-Z0-9_]*)=(.+)$/.exec(line);
        if (m && m[3].trim() !== "" && !/^(<.*>|your|example|changeme|replace|\.\.\.)/i.test(m[3].trim())) hits.push(`${path}:${i + 1}: ${m[1]} has a value`);
      });
  }
  assert.deepEqual(hits, [], `Templates must leave secrets empty.\n${hits.join("\n")}`);
});

test(".gitignore keeps env, key and credential files out", () => {
  const ignored = (p) => {
    try {
      git("check-ignore", "-q", "--no-index", p);
      return true;
    } catch {
      return false;
    }
  };
  const mustIgnore = [".env", ".env.local", ".env.production", "apps/web/.env", "services/api/.env.local", "id_rsa", "server.pem", "wallet.key", "credentials.json", ".near-credentials/testnet/a.json", ".wardline/testnet/signers.json"];
  const missing = mustIgnore.filter((p) => !ignored(p));
  assert.deepEqual(missing, [], `Not ignored by .gitignore: ${missing.join(", ")}`);
  assert.equal(ignored(".env.example"), false, ".env.example must stay tracked");
});
