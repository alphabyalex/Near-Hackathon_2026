/**
 * The only door to live NEAR AI Cloud for recording fixtures. Every request is counted in
 * fixtures/nearai/ledger.json, and the 31st is refused. The API key is read from .env and never
 * printed or written anywhere.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURES = join(REPO, "fixtures", "nearai");
const LEDGER = join(FIXTURES, "ledger.json");
export const LIVE_CALL_LIMIT = 30;
export const NEAR_AI_BASE = "https://cloud-api.near.ai/v1";

interface LedgerEntry {
  n: number;
  at: string;
  method: string;
  path: string;
  purpose: string;
  status: number | null;
}

export function readLedger(): LedgerEntry[] {
  return existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, "utf8")) as { calls: LedgerEntry[] }).calls : [];
}

function apiKey(): string {
  const env = join(REPO, ".env");
  if (!process.env.NEAR_AI_API_KEY && existsSync(env)) process.loadEnvFile(env);
  const key = process.env.NEAR_AI_API_KEY;
  if (!key) throw new Error("NEAR_AI_API_KEY is not set in .env");
  return key;
}

/** One counted live request. Returns status, headers and the exact body bytes. */
export async function liveFetch(path: string, init: { method?: string; body?: Uint8Array; headers?: Record<string, string> }, purpose: string) {
  const calls = readLedger();
  if (calls.length >= LIVE_CALL_LIMIT) throw new Error(`Live NEAR AI budget used up (${calls.length} of ${LIVE_CALL_LIMIT}). Use fixtures.`);
  const method = init.method ?? "GET";
  const entry: LedgerEntry = { n: calls.length + 1, at: new Date().toISOString(), method, path: path.replace(/\?.*$/, ""), purpose, status: null };
  mkdirSync(FIXTURES, { recursive: true });
  try {
    const res = await fetch(`${NEAR_AI_BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey()}`, accept: "application/json", "accept-encoding": "identity", ...init.headers },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(90_000),
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    entry.status = res.status;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k === "content-type" || k.startsWith("x-request") || k === "date") headers[k] = v;
    });
    return { status: res.status, headers, bytes };
  } finally {
    writeFileSync(LEDGER, `${JSON.stringify({ limit: LIVE_CALL_LIMIT, calls: [...calls, entry] }, null, 2)}\n`);
    console.log(`live NEAR AI call ${entry.n} of ${LIVE_CALL_LIMIT}: ${method} ${entry.path} -> ${entry.status}`);
  }
}
