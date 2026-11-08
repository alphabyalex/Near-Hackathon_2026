#!/usr/bin/env node
import { createHttpServer, wardlineFromEnv } from "./index.js";

const port = Number(process.env.MCP_PORT ?? 8790);
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);

createHttpServer(wardlineFromEnv(), { allowedHosts }).listen(port, "127.0.0.1", () => {
  console.log(`Wardline MCP on http://127.0.0.1:${port}/mcp`);
});
