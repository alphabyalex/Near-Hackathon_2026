import { serve } from "@hono/node-server";
import { loadRepoEnv } from "@wardline/agent";
import { createApp, OWNER_PREFIX } from "./app.js";
import { ownerAuthFromEnv } from "./auth.js";
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
const ownerAuth = auth.enabled ? `${auth.owners.size} owner(s), ${auth.approvers.size} approver(s)` : "auth off";

serve({ fetch: createApp(deps, { mountOwner: config.ownerPort === null }).fetch, port: config.port, hostname: config.host }, (info) => {
  const engine = process.env.WARDLINE_PAYEE_ENGINE ?? "stub";
  const registry = process.env.WARDLINE_REGISTRY_MODE ?? "memory";
  console.log(`Wardline API on http://${config.host}:${info.port} (payee engine ${engine}, registry ${registry})`);
  if (config.ownerPort === null) console.log(`Owner routes at ${OWNER_PREFIX} (${ownerAuth})`);
});

if (config.ownerPort !== null) {
  serve({ fetch: createOwnerApp(deps).fetch, port: config.ownerPort, hostname: config.ownerHost }, (info) => {
    console.log(`Owner routes on http://${config.ownerHost}:${info.port} (${ownerAuth})`);
  });
}
