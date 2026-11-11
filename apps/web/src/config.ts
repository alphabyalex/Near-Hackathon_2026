/** Where the site finds the API. Everything comes from VITE_ env vars at build time. */
// Named imports, so only the hosted addresses and contract ids reach the bundle, never the local block.
import { hosted, near } from "../../../repo.config.json";

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
};

const env = import.meta.env;

/** The public API URL, shown in snippets. Null when the site was built without one. */
export const API_URL = clean(env.VITE_WARDLINE_API_URL);
/** The MCP endpoint, shown on Connect. */
export const MCP_URL = clean(env.VITE_WARDLINE_MCP_URL);
/**
 * What a code sample shows until a public address is set (VITE_PUBLIC_API_URL / VITE_PUBLIC_MCP_URL, or
 * repo.config.json's hosted block). Not a working address, and named so nobody mistakes it for one.
 * TODO(alexander): set the production API and MCP addresses; no domain is chosen yet.
 */
export const PLACEHOLDER_API_URL = "https://your-wardline-api.example";
export const PLACEHOLDER_MCP_URL = "https://your-wardline-api.example/mcp";

/** The public addresses code samples show, from the build's env. Never a local address. */
export const PUBLIC_API_URL = clean(env.VITE_PUBLIC_API_URL) ?? API_URL;
export const PUBLIC_MCP_URL = clean(env.VITE_PUBLIC_MCP_URL) ?? MCP_URL;


/**
 * The URL a code sample shows: the public one from env, else the hosted one from repo.config.json, else
 * the named placeholder. Never a local address, even on the dev server: samples are for customers.
 */
export function snippetUrl(configured: string | null, hosted: string, placeholder: string): string {
  return configured ?? clean(hosted) ?? placeholder;
}
export const SNIPPET_API_URL = snippetUrl(PUBLIC_API_URL, hosted.api, PLACEHOLDER_API_URL);
export const SNIPPET_MCP_URL = snippetUrl(PUBLIC_MCP_URL, hosted.mcp, PLACEHOLDER_MCP_URL);
/** True when snippets show the placeholder, so the page can say to replace it. */
export const SNIPPET_IS_PLACEHOLDER = SNIPPET_API_URL === PLACEHOLDER_API_URL;
/** The payee registry contract the direct SDK snippet reads. */
export const PAYEE_REGISTRY = near.contracts.payeeRegistry;
/** What the browser calls. Without a URL, the same origin's /api, which the dev server proxies. */
export const API_BASE = API_URL ?? "/api";
/** Owner routes. Serve them on the same site as this app, so the session cookie is sent. */
export const OWNER_BASE = clean(env.VITE_WARDLINE_OWNER_URL) ?? `${API_BASE}/owner`;
export const NEAR_NETWORK = env.VITE_NEAR_NETWORK?.trim() || "testnet";
/** NEAR RPC endpoints the browser reads balances from, tried in order (VITE_NEAR_RPC_URL takes a comma list). */
export const NEAR_RPC_URLS: string[] = (env.VITE_NEAR_RPC_URL?.trim() || (NEAR_NETWORK === "mainnet" ? "https://free.rpc.fastnear.com,https://rpc.mainnet.near.org" : "https://test.rpc.fastnear.com,https://rpc.testnet.near.org"))
  .split(",")
  .map((u: string) => u.trim())
  .filter(Boolean);
/** The Mutual's pool contract, which is also the WARD token. */
export const POOL_CONTRACT = near.contracts.coverPool;
/**
 * The local test signer (dev server only, loopback bind, testnet, VITE_WARDLINE_LOCAL_SIGNER=1; see
 * vite/local-signer.ts). import.meta.env.DEV is false in every production build, so it is never there.
 */
export const LOCAL_SIGNER = import.meta.env.DEV && env.VITE_WARDLINE_LOCAL_SIGNER === "1" && NEAR_NETWORK === "testnet";
/** End-to-end tests only: a scripted NEAR wallet. Never set in a real build. */
export const TEST_WALLET = env.VITE_WARDLINE_TEST_WALLET === "1";
