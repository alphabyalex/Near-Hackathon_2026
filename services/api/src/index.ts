import { serve } from "@hono/node-server";
import { loadRepoEnv } from "@wardline/agent";
import { createApp, OWNER_PREFIX } from "./app.js";
import { ownerAuthFromEnv } from "./auth.js";
import { GROUP_BUDGET } from "./chain/index.js";
import { bootstrap } from "./bootstrap.js";
import { createOwnerApp } from "./owner-app.js";
import { ensureAttestorKey } from "./payee/attestor.js";
import { loadPayeeBackends } from "./payee/runtime.js";
import { serverConfigFromEnv } from "./server-config.js";

loadRepoEnv();
ensureAttestorKey();
const backends = await loadPayeeBackends();
const auth = ownerAuthFromEnv();
const config = serverConfigFromEnv(process.env, auth);
const deps = bootstrap(process.env.API_DB_PATH ?? ":memory:", undefined, backends, auth);
// Local walkthroughs only: sim mode can print meter keys for the seeded group, so the README works without the UI.
if (deps.ai.chain.mode === "sim" && process.env.WARDLINE_SEED_METER_KEYS === "true") {
  for (const member of ["alice.testnet", "ci-agent.testnet"]) {
    const { key } = deps.ai.meter.createKey({ budgetId: GROUP_BUDGET, member, label: "local walkthrough", models: null, createdBy: "seed", now: new Date() });
    console.log(`Meter key for ${member} (${GROUP_BUDGET}, sim): ${key}`);
  }
}
// Local walkthroughs only: a fixed meter key for alice.testnet, so README commands need no copying. Sim mode only.
const demoKey = process.env.WARDLINE_DEMO_METER_KEY;
if (demoKey) {
  if (deps.ai.chain.mode !== "sim") throw new Error("WARDLINE_DEMO_METER_KEY works in sim mode only.");
  deps.ai.meter.createKey({ budgetId: GROUP_BUDGET, member: "alice.testnet", label: "local walkthrough", models: null, createdBy: "seed", now: new Date(), key: demoKey });
  console.log(`Demo meter key for alice.testnet (${GROUP_BUDGET}, sim) is set from WARDLINE_DEMO_METER_KEY`);
}
const ownerAuth = auth.enabled ? `${auth.owners.size} owner(s), ${auth.approvers.size} approver(s)` : "auth off";

serve({ fetch: createApp(deps, { mountOwner: config.ownerPort === null }).fetch, port: config.port, hostname: config.host }, (info) => {
  const engine = process.env.WARDLINE_PAYEE_ENGINE ?? "stub";
  const registry = process.env.WARDLINE_REGISTRY_MODE ?? "memory";
  console.log(`Wardline API on http://${config.host}:${info.port} (payee engine ${engine}, registry ${registry}, chain ${deps.ai.chain.mode})`);
  console.log(`AI gateway at /v1/ai (${deps.ai.routes.providers.map((p) => `${p.id} ${p.baseUrl}`).join(", ")})`);
  if (config.ownerPort === null) console.log(`Owner routes at ${OWNER_PREFIX} (${ownerAuth})`);
});

if (config.ownerPort !== null) {
  serve({ fetch: createOwnerApp(deps).fetch, port: config.ownerPort, hostname: config.ownerHost }, (info) => {
    console.log(`Owner routes on http://${config.ownerHost}:${info.port} (${ownerAuth})`);
  });
}
