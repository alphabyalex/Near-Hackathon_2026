import { getConnInfo } from "@hono/node-server/conninfo";
import { PayeeCheckRequest, PayeeResolveRequest } from "@redline/schemas";
import { InvalidPayeeInputError, normalizeAccount, normalizeDomain, type RegistryVendor } from "@redline/sdk";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Store } from "../store.js";
import type { PayeeRuntime } from "./runtime.js";
import { verifyVendor } from "./verify-vendor.js";

const X402_PRICE_ATOMIC = "10000"; // 0.01 USDC, 6 decimals

const RecordBody = z.object({ payer: z.string().min(1).max(128), domain: z.string().max(253), account: z.string().min(3).max(160) });
const VerifyBody = z.object({ domain: z.string().max(253) });

const badRequest = (c: Context, message: string) => c.json({ error: "BAD_REQUEST", message }, 400);
const badJson = (c: Context) => badRequest(c, "Request body must be JSON.");

const vendorView = (vendor: RegistryVendor) => ({
  domain: vendor.domain,
  name: vendor.name,
  legalName: vendor.legalName,
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

export function registerPayeeRoutes(app: Hono, runtime: PayeeRuntime, store: Store): void {
  const { context, engine, attestor } = runtime;

  app.use("/v1/*", cors());
  app.use("/.well-known/redline-attestor.json", cors());

  app.use("/v1/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const day = runtime.nowDate().toISOString().slice(0, 10);
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
    const result = { ...(await engine.check(body.data, context)), receipt: null };
    return c.json({ ...result, receipt: attestor.issueReceipt(body.data, result, runtime.nowDate().toISOString()) });
  });

  app.post("/v1/resolve", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return badJson(c);
    const body = PayeeResolveRequest.safeParse(raw);
    if (!body.success) return badRequest(c, z.prettifyError(body.error));
    const result = { ...(await engine.resolve(body.data, context)), receipt: null };
    return c.json({ ...result, receipt: attestor.issueReceipt(body.data, result, runtime.nowDate().toISOString()) });
  });

  app.post("/v1/payments/record", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null) return badJson(c);
    const body = RecordBody.safeParse(raw);
    if (!body.success) return badRequest(c, z.prettifyError(body.error));
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
