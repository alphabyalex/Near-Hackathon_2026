import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseAccount } from "@wardline/sdk";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Store } from "./store.js";

export type OwnerRole = "owner" | "approver";

export const OWNER_LOGIN_RECIPIENT = "wardline-owner-login";
export const PAYMENT_RECORD_RECIPIENT = "wardline-payment-record";
export const SESSION_COOKIE = "wardline_session";
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SIGNED_REQUEST_WINDOW_MS = 5 * 60_000;
const DEFAULT_SESSION_MINUTES = 30;
const DEFAULT_KEY_CALLS_PER_DAY = 10_000;

export interface OwnerAuthConfig {
  /** False only on a localhost-bound owner app, for the local dashboard. Refused when bound publicly. */
  enabled: boolean;
  owners: ReadonlySet<string>;
  approvers: ReadonlySet<string>;
  sessionTtlMs: number;
  secureCookie: boolean;
  network: string;
  keyCallsPerDay: number;
}

const accountList = (value: string | undefined, network: string): Set<string> =>
  new Set(
    (value ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => parseAccount(a, network).address),
  );

export function ownerAuthFromEnv(env: NodeJS.ProcessEnv = process.env): OwnerAuthConfig {
  const network = env.NEAR_NETWORK ?? "testnet";
  const minutes = Number(env.WARDLINE_SESSION_TTL_MINUTES ?? DEFAULT_SESSION_MINUTES);
  const keyCalls = Number(env.WARDLINE_API_KEY_CALLS_PER_DAY ?? DEFAULT_KEY_CALLS_PER_DAY);
  return {
    enabled: env.WARDLINE_OWNER_AUTH !== "off",
    owners: accountList(env.WARDLINE_OWNER_ACCOUNTS, network),
    approvers: accountList(env.WARDLINE_APPROVER_ACCOUNTS, network),
    sessionTtlMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SESSION_MINUTES) * 60_000,
    secureCookie: env.WARDLINE_OWNER_BIND_PUBLIC === "true" || env.WARDLINE_BIND_PUBLIC === "true",
    network,
    keyCallsPerDay: Number.isSafeInteger(keyCalls) && keyCalls > 0 ? keyCalls : DEFAULT_KEY_CALLS_PER_DAY,
  };
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export const roleOf = (config: OwnerAuthConfig, account: string): OwnerRole | null =>
  config.owners.has(account) ? "owner" : config.approvers.has(account) ? "approver" : null;

export const challengeMessage = (account: string, expiresAt: string): string => `wardline-owner-login:v1:${account}:${expiresAt}`;

export const paymentRecordMessage = (timestamp: string, canonicalBody: string): string => `wardline-payment-record:v1:${timestamp}:${canonicalBody}`;

export function issueChallenge(store: Store, account: string, now: number) {
  const nonce = randomBytes(32).toString("base64");
  const expiresAt = now + CHALLENGE_TTL_MS;
  const message = challengeMessage(account, new Date(expiresAt).toISOString());
  store.saveChallenge({ nonce, account, message, expiresAt }, now);
  return { account, message, recipient: OWNER_LOGIN_RECIPIENT, nonce, expiresAt: new Date(expiresAt).toISOString() };
}

export function createSession(store: Store, config: OwnerAuthConfig, account: string, role: OwnerRole, now: number) {
  const token = `rs_${randomBytes(32).toString("base64url")}`;
  const expiresAt = now + config.sessionTtlMs;
  store.saveSession({ tokenHash: sha256Hex(token), account, role, expiresAt }, now);
  return { token, account, role, expiresAt: new Date(expiresAt).toISOString() };
}

export function setSessionCookie(c: Context, config: OwnerAuthConfig, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: config.secureCookie,
    path: "/",
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** The session token from a Bearer header or the cookie. API keys (rk_) are never session tokens. */
export function sessionToken(c: Context): string | null {
  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(rs_[A-Za-z0-9_-]+)$/)?.[1];
  return bearer ?? getCookie(c, SESSION_COOKIE) ?? null;
}

export interface OwnerVariables {
  session: { account: string; role: OwnerRole };
}

/** Rejects owner routes without a live session. With auth off, every caller acts as a local owner. */
export function requireSession(store: Store, config: OwnerAuthConfig, now: () => number): MiddlewareHandler<{ Variables: OwnerVariables }> {
  return async (c, next) => {
    if (!config.enabled) {
      c.set("session", { account: "local", role: "owner" });
      return next();
    }
    const token = sessionToken(c);
    const session = token ? store.getSession(sha256Hex(token), now()) : null;
    if (!session) return c.json({ error: "UNAUTHORIZED", message: "Sign in as an owner or approver." }, 401);
    c.set("session", { account: session.account, role: session.role as OwnerRole });
    return next();
  };
}

export function requireOwner(): MiddlewareHandler<{ Variables: OwnerVariables }> {
  return async (c, next) => {
    if (c.get("session").role !== "owner") return c.json({ error: "FORBIDDEN", message: "Only an owner can do this." }, 403);
    return next();
  };
}

/**
 * `check` lets a key pass its payer on /v1/check and /v1/resolve. `record` lets it write payment
 * history, which can clear PAYEE_CHANGED and raise T3. Give agents check-only keys; record from the
 * system that settles payments.
 */
export const API_KEY_SCOPES = ["check", "record"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function createApiKey(
  store: Store,
  input: { payer: string; label: string | null; callsPerDay: number; scopes?: readonly ApiKeyScope[]; createdBy: string; createdAt: string },
) {
  const key = `rk_${randomBytes(32).toString("base64url")}`;
  const id = `key_${randomUUID()}`;
  const scopes = input.scopes ?? ["check"];
  store.saveApiKey({ id, keyHash: sha256Hex(key), ...input, scopes });
  return { id, key, payer: input.payer, label: input.label, callsPerDay: input.callsPerDay, scopes };
}

/** The API key from a Bearer header, if the caller sent one. */
export const apiKeyFrom = (c: Context): string | null => c.req.header("authorization")?.match(/^Bearer\s+(rk_[A-Za-z0-9_-]+)$/)?.[1] ?? null;
