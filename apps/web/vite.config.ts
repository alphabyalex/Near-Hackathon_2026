import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { BRAND } from "./src/brand";
import { redteamSummary } from "./vite/redteam";

const REPORT = fileURLToPath(new URL("../../evidence/redteam/report.json", import.meta.url));

export default defineConfig({
  // Read VITE_ variables from the repo root .env. Only VITE_-prefixed names ever reach the browser.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [
    react(),
    redteamSummary(REPORT),
    // The page title and description come from src/brand.ts, like every other line of copy.
    { name: "redline-brand-html", transformIndexHtml: (html) => html.replaceAll("%BRAND_NAME%", BRAND.name).replaceAll("%BRAND_DESCRIPTION%", BRAND.metaDescription) },
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.REDLINE_DEV_API ?? "http://127.0.0.1:8787", rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
  test: { environment: "jsdom", css: true, include: ["test/**/*.test.{ts,tsx}"] },
});
