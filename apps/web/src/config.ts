/** Where the site finds the API. Everything comes from VITE_ env vars at build time. */
import repo from "../../../repo.config.json";

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
};

const env = import.meta.env;

/** The public API URL, shown in snippets. Null when the site was built without one. */
export const API_URL = clean(env.VITE_WARDLINE_API_URL);
/** The MCP endpoint, shown on Connect. */
export const MCP_URL = clean(env.VITE_WARDLINE_MCP_URL);
/** Where a local run serves the API and the MCP endpoint (README, "Run it locally"). */
export const LOCAL_API_URL = "http://127.0.0.1:8787";
export const LOCAL_MCP_URL = "http://127.0.0.1:8790/mcp";
/** What code snippets show: the configured URLs, else the hosted ones from repo.config.json, else the local ones while nothing is hosted. Never a variable. */
export const SNIPPET_API_URL = API_URL ?? clean(repo.hosted.api) ?? LOCAL_API_URL;
export const SNIPPET_MCP_URL = MCP_URL ?? clean(repo.hosted.mcp) ?? LOCAL_MCP_URL;
/** What the browser calls. Without a URL, the same origin's /api, which the dev server proxies. */
export const API_BASE = API_URL ?? "/api";
/** Owner routes. Serve them on the same site as this app, so the session cookie is sent. */
export const OWNER_BASE = clean(env.VITE_WARDLINE_OWNER_URL) ?? `${API_BASE}/owner`;
export const NEAR_NETWORK = env.VITE_NEAR_NETWORK?.trim() || "testnet";
/** End-to-end tests only: a scripted NEAR wallet. Never set in a real build. */
export const TEST_WALLET = env.VITE_WARDLINE_TEST_WALLET === "1";
