/**
 * The API for end-to-end tests: real routes and auth, the stub engine and memory registry, with
 * NEAR key lookups and vendor website fetches answered locally. Never use outside tests.
 */
import { serve } from "@hono/node-server";
import { createReplayProvider, createSimTee, demoBaseUrl, demoFetch, loadRecording, RECORDED, SIM_MODEL } from "@wardline/demo-provider";
import { createApp } from "../../../services/api/src/app.js";
import { ownerAuthFromEnv } from "../../../services/api/src/auth.js";
import { bootstrap } from "../../../services/api/src/bootstrap.js";
import type { NearKeyLookup } from "../../../services/api/src/payee/proofs.js";
import type { WellKnownFetcher } from "../../../services/api/src/payee/well-known.js";
import { API_PORT, APPROVER_ACCOUNT, NEAR_ACCOUNTS, nearPublicKey, OWNER_ACCOUNT, REQUESTER_ACCOUNT } from "./keys.js";

const hosted = new Map<string, Uint8Array>();

const lookupKeys: NearKeyLookup = async (_network, accountId) =>
  NEAR_ACCOUNTS.includes(accountId) ? [{ publicKey: nearPublicKey(accountId), fullAccess: true }] : [];

const fetchFile: WellKnownFetcher = async (domain, path) => {
  const body = path === "/.well-known/wardline-payee.json" ? hosted.get(domain) : undefined;
  return body ? { status: 200, body } : { status: 404, body: new Uint8Array() };
};

const auth = ownerAuthFromEnv({
  NEAR_NETWORK: "testnet",
  WARDLINE_OWNER_ACCOUNTS: OWNER_ACCOUNT,
  WARDLINE_APPROVER_ACCOUNTS: `${APPROVER_ACCOUNT},${REQUESTER_ACCOUNT}`,
});

// Metered AI calls go to the offline demo providers: recorded NEAR AI traffic and the local test TEE.
const deps = bootstrap(":memory:", undefined, { lookupKeys, fetchFile, freeCallsPerDay: 1_000_000 }, auth, {
  env: { WARDLINE_CHAIN_MODE: "sim" },
  routes: {
    providers: [
      { id: "nearai", baseUrl: demoBaseUrl("replay"), payTo: "nearai.testnet" },
      { id: "simtee", baseUrl: demoBaseUrl("simtee"), payTo: "sim-provider.testnet" },
    ],
    models: [
      { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", provider: "nearai", label: "DeepSeek V4.1 Flash", inputPerM: 300_000, outputPerM: 1_200_000, defaultMaxTokens: 1024 },
      { id: "z-ai/glm-5.3-flash", provider: "nearai", label: "GLM-5.3 Flash", inputPerM: 80_000, outputPerM: 500_000, defaultMaxTokens: 1024 },
      { id: "z-ai/glm-5.3", provider: "nearai", label: "GLM-5.3", inputPerM: 1_800_000, outputPerM: 5_750_000, defaultMaxTokens: 1024 },
      { id: SIM_MODEL, provider: "simtee", label: "Sim Echo (local test TEE)", inputPerM: 0, outputPerM: 0, perCall: 2_000, defaultMaxTokens: 256 },
    ],
  },
  fetch: demoFetch({ replay: createReplayProvider(), simtee: createSimTee() }),
  gateway: { signatureDelaysMs: [0, 0] },
});
const app = createApp(deps);

// Test hook: "host" a wardline-payee.json on a domain, as the vendor would on its website.
app.post("/__e2e/host", async (c) => {
  const { domain, file } = (await c.req.json()) as { domain: string; file: string };
  hosted.set(domain, new TextEncoder().encode(file));
  return c.json({ ok: true });
});

// A few real metered calls, so the group page and dashboard have something to show.
const call = async (member: string, body: unknown) => {
  const { key } = deps.ai.meter.createKey({ budgetId: "bgt_aurora", member, label: "e2e seed", models: null, createdBy: "seed", now: new Date() });
  await app.request("/v1/ai/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
};
const recorded = (name: string) => JSON.parse(Buffer.from(loadRecording(name).requestBytes).toString("utf8")) as unknown;
await call("alice.testnet", recorded(RECORDED.expensive));
await call("alice.testnet", recorded(RECORDED.cheap));
await call("bob.testnet", recorded(RECORDED.gatewayOnly));
for (let i = 0; i < 3; i++) await call("ci-agent.testnet", { model: SIM_MODEL, messages: [{ role: "user", content: `nightly eval ${i}` }] });
for (const k of deps.ai.meter.listKeys()) deps.ai.meter.revokeKey(k.id, new Date());

serve({ fetch: app.fetch, port: API_PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`e2e stub API on http://127.0.0.1:${info.port}`);
});
