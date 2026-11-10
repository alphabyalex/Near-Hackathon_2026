import { InvalidPayeeInputError } from "@wardline/sdk";
import { Hono } from "hono";
import { VAULT_A } from "./mock/seed.js";
import { registerActivityRoutes } from "./activity/index.js";
import { registerLocalSigner } from "./local-signer.js";
import { aiOverview, isChainOutage, registerAiPublicRoutes } from "./ai-routes.js";
import { createMeterGateway } from "./meter/gateway.js";
import { toDateClock } from "./time.js";
import { createOwnerApp } from "./owner-app.js";
import { registerPayeeRoutes, type PublicVariables } from "./payee/routes.js";
import { bodyLimits, rateLimits, securityHeaders } from "./security.js";
import type { Deps } from "./service.js";
import { evaluationList, overviewView } from "./views.js";

const notFound = { error: "NOT_FOUND", message: "Not found." };
const unknownVault = { error: "UNKNOWN_VAULT", message: "No such vault." };

export const OWNER_PREFIX = "/owner";

/**
 * The public app: /v1, published evaluations and the vault overview the site shows. Owner routes
 * live in owner-app.ts. They are mounted at /owner here unless they run on their own port.
 */
export function createApp(deps: Deps, options: { mountOwner?: boolean; localSigner?: boolean } = {}): Hono<{ Variables: PublicVariables }> {
  const app = new Hono<{ Variables: PublicVariables }>();
  const vaultExists = (id: string): boolean => deps.world.vaults.has(id);

  app.use("*", securityHeaders(deps.ai.env));
  app.use("*", bodyLimits());
  app.use("*", rateLimits(deps.ai.env, () => Number(deps.now() / 1_000_000n)));

  // A chain RPC outage answers 503 with a stable code. Anything else unexpected is a plain 500 that reveals nothing.
  app.onError((error, c) => {
    if (error instanceof InvalidPayeeInputError) return c.json({ error: "BAD_REQUEST", message: error.message }, 400);
    if (isChainOutage(error)) return c.json({ error: "CHAIN_UNAVAILABLE", message: "The NEAR RPC is not answering. Nothing was sent or changed." }, 503);
    console.error(error);
    return c.json({ error: "INTERNAL", message: "Something failed on the server. Nothing was changed." }, 500);
  });

  registerPayeeRoutes(app, deps.payee, deps.store, deps.auth);

  // OpenAI-compatible, metered: pays for a model call only on a verified TEE proof.
  app.route(
    "/v1/ai",
    createMeterGateway({ store: deps.ai.meter, chain: deps.ai.chain, routes: deps.ai.routes, now: toDateClock(deps.now), env: deps.ai.env, ...(deps.ai.fetch ? { fetch: deps.ai.fetch } : {}), ...(deps.ai.gateway ? { options: deps.ai.gateway } : {}),
      spend: async (budgetId) => ({ budget: await deps.ai.chain.meter.getBudget(budgetId), spend: aiOverview(deps.ai.meter.listCalls(budgetId, 1000), toDateClock(deps.now)()) }),
    }),
  );

  registerAiPublicRoutes(app as never, deps);
  registerActivityRoutes(app as never, deps);
  // Only when index.ts checked every guard (local-signer.ts): loopback, WARDLINE_LOCAL_SIGNER=1, testnet.
  if (options.localSigner) registerLocalSigner(app as never, deps);

  app.get("/overview", async (c) => {
    const vaultId = c.req.query("vault_id") ?? VAULT_A;
    if (!vaultExists(vaultId)) return c.json(unknownVault, 404);
    return c.json(await overviewView(deps, vaultId));
  });

  app.get("/usage", async (c) => {
    const vaultId = c.req.query("vault_id") ?? VAULT_A;
    const vaultData = vaultExists(vaultId) ? await overviewView(deps, vaultId) : null;
    const calls = deps.ai.meter.listCalls(undefined, 1000);
    const ai = aiOverview(calls, toDateClock(deps.now)());
    return c.json({
      object: "usage",
      mode: deps.ai.chain.mode,
      ai,
      vault: vaultData
        ? {
            vault_id: vaultData.vault_id,
            usage: vaultData.usage,
            policy: vaultData.policy,
            headroom: vaultData.headroom,
          }
        : null,
    });
  });

  app.get("/evaluations", async (c) => c.json(await evaluationList(deps)));

  app.get("/evaluations/:id", async (c) => {
    const id = c.req.param("id");
    const report = await deps.gateways.evidence.getReport(id);
    if (!report) return c.json(notFound, 404);
    return c.json({ report, verification: await deps.gateways.evidence.verifyReport(id) });
  });

  if (options.mountOwner ?? true) app.route(OWNER_PREFIX, createOwnerApp(deps));

  return app;
}
