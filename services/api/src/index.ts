import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";

const port = Number(process.env.API_PORT ?? 8787);
const dbPath = process.env.API_DB_PATH ?? ":memory:";

// Localhost only: the API has no authentication yet.
serve({ fetch: createApp(bootstrap(dbPath)).fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Redline API on http://127.0.0.1:${info.port} (mock gateways)`);
});
