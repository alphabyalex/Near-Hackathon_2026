import { getConnInfo } from "@hono/node-server/conninfo";
import { PayeeCheckRequest, PayeeResolveRequest } from "@redline/schemas";
import { canonicalJson } from "@redline/agent";
import { InvalidPayeeInputError, normalizeAccount, normalizeDomain, parseAccount, type RegistryVendor } from "@redline/sdk";
import type { Context, Hono } from "hono";
import { apiKeyFrom, PAYMENT_RECORD_RECIPIENT, paymentRecordMessage, sha256Hex, SIGNED_REQUEST_WINDOW_MS, type OwnerAuthConfig } from "../auth.js";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Store } from "../store.js";
import { verifyNep413 } from "./proofs.js";
import type { PayeeRuntime } from "./runtime.js";
import { verifyVendor } from "./verify-vendor.js";
import { holdId } from "../review-desk.js";

const X402_PRICE_ATOMIC = "10000"; // 0.01 USDC, 6 decimals

const RecordBody = z.object({ payer: z.string().min(1).max(128), domain: z.string().max(253), account: z.string().min(3).max(160) });
const VerifyBody = z.object({ domain: z.string().max(253) });

const badRequest = (c: Context, message: string) => c.json({ error: "BAD_REQUEST", message }, 400);
const badJson = (c: Context) => badRequest(c, "Request body must be JSON.");

const vendorView = (vendor: RegistryVendor) => ({
  domain: vendor.domain,
  name: vendor.name,
  legalName: vendor.legalName,
  legalNameSource: vendor.legalName === null ? null : "vendor-claimed",
  verifiedAt: vendor.verifiedAt,
  evidenceHash: vendor.evidenceHash,
  accounts: vendor.accounts,
});

function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // The nearest proxy appends the real client last. Anything earlier is caller-supplied.
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

function paymentRequired(c: Context, runtime: PayeeRuntime) {
  const { payTo, network, asset } = runtime.x402;
  const body = {
    x402Version: 2,
    error: "FREE_TIER_EXCEEDED",
    message: `Free tier is ${runtime.freeCallsPerDay} calls per day. Further calls are 0.01 USDC each.`,
    resource: { url: c.req.url, description: "Redline payee check", mimeType: "application/json" },
    accepts: payTo
      ? [{ scheme: "exact", network, amount: X402_PRICE_ATOMIC, asset, payTo, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } }]
      : [],
    extensions: {},
  };
  c.header("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64"));
  return c.json(body, 402);
}

export interface PublicVariables {
  /** The payer an API key acts for, or null for an anonymous call. */
  apiKeyPayer: string | null;
  apiKeyScopes: readonly string[];
}

type PublicContext = Context<{ Variables: PublicVariables }>;

const forbiddenPayer = (c: Context) =>
  c.json({ error: "PAYER_NOT_AUTHORIZED", message: "A payer's history needs that payer's API key." }, 403);

/**
 * A payment record is accepted from that payer's API key, or with a NEP-413 signature by the payer's
 * NEAR account over the timestamp and canonical body. Headers: x-redline-public-key,
 * x-redline-signature, x-redline-nonce (32 bytes, base64) and x-redline-timestamp (ISO 8601).
 */
async function recordAuthorized(c: PublicContext, payer: string, body: unknown, runtime: PayeeRuntime, store: Store, auth: OwnerAuthConfig): Promise<Response | null> {
  const keyPayer = c.get("apiKeyPayer");
  if (keyPayer !== null) {
    if (keyPayer !== payer) return forbiddenPayer(c);
    if (!c.get("apiKeyScopes").includes("record")) {
      return c.json({ error: "SCOPE_REQUIRED", message: "This key cannot record payments. Ask an owner for a key with the record scope." }, 403);
    }
    return null;
  }
  const publicKey = c.req.header("x-redline-public-key");
  const signature = c.req.header("x-redline-signature");
  const nonceText = c.req.header("x-redline-nonce");
  const timestamp = c.req.header("x-redline-timestamp");
  if (!publicKey || !signature || !nonceText || !timestamp) {
    return c.json({ error: "UNAUTHORIZED", message: "Send the payer's API key, or sign the request with the payer's NEAR account." }, 401);
  }
  const unauthorized = (message: string) => c.json({ error: "UNAUTHORIZED", message }, 401);
  const now = runtime.nowDate().getTime();
  const at = Date.parse(timestamp);
  if (Number.isNaN(at) || Math.abs(now - at) > SIGNED_REQUEST_WINDOW_MS) return unauthorized("The signed timestamp is missing or outside 5 minutes.");
  const nonce = Uint8Array.from(Buffer.from(nonceText, "base64"));
  if (nonce.length !== 32) return unauthorized("The nonce must be 32 bytes.");
  let accountId: string;
  try {
    const parsed = parseAccount(payer, auth.network);
    if (parsed.namespace !== "near" || parsed.reference !== auth.network) return unauthorized("Only a NEAR payer on this network can sign.");
    accountId = parsed.address;
  } catch {
    return unauthorized("Only a NEAR payer account can sign.");
  }
  const reason = await verifyNep413(
    { network: auth.network, accountId, publicKey, signature, nonce, message: paymentRecordMessage(timestamp, canonicalJson(body)), recipient: PAYMENT_RECORD_RECIPIENT },
    runtime.lookupKeys,
  ).catch(() => "The payer's keys could not be read.");
  if (reason) return unauthorized(reason);
  if (!store.useNonce(sha256Hex(nonceText), at + 2 * SIGNED_REQUEST_WINDOW_MS, now)) return unauthorized("This signature was already used.");
  return null;
}

export function registerPayeeRoutes(app: Hono<{ Variables: PublicVariables }>, runtime: PayeeRuntime, store: Store, auth: OwnerAuthConfig): void {
  const { context, engine, attestor } = runtime;

  app.use("/v1/*", cors());
  app.use("/.well-known/redline-attestor.json", cors());

  app.use("/v1/*", async (c, next) => {
    c.set("apiKeyPayer", null);
    c.set("apiKeyScopes", []);
    if (c.req.method === "OPTIONS") return next();
    const day = runtime.nowDate().toISOString().slice(0, 10);
    const key = apiKeyFrom(c);
    if (key !== null) {
      // Keyed calls have their own daily limit, separate from the per-IP free tier.
      const found = store.findApiKey(sha256Hex(key));
      if (!found) return c.json({ error: "UNAUTHORIZED", message: "Unknown or revoked API key." }, 401);
      if (store.countKeyCall(found.id, day) > found.callsPerDay) {
        c.header("Retry-After", "86400");
        return c.json({ error: "API_KEY_LIMIT", message: `This key allows ${found.callsPerDay} calls per day.` }, 429);
      }
      c.set("apiKeyPayer", found.payer);
      c.set("apiKeyScopes", found.scopes);
      return next();
    }
    const calls = store.countCall(clientIp(c, runtime.trustProxy), day);
    if (calls > runtime.freeCallsPerDay) {
      // TODO(x402): when REDLINE_X402=on, accept a PAYMENT-SIGNATURE header here: verify and settle it
      // through a facilitator, then call next(). Until then every call over the limit gets this 402.
      return paymentRequired(c, runtime);
    }
    return next();
  });

  app.onError((error, c) => {
    if (error instanceof InvalidPayeeInputError) return badRequest(c, error.message);
    console.error(error);
    return c.json({ error: "INTERNAL", message: "Internal error." }, 500);
  });

  app.post("/v1/check", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return badJson(c);
    const body = PayeeCheckRequest.safeParse(raw);
    if (!body.success) return badRequest(c, z.prettifyError(body.error));
    if (body.data.payer !== undefined && c.get("apiKeyPayer") !== body.data.payer) return forbiddenPayer(c);
    const result = { ...(await engine.check(body.data, context)), receipt: null };
    const issuedAt = runtime.nowDate().toISOString();
    // A HOLD on a payer's key goes to that payer's Review Desk. Anonymous calls never reach it.
    const keyPayer = c.get("apiKeyPayer");
    if (result.verdict === "HOLD" && keyPayer !== null) {
      const domain = body.data.vendor?.domain ? normalizeDomain(body.data.vendor.domain) : (result.vendor?.domain ?? null);
      store.saveHold({
        id: holdId(keyPayer, result.payee, domain, issuedAt),
        payer: keyPayer,
        payee: result.payee,
        domain,
        vendorName: body.data.vendor?.name ?? result.vendor?.name ?? null,
        verdict: result.verdict,
        reasons: result.reasons,
        evidenceTier: result.evidenceTier ?? "T0_NONE",
        amount: body.data.amount ?? null,
        asset: body.data.asset ?? null,
        source: body.data.source ?? null,
        createdAt: issuedAt,
      });
    }
    return c.json({ ...result, receipt: attestor.issueReceipt(body.data, result, issuedAt) });
  });

  app.post("/v1/resolve", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return badJson(c);
    const body = PayeeResolveRequest.safeParse(raw);
    if (!body.success) return badRequest(c, z.prettifyError(body.error));
    if (body.data.payer !== undefined && c.get("apiKeyPayer") !== body.data.payer) return forbiddenPayer(c);
    const result = { ...(await engine.resolve(body.data, context)), receipt: null };
    return c.json({ ...result, receipt: attestor.issueReceipt(body.data, result, runtime.nowDate().toISOString()) });
  });

  app.post("/v1/payments/record", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return badJson(c);
    const body = RecordBody.safeParse(raw);
    if (!body.success) return badRequest(c, z.prettifyError(body.error));
    const denied = await recordAuthorized(c, body.data.payer, raw, runtime, store, auth);
    if (denied) return denied;
    const payment = {
      payer: body.data.payer,
      domain: normalizeDomain(body.data.domain),
      account: normalizeAccount(body.data.account, context.network),
    };
    await context.history.record(payment);
    return c.json({ ok: true, ...payment }, 201);
  });

  app.get("/v1/vendors", async (c) => c.json({ vendors: (await context.registry.listVendors()).map(vendorView) }));

  app.post("/v1/vendors/verify", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return badJson(c);
    const body = VerifyBody.safeParse(raw);
    if (!body.success) return badRequest(c, z.prettifyError(body.error));
    const result = await verifyVendor(body.data.domain, {
      registry: context.registry,
      fetchFile: runtime.fetchFile,
      lookupKeys: runtime.lookupKeys,
      now: runtime.nowDate,
    });
    if (!result.ok) return c.json({ error: "VERIFICATION_FAILED", message: result.message, accounts: result.accounts }, 422);
    return c.json({ verified: true, vendor: vendorView(result.vendor), evidenceHash: result.evidenceHash, accounts: result.accounts });
  });

  app.get("/v1/vendors/:domain", async (c) => {
    const vendor = await context.registry.getVendor(normalizeDomain(c.req.param("domain")));
    return vendor ? c.json(vendorView(vendor)) : c.json({ error: "NOT_FOUND", message: "No such vendor." }, 404);
  });

  app.get("/.well-known/redline-attestor.json", (c) =>
    c.json({ version: 1, alg: "ed25519", public_key: attestor.publicKey, signs: "Redline payee receipts: the canonical JSON of id, issuedAt, requestHash, verdict, reasonCodes, payee or account, and domain." }),
  );
}
