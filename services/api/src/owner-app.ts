import { AccountIdSchema } from "@redline/schemas";
import { InvalidPayeeInputError, normalizeAccount, parseAccount } from "@redline/sdk";
import { Hono } from "hono";
import { z } from "zod";
import {
  API_KEY_SCOPES,
  clearSessionCookie,
  createApiKey,
  createSession,
  issueChallenge,
  OWNER_LOGIN_RECIPIENT,
  requireOwner,
  requireSession,
  roleOf,
  sessionToken,
  setSessionCookie,
  sha256Hex,
  type OwnerVariables,
} from "./auth.js";
import { VAULT_A } from "./mock/seed.js";
import { verifyNep413 } from "./payee/proofs.js";
import { ownerPay, processIntake, rejectReview, type Deps, type ServiceResult } from "./service.js";
import { historyView, invoiceDetail, invoiceList, reviewQueue } from "./views.js";

const IntakeBodySchema = z.object({
  vault_id: AccountIdSchema.default(VAULT_A),
  source_text: z.string().min(1).max(20_000),
  attachments_note: z.string().max(2_000).nullable().default(null),
});
const VaultBodySchema = z.object({ vault_id: AccountIdSchema.default(VAULT_A) });
const ChallengeBody = z.object({ account: z.string().min(2).max(160) });
const LoginBody = z.object({ account: z.string().min(2).max(160), publicKey: z.string().max(128), signature: z.string().max(256), nonce: z.string().max(64) });
const ApiKeyBody = z.object({
  payer: z.string().min(1).max(128),
  label: z.string().max(120).optional(),
  callsPerDay: z.number().int().positive().max(10_000_000).optional(),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).optional(),
});
const ApproveBody = z.object({ payer: z.string().min(1).max(128), account: z.string().min(3).max(160) });

const notFound = { error: "NOT_FOUND", message: "Not found." };
const unknownVault = { error: "UNKNOWN_VAULT", message: "No such vault." };
const badJson = { error: "BAD_REQUEST", message: "Request body must be JSON." };
const loginFailed = { error: "LOGIN_FAILED", message: "This challenge cannot be used to sign in." };

/**
 * Everything that changes vault or review state, plus the private dashboard reads. Mounted at
 * /owner, or served on its own port. Every route but sign-in needs a session.
 */
export function createOwnerApp(deps: Deps): Hono<{ Variables: OwnerVariables }> {
  const app = new Hono<{ Variables: OwnerVariables }>();
  const { store, auth } = deps;
  const nowMs = () => deps.payee.nowDate().getTime();
  const vaultExists = (id: string): boolean => deps.world.vaults.has(id);

  app.onError((error, c) => {
    if (error instanceof InvalidPayeeInputError) return c.json({ error: "BAD_REQUEST", message: error.message }, 400);
    console.error(error);
    return c.json({ error: "INTERNAL", message: "Internal error." }, 500);
  });

  // Sign-in: a NEP-413 challenge from a listed owner or approver account.

  app.post("/auth/challenge", async (c) => {
    const body = ChallengeBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(badJson, 400);
    const account = parseAccount(body.data.account, auth.network).address;
    return c.json(issueChallenge(store, account, nowMs()));
  });

  app.post("/auth/login", async (c) => {
    const body = LoginBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(badJson, 400);
    // Spent before any other check, so a challenge never gets a second try.
    const challenge = store.consumeChallenge(body.data.nonce, nowMs());
    const account = parseAccount(body.data.account, auth.network).address;
    if (!challenge || challenge.account !== account) return c.json(loginFailed, 401);
    const role = roleOf(auth, account);
    if (!role) return c.json(loginFailed, 401);
    let nonce: Uint8Array;
    try {
      nonce = Uint8Array.from(Buffer.from(body.data.nonce, "base64"));
    } catch {
      return c.json(loginFailed, 401);
    }
    const reason = await verifyNep413(
      { network: auth.network, accountId: account, publicKey: body.data.publicKey, signature: body.data.signature, nonce, message: challenge.message, recipient: OWNER_LOGIN_RECIPIENT },
      deps.payee.lookupKeys,
    ).catch(() => "The account's keys could not be read.");
    if (reason) return c.json({ ...loginFailed, message: reason }, 401);
    const session = createSession(store, auth, account, role, nowMs());
    setSessionCookie(c, auth, session.token);
    return c.json(session);
  });

  app.post("/auth/logout", (c) => {
    const token = sessionToken(c);
    if (token) store.deleteSession(sha256Hex(token));
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.use("*", requireSession(store, auth, nowMs));

  app.get("/auth/session", (c) => c.json(c.get("session")));

  // Dashboard reads.

  app.get("/invoices", async (c) => c.json(await invoiceList(deps)));

  app.get("/invoices/:id", async (c) => {
    const detail = await invoiceDetail(deps, c.req.param("id"));
    return detail ? c.json(detail) : c.json(notFound, 404);
  });

  app.get("/review-queue", async (c) => c.json(await reviewQueue(deps)));

  app.get("/history", async (c) => {
    const vaultId = c.req.query("vault_id") ?? VAULT_A;
    if (!vaultExists(vaultId)) return c.json(unknownVault, 404);
    return c.json(await historyView(deps, vaultId));
  });

  app.get("/agent/simulation", (c) => c.json({ enabled: !!deps.gateways.demo, compromised: deps.gateways.demo?.compromised ?? false }));

  // State changes.

  const reviewResponse = async (result: ServiceResult) => {
    if (result.ok) return { body: { ok: true, queue: await reviewQueue(deps) }, status: 200 as const };
    const { status, error, message, rejection } = result;
    return { body: rejection === undefined ? { error, message } : { error, message, rejection }, status };
  };

  app.post("/intake", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return c.json(badJson, 400);
    const body = IntakeBodySchema.safeParse(raw);
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    if (!vaultExists(body.data.vault_id)) return c.json(unknownVault, 404);
    const intakeRef = await processIntake(deps, body.data);
    return c.json(await invoiceDetail(deps, intakeRef), 201);
  });

  app.post("/review/:id/owner-pay", async (c) => {
    const { body, status } = await reviewResponse(await ownerPay(deps, c.req.param("id")));
    return c.json(body, status);
  });

  app.post("/review/:id/reject", async (c) => {
    const { body, status } = await reviewResponse(rejectReview(deps, c.req.param("id")));
    return c.json(body, status);
  });

  // Pausing only stops the agent, so an approver may do it. Unpausing needs an owner.
  app.post("/vault/pause", async (c) => {
    const body = VaultBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    if (!vaultExists(body.data.vault_id)) return c.json(unknownVault, 404);
    await deps.gateways.vault.pause(body.data.vault_id);
    deps.store.addHistory("INCIDENT", deps.now().toString(), `${c.get("session").account} paused vault ${body.data.vault_id}.`);
    return c.json({ ok: true, policy: await deps.gateways.vault.getPolicy(body.data.vault_id) });
  });

  app.post("/vault/unpause", requireOwner(), async (c) => {
    const body = VaultBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    if (!vaultExists(body.data.vault_id)) return c.json(unknownVault, 404);
    const vaultGateway = deps.gateways.vault as unknown as { unpause?(id: string): Promise<void> };
    if (typeof vaultGateway.unpause === "function") await vaultGateway.unpause(body.data.vault_id);
    deps.store.addHistory("INCIDENT", deps.now().toString(), `${c.get("session").account} unpaused vault ${body.data.vault_id}.`);
    return c.json({ ok: true, policy: await deps.gateways.vault.getPolicy(body.data.vault_id) });
  });

  app.post("/agent/simulation", requireOwner(), async (c) => {
    if (!deps.gateways.demo) return c.json(notFound, 404);
    const body = z.object({ compromised: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(badJson, 400);
    deps.gateways.demo.setCompromised(body.data.compromised);
    deps.store.addHistory("INCIDENT", deps.now().toString(), `Simulated agent compromise ${body.data.compromised ? "enabled" : "disabled"}.`);
    return c.json({ enabled: true, compromised: deps.gateways.demo.compromised });
  });

  // API keys for /v1. Each key acts for exactly one payer.

  app.get("/api-keys", requireOwner(), (c) => c.json({ keys: store.listApiKeys() }));

  app.post("/api-keys", requireOwner(), async (c) => {
    const body = ApiKeyBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    const created = createApiKey(store, {
      payer: body.data.payer,
      label: body.data.label ?? null,
      callsPerDay: body.data.callsPerDay ?? auth.keyCallsPerDay,
      scopes: body.data.scopes ?? ["check"],
      createdBy: c.get("session").account,
      createdAt: deps.payee.nowDate().toISOString(),
    });
    return c.json({ ...created, note: "Store this key now. Only its hash is kept." }, 201);
  });

  app.post("/api-keys/:id/revoke", requireOwner(), (c) =>
    store.revokeApiKey(c.req.param("id"), deps.payee.nowDate().toISOString()) ? c.json({ ok: true }) : c.json(notFound, 404),
  );

  // A payer's owner approves an account it will pay. Raises that pair to T3_RELATIONSHIP.
  app.post("/payees/approve", async (c) => {
    const body = ApproveBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    const account = normalizeAccount(body.data.account, auth.network);
    const vendor = await deps.payee.context.registry.findByAccount(account);
    const entry = vendor?.accounts.find((a) => a.account === account);
    if (!vendor || entry?.status !== "active") {
      return c.json({ error: "NOT_APPROVABLE", message: "Only an active, domain-linked account can be approved, after its cooling-off period." }, 409);
    }
    store.approvePayee({ payer: body.data.payer, account, approvedBy: c.get("session").account, approvedAt: deps.payee.nowDate().toISOString() });
    return c.json({ ok: true, payer: body.data.payer, account, domain: vendor.domain }, 201);
  });

  return app;
}
