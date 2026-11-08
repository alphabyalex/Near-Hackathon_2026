/**
 * Records real NEAR AI Cloud traffic once into fixtures/nearai/, so tests and demos run offline.
 * Every request goes through liveFetch, which counts it against the 30-call budget.
 *
 *   tsx scripts/nearai/record.ts complete <name> <model> "<prompt>" [max_tokens]
 *   tsx scripts/nearai/record.ts attest <model>
 *   tsx scripts/nearai/record.ts verify <name>        (offline: re-checks a recorded fixture)
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex, verifyProviderProof, type ProviderSignature } from "../../packages/sdk/src/proof.ts";
import { FIXTURES, liveFetch, readLedger } from "./live.ts";

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8");
const slug = (model: string): string => model.replace(/[^a-zA-Z0-9.-]+/g, "_");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NearAiFixture {
  schema: "wardline-nearai-fixture-v1";
  name: string;
  model: string;
  recorded_at: string;
  request: { body_b64: string; sha256: string };
  response: { status: number; content_type: string; body_b64: string; sha256: string; chat_id: string | null };
  signature: { status: number; body_b64: string; tries: number } | null;
}

async function complete(name: string, model: string, prompt: string, maxTokens: number) {
  // Serialized once. These exact bytes are hashed, sent and stored.
  const requestBytes = new TextEncoder().encode(JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 }));
  const res = await liveFetch("/chat/completions", { method: "POST", body: requestBytes, headers: { "content-type": "application/json", "x-no-aliasing": "true" } }, `completion ${name}`);
  const chatId = res.status === 200 ? ((JSON.parse(text(res.bytes)) as { id?: string }).id ?? null) : null;
  const fixture: NearAiFixture = {
    schema: "wardline-nearai-fixture-v1",
    name,
    model,
    recorded_at: new Date().toISOString(),
    request: { body_b64: b64(requestBytes), sha256: sha256Hex(requestBytes) },
    response: { status: res.status, content_type: res.headers["content-type"] ?? "", body_b64: b64(res.bytes), sha256: sha256Hex(res.bytes), chat_id: chatId },
    signature: null,
  };
  if (chatId) {
    await sleep(2500);
    for (let tries = 1; tries <= 3; tries++) {
      const sig = await liveFetch(`/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`, {}, `signature for ${name} (try ${tries})`);
      fixture.signature = { status: sig.status, body_b64: b64(sig.bytes), tries };
      if (sig.status !== 404) break;
      await sleep(3000);
    }
  }
  writeFileSync(join(FIXTURES, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  if (res.status !== 200) console.log(text(res.bytes).slice(0, 300));
  await check(name);
}

async function attest(model: string) {
  const nonce = randomBytes(32).toString("hex");
  const res = await liveFetch(`/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`, {}, `attestation report for ${model}`);
  const file = join(FIXTURES, `attestation-${slug(model)}.json`);
  writeFileSync(file, `${JSON.stringify({ schema: "wardline-nearai-attestation-v1", model, nonce, recorded_at: new Date().toISOString(), status: res.status, body_b64: b64(res.bytes) }, null, 2)}\n`);
  const report = JSON.parse(text(res.bytes)) as { model_attestations?: { signing_address?: string; signing_algo?: string }[]; signing_address?: string };
  const addresses = (report.model_attestations ?? []).map((a) => `${a.signing_address} (${a.signing_algo ?? "?"})`);
  console.log(`model attestations for ${model}: ${addresses.length ? addresses.join(", ") : "none"}`);
  console.log(`top-level keys: ${Object.keys(report).join(", ")}`);
}

/** Re-checks a recorded fixture offline against every attested signer recorded for its model. */
async function check(name: string) {
  const f = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as NearAiFixture;
  const sig = f.signature && f.signature.status === 200 ? (JSON.parse(Buffer.from(f.signature.body_b64, "base64").toString("utf8")) as ProviderSignature) : null;
  console.log(`${name}: response ${f.response.status}, chat ${f.response.chat_id}, signature ${f.signature?.status ?? "none"} kind ${sig?.signature_kind ?? "?"}`);
  if (sig) console.log(`  text: ${sig.text}\n  signer: ${sig.signing_address}`);
  const result = await verifyProviderProof({ model: f.model, requestHash: f.request.sha256, responseHash: f.response.sha256, signature: sig, isAttested: () => true });
  console.log(`  local check (attestation not yet applied): ${result.ok ? "ok" : `${result.problem}: ${result.detail}`}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "complete") await complete(args[0]!, args[1]!, args[2]!, Number(args[3] ?? 400));
else if (cmd === "attest") await attest(args[0]!);
else if (cmd === "verify") await check(args[0]!);
else console.log("usage: complete <name> <model> <prompt> [max_tokens] | attest <model> | verify <name>");
console.log(`live NEAR AI calls used so far: ${readLedger().length}`);
