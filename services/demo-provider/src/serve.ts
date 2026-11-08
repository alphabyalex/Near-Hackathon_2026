#!/usr/bin/env node
/**
 * Serves the demo upstreams over HTTP on localhost, for pointing a local gateway at them:
 *   http://127.0.0.1:8791/replay/v1   recorded NEAR AI traffic
 *   http://127.0.0.1:8791/cheapai/v1  claims the expensive model, serves the cheap one
 *   http://127.0.0.1:8791/simtee/v1   local test TEE
 * Offline only. Nothing here calls NEAR AI.
 */
import { serve } from "@hono/node-server";
import { createCheapAi, createReplayProvider, createSimTee, type Handler } from "./providers.js";

const port = Number(process.env.DEMO_PROVIDER_PORT ?? 8791);
const handlers: Record<string, Handler> = {
  replay: createReplayProvider(),
  cheapai: createCheapAi((process.env.CHEAPAI_MODE as "wrong-model" | "no-signature" | "canned" | undefined) ?? "wrong-model"),
  simtee: createSimTee(),
};

serve({ port, hostname: "127.0.0.1", fetch: (req: Request) => {
  const name = new URL(req.url).pathname.split("/")[1] ?? "";
  const handler = handlers[name];
  return handler ? handler(req) : new Response("Unknown provider. Use /replay, /cheapai or /simtee.", { status: 404 });
} }, (info) => console.log(`Demo providers on http://127.0.0.1:${info.port}/{replay,cheapai,simtee}/v1`));
