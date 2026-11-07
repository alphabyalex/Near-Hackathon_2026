import { serve } from "@hono/node-server";
import { loadRepoEnv } from "@redline/agent";
import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { ensureAttestorKey } from "./payee/attestor.js";
import { loadPayeeBackends } from "./payee/runtime.js";

loadRepoEnv();
ensureAttestorKey();
const backends = await loadPayeeBackends();

const port = Number(process.env.API_PORT ?? 8787);
const dbPath = process.env.API_DB_PATH ?? ":memory:";

// Localhost only: the API has no authentication yet.
serve({ fetch: createApp(bootstrap(dbPath, undefined, backends)).fetch, port, hostname: "127.0.0.1" }, (info) => {
  const engine = process.env.REDLINE_PAYEE_ENGINE ?? "stub";
  const registry = process.env.REDLINE_REGISTRY_MODE ?? "memory";
  console.log(`Redline API on http://127.0.0.1:${info.port} (payee engine ${engine}, registry ${registry})`);
});
