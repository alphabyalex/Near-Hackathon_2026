import { AccountIdSchema } from "@redline/schemas";
import { Hono } from "hono";
import { z } from "zod";
import { VAULT_A } from "./mock/seed.js";
import { registerPayeeRoutes } from "./payee/routes.js";
import { ownerPay, processIntake,rejectReview, type Deps, type ServiceResult } from "./service.js";
import { evaluationList, historyView, invoiceDetail, invoiceList, overviewView, reviewQueue } from "./views.js";

const IntakeBodySchema = z.object({
  vault_id: AccountIdSchema.default(VAULT_A),
  source_text: z.string().min(1).max(20_000),
  attachments_note: z.string().max(2_000).nullable().default(null),
});

const PauseBodySchema = z.object({ vault_id: AccountIdSchema.default(VAULT_A) });

const notFound = { error: "NOT_FOUND", message: "Not found." };
const unknownVault = { error: "UNKNOWN_VAULT", message: "No such vault." };
const badJson = { error: "BAD_REQUEST", message: "Request body must be JSON." };

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  const vaultExists = (id: string): boolean => deps.world.vaults.has(id);

  const reviewResponse = async (result: ServiceResult) => {
    if (result.ok) return { body: { ok: true, queue: await reviewQueue(deps) }, status: 200 as const };
    const { status, error, message, rejection } = result;
    return { body: rejection === undefined ? { error, message } : { error, message, rejection }, status };
  };

  registerPayeeRoutes(app, deps.payee, deps.store);

  app.get("/overview", async (c) => {
    const vaultId = c.req.query("vault_id") ?? VAULT_A;
    if (!vaultExists(vaultId)) return c.json(unknownVault, 404);
    return c.json(await overviewView(deps, vaultId));
  });

  app.get("/invoices", async (c) => c.json(await invoiceList(deps)));

  app.get("/invoices/:id", async (c) => {
    const detail = await invoiceDetail(deps, c.req.param("id"));
    return detail ? c.json(detail) : c.json(notFound, 404);
  });

  app.post("/intake", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return c.json(badJson, 400);
    const body = IntakeBodySchema.safeParse(raw);
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    if (!vaultExists(body.data.vault_id)) return c.json(unknownVault, 404);
    const intakeRef = await processIntake(deps, body.data);
    return c.json(await invoiceDetail(deps, intakeRef), 201);
  });

  app.get("/review-queue", async (c) => c.json(await reviewQueue(deps)));

  app.post("/review/:id/owner-pay", async (c) => {
    const { body, status } = await reviewResponse(await ownerPay(deps, c.req.param("id")));
    return c.json(body, status);
  });

  app.post("/review/:id/reject", async (c) => {
    const { body, status } = await reviewResponse(rejectReview(deps, c.req.param("id")));
    return c.json(body, status);
  });

  app.get("/evaluations", async (c) => c.json(await evaluationList(deps)));

  app.get("/evaluations/:id", async (c) => {
    const id = c.req.param("id");
    const report = await deps.gateways.evidence.getReport(id);
    if (!report) return c.json(notFound, 404);
    return c.json({ report, verification: await deps.gateways.evidence.verifyReport(id) });
  });

  app.get("/history", async (c) => {
    const vaultId = c.req.query("vault_id") ?? VAULT_A;
    if (!vaultExists(vaultId)) return c.json(unknownVault, 404);
    return c.json(await historyView(deps, vaultId));
  });

  app.post("/vault/pause", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const body = PauseBodySchema.safeParse(raw);
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    if (!vaultExists(body.data.vault_id)) return c.json(unknownVault, 404);
    await deps.gateways.vault.pause(body.data.vault_id);
    deps.store.addHistory("INCIDENT", deps.now().toString(), `Owner paused vault ${body.data.vault_id}.`);
    return c.json({ ok: true, policy: await deps.gateways.vault.getPolicy(body.data.vault_id) });
  });

  app.post("/vault/unpause", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const body = PauseBodySchema.safeParse(raw);
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    if (!vaultExists(body.data.vault_id)) return c.json(unknownVault, 404);
    const vaultGateway = deps.gateways.vault as unknown as { unpause?(id: string): Promise<void> };
    if (typeof vaultGateway.unpause === "function") {
      await vaultGateway.unpause(body.data.vault_id);
    }
    deps.store.addHistory("INCIDENT", deps.now().toString(), `Owner unpaused vault ${body.data.vault_id}.`);
    return c.json({ ok: true, policy: await deps.gateways.vault.getPolicy(body.data.vault_id) });
  });

  return app;
}
