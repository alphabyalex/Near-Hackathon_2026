import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { applyLegacyEnv } from "@wardline/schemas";
import { BRAND } from "./src/brand";
import { redteamSummary } from "./vite/redteam";
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
 * The site's security headers. Only what the site uses: its own scripts and fonts, inline style
 * attributes (React sets widths and delays), the API, and the NEAR RPCs and wallets the wallet
 * selector talks to. Served by vite preview and written to dist/_headers for static hosts.
 */
export function siteHeaders(apiUrl: string | undefined): Record<string, string> {
  const api = apiUrl ? new URL(apiUrl).origin : "";
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${api} https://*.near.org https://*.fastnear.com https://*.mynearwallet.com https://*.meteorwallet.app`.replace(/ +/g, " "),
    "frame-src https://*.meteorwallet.app",
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

export default defineConfig(({ mode }) => {
  carryLegacyEnv(mode);
  const headers = siteHeaders(loadEnv(mode, ENV_DIR, "VITE_").VITE_WARDLINE_API_URL ?? process.env.VITE_WARDLINE_API_URL);
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
    test: { environment: "jsdom", css: true, include: ["test/**/*.test.{ts,tsx}"] },
  };
});
