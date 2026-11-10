/**
 * The one-line plug-in: the official OpenAI client, with only its base URL changed, makes a paid
 * model call through a running Wardline API. Then the SDK re-checks the call's TEE proof locally.
 *
 *   pnpm demo:plugin        needs the API from README step 2 (WARDLINE_API_PORT, WARDLINE_DEMO_METER_KEY)
 */
import OpenAI from "openai";
import { createWardline, readEnv } from "@wardline/sdk";

const port = readEnv("WARDLINE_API_PORT") ?? "8787";
const baseUrl = readEnv("WARDLINE_API_URL") ?? `http://127.0.0.1:${port}`;
const meterKey = readEnv("WARDLINE_METER_KEY") ?? readEnv("WARDLINE_DEMO_METER_KEY") ?? "wk_demo_alice_key";

// The one line: baseURL points at Wardline instead of the provider.
const client = new OpenAI({ baseURL: `${baseUrl}/v1/ai`, apiKey: meterKey });

// The exact request recorded from NEAR AI Cloud in fixtures/nearai/deepseek-plugin.json.
const sent = await client.chat.completions
  .create({ model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", messages: [{ role: "user", content: "In one sentence, why should an AI agent verify who it is paying?" }], max_tokens: 600, temperature: 0 })
  .withResponse()
  .catch((err: unknown) => {
    // A refusal is an answer, not a crash: print its code and Wardline's message, then exit 1.
    if (!(err instanceof OpenAI.APIError)) throw err;
    console.log(`Refused:        HTTP ${err.status}, ${err.code ?? "no code"}. ${err.message.replace(/^\d+\s+/, "")}`);
    process.exit(1);
  });
const { data, response } = sent;

const usdc = (a: string | null) => (Number(BigInt(a ?? "0")) / 1e6).toFixed(6);
console.log(`Reply:          ${data.choices[0]?.message.content?.slice(0, 120)}`);
console.log(`Proof:          ${response.headers.get("x-wardline-proof")}`);
console.log(`Model proven:   ${response.headers.get("x-wardline-model-proven")}`);
console.log(`Paid:           ${usdc(response.headers.get("x-wardline-amount"))} USDC, refunded ${usdc(response.headers.get("x-wardline-refund"))}`);
console.log(`Settlement:     ${response.headers.get("x-wardline-settlement")}`);

const wardline = createWardline({ mode: "hosted", baseUrl, meterKey });
const call = await wardline.getCall(response.headers.get("x-wardline-call")!);
const check = await wardline.verifyProof(call);
console.log(`Local re-check: ${check.ok ? `valid, signed by ${check.signer}` : `failed: ${check.problem}`}`);
if (!check.ok || response.headers.get("x-wardline-proof") !== "verified") process.exitCode = 1;
