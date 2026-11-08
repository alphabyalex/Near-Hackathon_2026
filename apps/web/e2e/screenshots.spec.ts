import type { Page } from "@playwright/test";
import { APPROVER_ACCOUNT, OWNER_ACCOUNT, SHOTS_PORT, VENDOR_NEAR_ACCOUNT } from "./keys";
import { expect, signInAs, test, type Wallets } from "./fixtures";

/** Desktop and 390px screenshots of every page, saved to apps/web/screenshots (gitignored). */

const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

type Shot = { name: string; path: string; base?: string; prepare?: (page: Page, wallets: Wallets) => Promise<void> };

const SHOTS: Shot[] = [
  { name: "home", path: "#/" },
  {
    name: "try-it",
    path: "#/try",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Resolve", exact: true }).click();
      await page.locator(".result").getByRole("button", { name: "Verify signature" }).click();
      await expect(page.locator("[data-verified]")).toBeVisible();
    },
  },
  {
    name: "try-it-block",
    path: "#/try",
    prepare: async (page) => {
      await page.getByRole("tab", { name: "Check an address" }).click();
      await page.getByRole("button", { name: "Check", exact: true }).click();
      await expect(page.locator(".result")).toHaveAttribute("data-verdict", "BLOCK");
    },
  },
  {
    name: "demo",
    path: "#/demo",
    prepare: async (page) => {
      await page.locator('[data-scene="x402"]').click();
      await expect(page.locator(".stage .result")).toBeVisible();
    },
  },
  { name: "connect", path: "#/connect", base: `http://127.0.0.1:${SHOTS_PORT}/` },
  { name: "connect-unset", path: "#/connect" },
  { name: "verify", path: "#/verify" },
  {
    name: "verify-wallets",
    path: "#/verify",
    prepare: async (page, wallets) => {
      wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
      await page.getByLabel("Your domain").fill("acme-freight.example");
      await page.getByLabel("Display name").fill("Acme Freight");
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByLabel("NEAR account").fill(VENDOR_NEAR_ACCOUNT);
      await page.getByRole("button", { name: "Sign with Test wallet" }).click();
      await page.getByRole("button", { name: "Connect and sign" }).first().click();
      await expect(page.locator(".signed li")).toHaveCount(2);
    },
  },
  {
    name: "verify-host",
    path: "#/verify",
    prepare: async (page, wallets) => {
      wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
      await page.getByLabel("Your domain").fill("acme-freight.example");
      await page.getByLabel("Display name").fill("Acme Freight");
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByLabel("NEAR account").fill(VENDOR_NEAR_ACCOUNT);
      await page.getByRole("button", { name: "Sign with Test wallet" }).click();
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.locator(".host-url")).toBeVisible();
    },
  },
  { name: "about", path: "#/about" },
  { name: "owner-sign-in", path: "#/app/overview" },
  { name: "owner-overview", path: "#/app/overview", prepare: (page, wallets) => signInAs(page, wallets, OWNER_ACCOUNT) },
  {
    name: "owner-review-desk",
    path: "#/app/review",
    prepare: async (page, wallets) => {
      await signInAs(page, wallets, APPROVER_ACCOUNT);
      await expect(page.locator(".desk-item").first()).toBeVisible();
    },
  },
  {
    name: "owner-api-keys",
    path: "#/app/keys",
    prepare: async (page, wallets) => {
      await signInAs(page, wallets, OWNER_ACCOUNT);
      await expect(page.getByRole("button", { name: "Create key" })).toBeVisible();
    },
  },
];

for (const size of SIZES) {
  for (const shot of SHOTS) {
    test(`${shot.name} at ${size.name}`, async ({ page, wallets }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${shot.base ?? "/"}${shot.path}`);
      await expect(page.locator("main")).toBeVisible();
      if (shot.prepare) await shot.prepare(page, wallets);
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: `screenshots/${shot.name}-${size.name}.png`, fullPage: true });
    });
  }
}
