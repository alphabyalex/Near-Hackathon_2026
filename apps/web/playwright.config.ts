import { defineConfig, devices } from "@playwright/test";
import { API_PORT, SHOTS_PORT, WEB_PORT } from "./e2e/keys";

const testEnv = { VITE_WARDLINE_TEST_WALLET: "1", WARDLINE_DEV_API: `http://127.0.0.1:${API_PORT}` };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 90_000,
  // Firefox and WebKit are slower here; give assertions room without hiding real failures.
  expect: { timeout: 10_000 },
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [
    // Reduced motion by default, so axe never samples a half-faded button and the canvas hero stays out
    // of the way; the hero tests opt back in with page.emulateMedia({ reducedMotion: "no-preference" }).
    { name: "e2e", testIgnore: /screenshots\.spec\.ts/, use: { ...devices["Desktop Chrome"], contextOptions: { reducedMotion: "reduce" } } },
    { name: "firefox", testIgnore: /screenshots\.spec\.ts/, use: { ...devices["Desktop Firefox"], contextOptions: { reducedMotion: "reduce" } } },
    { name: "webkit", testIgnore: /screenshots\.spec\.ts/, use: { ...devices["Desktop Safari"], contextOptions: { reducedMotion: "reduce" } } },
    { name: "screenshots", testMatch: /screenshots\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    { command: "pnpm exec tsx e2e/stub-api.ts", port: API_PORT, reuseExistingServer: false, timeout: 60_000 },
    // No API URL: the site calls /api, which this dev server proxies to the stub API.
    { command: `pnpm exec vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`, port: WEB_PORT, env: testEnv, reuseExistingServer: false, timeout: 60_000 },
    // Same app built with public URLs set, for the Connect page in its configured state.
    {
      command: `pnpm exec vite --port ${SHOTS_PORT} --strictPort --host 127.0.0.1`,
      port: SHOTS_PORT,
      env: { ...testEnv, VITE_WARDLINE_API_URL: "https://api.wardline.example", VITE_WARDLINE_MCP_URL: "https://mcp.wardline.example/mcp" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
