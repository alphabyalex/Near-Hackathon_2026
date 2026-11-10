import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { applyLegacyEnv } from "@wardline/schemas";
import { BRAND } from "./src/brand";
import { redteamSummary } from "./vite/redteam";
import { checkLocalSigner } from "./vite/local-signer";
import repo from "../../repo.config.json";

const REPORT = fileURLToPath(new URL("../../evidence/redteam/report.json", import.meta.url));
const ENV_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** Env vars from before the rename still work: their values are copied to the new names, with a warning. */
function carryLegacyEnv(mode: string): void {
  const fromFiles = loadEnv(mode, ENV_DIR, "");
  const env: Record<string, string | undefined> = { ...fromFiles, ...process.env };
  applyLegacyEnv(env);
  for (const [key, value] of Object.entries(env)) {
    if (/^(VITE_)?WARDLINE_/.test(key) && process.env[key] === undefined && fromFiles[key] === undefined) process.env[key] = value;
  }
}

/**
 * Hosts NEAR Connect and the listed testnet wallets reach (found by connecting each one and watching
 * CSP violations, A14): the NEAR Connect manifest (GitHub, jsDelivr fallback), each wallet's code
 * (GitHub raw for Meteor, Nightly and Ledger; Intear's own host), the services that code talks to, and
 * the NEAR testnet RPCs the wallets and this site read.
 */
export const WALLET_CONNECT_HOSTS = [
  "https://raw.githubusercontent.com",
  "https://cdn.jsdelivr.net",
  "https://wallet.meteorwallet.app",
  "https://mc.meteorwallet.app",
  "wss://mc.meteorwallet.app",
  "https://wallet.intear.tech",
  "wss://logout-bridge-service.intear.tech",
  "https://test.rpc.fastnear.com",
  "https://rpc.testnet.near.org",
  "https://api.testnet.fastnear.com",
  "https://helper.testnet.near.org",
];

/**
 * The site's security headers. Only what the site uses: its own scripts, fonts and wallet logos, inline
 * style attributes (React sets widths and delays), the API, the RPC hosts, and NEAR Connect.
 *
 * script-src keeps 'unsafe-inline' for one reason: NEAR Connect runs each wallet's code as an inline
 * <script> in a sandboxed srcdoc iframe (sandbox="allow-scripts", no same origin), and a srcdoc iframe
 * inherits this policy. The wallet code is fetched at run time, so no hash can name it, and a static
 * host can't send a fresh nonce. Without it no wallet loads (checked: every tile fails). Everything
 * else is an exact host list.
 * Served by vite preview and written to dist/_headers for static hosts.
 */
export function siteHeaders(apiUrl: string | undefined, rpcUrls: string | undefined = undefined): Record<string, string> {
  const api = apiUrl ? new URL(apiUrl).origin : "";
  const rpc = (rpcUrls ?? "").split(",").map((u) => u.trim()).filter(Boolean).map((u) => new URL(u).origin);
  const connect = [...new Set(["'self'", api, ...rpc, ...WALLET_CONNECT_HOSTS].filter(Boolean))].join(" ");
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    // Meteor's own panel loads its fonts; Meteor and Nightly show their own images; Intear frames its wallet.
    "style-src 'self' 'unsafe-inline' https://rsms.me https://fonts.cdnfonts.com",
    "img-src 'self' data: https://meteorwallet.app https://storage.herewallet.app",
    "font-src 'self' data: https://rsms.me https://fonts.cdnfonts.com",
    `connect-src ${connect}`,
    "frame-src 'self' https://wallet.intear.tech",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };
}

export default defineConfig(({ mode, command }) => {
  carryLegacyEnv(mode);
  const viteEnv = loadEnv(mode, ENV_DIR, "VITE_");
  const localSignerFlag = process.env.VITE_WARDLINE_LOCAL_SIGNER ?? viteEnv.VITE_WARDLINE_LOCAL_SIGNER;
  const network = process.env.VITE_NEAR_NETWORK ?? viteEnv.VITE_NEAR_NETWORK;
  // Refuses a build with the local test signer, and a dev server that is not on 127.0.0.1 or testnet.
  checkLocalSigner({ flag: localSignerFlag, command, host: "127.0.0.1", network });
  const headers = siteHeaders(viteEnv.VITE_WARDLINE_API_URL ?? process.env.VITE_WARDLINE_API_URL, viteEnv.VITE_NEAR_RPC_URL ?? process.env.VITE_NEAR_RPC_URL);
  return {
    // Read VITE_ variables from the repo root .env. Only VITE_-prefixed names ever reach the browser.
    envDir: ENV_DIR,
    // WARDLINE_DATA picks the page data source (apps/web/src/data). Only this one value reaches the browser.
    define: { "import.meta.env.VITE_WARDLINE_DATA": JSON.stringify(process.env.WARDLINE_DATA ?? process.env.VITE_WARDLINE_DATA ?? "sim") },
    plugins: [
      react(),
      redteamSummary(REPORT),
      {
        name: "wardline-headers-file",
        generateBundle() {
          const lines = ["/*", ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`), ""];
          this.emitFile({ type: "asset", fileName: "_headers", source: lines.join(String.fromCharCode(10)) });
        },
      },
      // Node closes an idle keep-alive connection after 5s. WebKit on Windows can reuse one at that moment
      // and then fails the POST ("rewinding of the data stream failed"), which reads as the API being down.
      // Holding idle connections longer than any browser keeps them avoids the race.
      {
        name: "wardline-local-signer-guard",
        configureServer(server: { config: { server: { host?: string | boolean } } }) {
          checkLocalSigner({ flag: localSignerFlag, command: "serve", host: server.config.server.host, network });
        },
      },
      {
        name: "wardline-keep-alive",
        configureServer(server: { httpServer: import("node:http").Server | null }) {
          if (server.httpServer) { server.httpServer.keepAliveTimeout = 65_000; server.httpServer.headersTimeout = 66_000; }
        },
        configurePreviewServer(server: { httpServer: import("node:http").Server }) {
          server.httpServer.keepAliveTimeout = 65_000;
          server.httpServer.headersTimeout = 66_000;
        },
      },
      // The page title and description come from src/brand.ts, like every other line of copy.
      { name: "wardline-brand-html", transformIndexHtml: (html: string) =>
          html
            .replaceAll("%BRAND_NAME%", BRAND.name)
            .replaceAll("%BRAND_TAGLINE%", BRAND.tagline.replace(/\.$/, ""))
            .replaceAll("%BRAND_DESCRIPTION%", BRAND.metaDescription)
            // Social cards need an absolute image URL: the hosted web app from repo.config.json.
            .replaceAll("%SITE_URL%", (process.env.VITE_WARDLINE_SITE_URL ?? repo.hosted.web).replace(/\/$/, "")),
      },
    ],
    // Source maps for the production build, so errors and audits point at real code.
    build: { sourcemap: true },
    preview: { host: "127.0.0.1", headers },
    server: {
      host: "127.0.0.1",
      port: 5173,
      allowedHosts: true,
      proxy: {
        "/api": { target: process.env.WARDLINE_DEV_API ?? `http://127.0.0.1:${process.env.WARDLINE_API_PORT ?? 8787}`, rewrite: (path: string) => path.replace(/^\/api/, "") },
      },
    },
    test: { environment: "jsdom", css: true, include: ["test/**/*.test.{ts,tsx}"], testTimeout: 20_000 },
  };
});
