/**
 * The API for end-to-end tests: real routes and auth, the stub engine and memory registry, with
 * NEAR key lookups and vendor website fetches answered locally. Never use outside tests.
 */
import { serve } from "@hono/node-server";
import { createApp } from "../../../services/api/src/app.js";
import { ownerAuthFromEnv } from "../../../services/api/src/auth.js";
import { bootstrap } from "../../../services/api/src/bootstrap.js";
import type { NearKeyLookup } from "../../../services/api/src/payee/proofs.js";
import type { WellKnownFetcher } from "../../../services/api/src/payee/well-known.js";
import { API_PORT, APPROVER_ACCOUNT, NEAR_ACCOUNTS, nearPublicKey, OWNER_ACCOUNT, REQUESTER_ACCOUNT } from "./keys.js";

const hosted = new Map<string, Uint8Array>();

const lookupKeys: NearKeyLookup = async (_network, accountId) =>
  NEAR_ACCOUNTS.includes(accountId) ? [{ publicKey: nearPublicKey(accountId), fullAccess: true }] : [];

const fetchFile: WellKnownFetcher = async (domain, path) => {
  const body = path === "/.well-known/redline-payee.json" ? hosted.get(domain) : undefined;
  return body ? { status: 200, body } : { status: 404, body: new Uint8Array() };
};

const auth = ownerAuthFromEnv({
  NEAR_NETWORK: "testnet",
  REDLINE_OWNER_ACCOUNTS: OWNER_ACCOUNT,
  REDLINE_APPROVER_ACCOUNTS: `${APPROVER_ACCOUNT},${REQUESTER_ACCOUNT}`,
});

const deps = bootstrap(":memory:", undefined, { lookupKeys, fetchFile, freeCallsPerDay: 1_000_000 }, auth);
const app = createApp(deps);

// Test hook: "host" a redline-payee.json on a domain, as the vendor would on its website.
app.post("/__e2e/host", async (c) => {
  const { domain, file } = (await c.req.json()) as { domain: string; file: string };
  hosted.set(domain, new TextEncoder().encode(file));
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: API_PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`e2e stub API on http://127.0.0.1:${info.port}`);
});
