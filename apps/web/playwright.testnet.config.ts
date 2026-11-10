import { defineConfig, devices } from "@playwright/test";

/**
 * The testnet checks: Chromium against the local stack already running on NEAR testnet (the API in
 * near mode with the local test signer, the web app with WARDLINE_DATA=testnet; README "Run it on
 * testnet"). They send real transactions, so they are not part of the default suite.
 *
 *   pnpm --filter @wardline/web test:e2e:testnet
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /testnet\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 60_000 },
  use: { ...devices["Desktop Chrome"], baseURL: process.env.WARDLINE_TESTNET_WEB ?? "http://127.0.0.1:5173", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
});
