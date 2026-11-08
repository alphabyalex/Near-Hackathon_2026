import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { applyLegacyEnv } from "@wardline/schemas";
import { BRAND } from "./src/brand";
import { redteamSummary } from "./vite/redteam";

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

export default defineConfig(({ mode }) => {
  carryLegacyEnv(mode);
  return {
    // Read VITE_ variables from the repo root .env. Only VITE_-prefixed names ever reach the browser.
    envDir: ENV_DIR,
    plugins: [
      react(),
      redteamSummary(REPORT),
      // The page title and description come from src/brand.ts, like every other line of copy.
      { name: "wardline-brand-html", transformIndexHtml: (html: string) => html.replaceAll("%BRAND_NAME%", BRAND.name).replaceAll("%BRAND_DESCRIPTION%", BRAND.metaDescription) },
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: process.env.WARDLINE_DEV_API ?? "http://127.0.0.1:8787", rewrite: (path: string) => path.replace(/^\/api/, "") },
      },
    },
    test: { environment: "jsdom", css: true, include: ["test/**/*.test.{ts,tsx}"] },
  };
});
