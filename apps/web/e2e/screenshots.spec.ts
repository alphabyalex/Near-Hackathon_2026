import type { Page } from "@playwright/test";
import { APPROVER_ACCOUNT, OWNER_ACCOUNT, SHOTS_PORT, VENDOR_NEAR_ACCOUNT } from "./keys";
import { expect, signInAs, test, type Wallets } from "./fixtures";

/** Desktop and 390px screenshots of every page, saved to apps/web/screenshots (gitignored). */

const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

type Shot = { name: string; path: string; base?: string; motion?: boolean; viewport?: boolean; prepare?: (page: Page, wallets: Wallets) => Promise<void> };

const SHOTS: Shot[] = [
  {
    // With motion on: wait for the line, the assembly and a moment of drift, so the shot shows the settled hero.
    name: "home",
    path: "#/",
    motion: true,
    prepare: async (page) => {
      await expect(page.getByTestId("home-stats")).toBeVisible();
      await expect(page.getByTestId("governance")).toBeVisible();
      await page.waitForTimeout(4200);
    },
  },
  {
    name: "join",
    path: "#/",
    viewport: true,
    prepare: async (page) => {
      await expect(page.getByTestId("home-stats")).toBeVisible();
      await page.getByRole("button", { name: "Become a member" }).first().click();
      await expect(page.getByTestId("join-dialog")).toBeVisible();
    },
  },
  {
    name: "me-member",
    path: "#/me",
    prepare: async (page, wallets) => {
      wallets.setNearAccount(APPROVER_ACCOUNT);
      await page.getByTestId("me-connect").getByRole("button", { name: "Connect wallet" }).click();
      const dlg = page.getByTestId("connect-dialog");
      await dlg.getByLabel("NEAR account").fill(APPROVER_ACCOUNT);
      await dlg.locator('[data-wallet="test-wallet"]').click();
      await dlg.getByRole("button", { name: "Use this wallet" }).click();
      await expect(page.getByTestId("me-position")).toBeVisible();
    },
  },
  {
    name: "me-empty",
    path: "#/me",
    prepare: async (page, wallets) => {
      wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
      await page.getByTestId("me-connect").getByRole("button", { name: "Connect wallet" }).click();
      const dlg = page.getByTestId("connect-dialog");
      await dlg.getByLabel("NEAR account").fill(VENDOR_NEAR_ACCOUNT);
      await dlg.locator('[data-wallet="test-wallet"]').click();
      await dlg.getByRole("button", { name: "Use this wallet" }).click();
      await expect(page.getByTestId("me-empty")).toBeVisible();
    },
  },
  {
    name: "state-api-down",
    path: "#/",
    prepare: async (page) => {
      await page.route("**/api/v1/mutual", (r) => r.abort("connectionrefused"));
      await page.reload();
      await expect(page.locator('[data-problem="apiDown"]')).toBeVisible();
    },
  },
  {
    name: "state-wallet-rejected",
    path: "#/",
    viewport: true,
    prepare: async (page, wallets) => {
      wallets.setNearAccount(OWNER_ACCOUNT);
      await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
      const dlg = page.getByTestId("join-dialog");
      await dlg.getByLabel("Your NEAR account").fill(OWNER_ACCOUNT);
      await dlg.locator('[data-wallet="test-wallet"]').click();
      await page.evaluate(() => {
        const w = window as unknown as { __wardlineTestWallet: { signMessage: () => Promise<never> } };
        w.__wardlineTestWallet.signMessage = () => Promise.reject(new Error("User rejected the request"));
      });
      await dlg.getByRole("button", { name: "Deposit 25.00 USDC" }).click();
      await expect(dlg.locator('[data-problem="walletRejected"]')).toBeVisible();
    },
  },
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
    name: "demo",
    path: "#/demo",
    prepare: async (page) => {
      await page.locator('[data-scene="swap"]').click();
      await page.locator('[data-run="swap"]').click();
      await expect(page.locator(".stage-result")).toBeVisible();
    },
  },
  {
    name: "demo-group",
    path: "#/demo",
    prepare: async (page) => {
      await page.locator('[data-scene="group"]').click();
      await page.locator('[data-run="group"]').click();
      await expect(page.locator(".stage-result")).toBeVisible();
    },
  },
  {
    name: "demo-payout",
    path: "#/demo",
    prepare: async (page) => {
      await page.locator('[data-scene="payout"]').click();
      await page.locator('[data-run="payout"]').click();
      await expect(page.locator(".stage-result")).toBeVisible();
    },
  },
  {
    name: "demo-tier",
    path: "#/demo",
    prepare: async (page) => {
      await page.locator('[data-scene="tier"]').click();
      await page.locator('[data-run="tier"]').click();
      await expect(page.locator(".stage-result")).toBeVisible();
    },
  },
  {
    name: "groups",
    path: "#/groups",
    prepare: async (page) => {
      await expect(page.locator(".orb").first()).toBeVisible();
    },
  },
  {
    name: "proof",
    path: "#/proof",
    prepare: async (page) => {
      await expect(page.getByTestId("proofs")).toBeVisible();
    },
  },
  { name: "developers", path: "#/developers", base: `http://127.0.0.1:${SHOTS_PORT}/` },
  { name: "developers-default", path: "#/developers" },
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
  {
    name: "owner-sign-in",
    path: "#/app/overview",
    // The owner app loads lazily; wait for the form, not the loading line.
    prepare: async (page) => {
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    },
  },
  {
    name: "owner-overview",
    path: "#/app/overview",
    prepare: async (page, wallets) => {
      await signInAs(page, wallets, OWNER_ACCOUNT);
      await expect(page.locator(".spend-chart svg")).toBeVisible();
    },
  },
  {
    name: "my-share",
    path: "#/app/share",
    prepare: async (page, wallets) => {
      await signInAs(page, wallets, OWNER_ACCOUNT);
      await expect(page.getByTestId("price-chart")).toBeVisible();
    },
  },
  {
    name: "owner-group",
    path: "#/app/group",
    prepare: async (page, wallets) => {
      await signInAs(page, wallets, OWNER_ACCOUNT);
      await expect(page.locator("table.calls tbody tr").first()).toBeVisible();
    },
  },
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
      await expect(page.getByRole("button", { name: "Create key", exact: true })).toBeVisible();
    },
  },
];

for (const size of SIZES) {
  for (const shot of SHOTS) {
    test(`${shot.name} at ${size.name}`, async ({ page, wallets }) => {
      await page.emulateMedia({ reducedMotion: shot.motion ? "no-preference" : "reduce" });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${shot.base ?? "/"}${shot.path}`);
      await expect(page.locator("main")).toBeVisible();
      if (shot.prepare) await shot.prepare(page, wallets);
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await document.fonts.ready;
        if (!document.querySelector(".dlg")) window.scrollTo(0, 0);
      });
      await page.screenshot({ path: `screenshots/${shot.name}-${size.name}.png`, fullPage: !shot.viewport });
    });
  }
}

/** The pages changed in A9, at 1440 and iPhone SE (375 x 667): run with -g "a9 ". */
const A9_SIZES = [
  { name: "1440", width: 1440, height: 900 },
  { name: "iphone-se", width: 375, height: 667 },
] as const;

const A9: Shot[] = [
  { name: "home", path: "#/", prepare: async (page) => void (await expect(page.getByTestId("governance")).toBeVisible()) },
  { name: "about", path: "#/about" },
  { name: "developers", path: "#/developers" },
  { name: "groups", path: "#/groups", prepare: async (page) => void (await expect(page.locator(".orb").first()).toBeVisible()) },
  { name: "proof", path: "#/proof", prepare: async (page) => void (await expect(page.getByTestId("proofs")).toBeVisible()) },
  {
    name: "demo-payout",
    path: "#/demo",
    viewport: true,
    prepare: async (page) => {
      await page.locator('[data-scene="payout"]').click();
      await page.locator('[data-run="payout"]').click();
      await expect(page.locator('[data-scene-result="payout"]')).toBeVisible();
      await page.waitForTimeout(800);
    },
  },
  {
    name: "connect-wallet",
    path: "#/groups",
    viewport: true,
    prepare: async (page) => {
      await page.getByTestId("connect-wallet").click();
      await expect(page.getByTestId("connect-dialog")).toBeVisible();
    },
  },
  {
    name: "join-connected",
    path: "#/",
    viewport: true,
    prepare: async (page, wallets) => {
      wallets.setNearAccount(OWNER_ACCOUNT);
      await page.getByTestId("connect-wallet").click();
      const box = page.getByTestId("connect-dialog");
      await box.getByLabel("NEAR account").fill(OWNER_ACCOUNT);
      await box.locator('[data-wallet="test-wallet"]').click();
      await box.getByRole("button", { name: "Use this wallet" }).click();
      await expect(page.getByTestId("home-stats")).toBeVisible();
      await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
      await expect(page.getByTestId("join-from")).toBeVisible();
    },
  },
];

for (const size of A9_SIZES) {
  for (const shot of A9) {
    test(`a9 ${shot.name} at ${size.name}`, async ({ page, wallets }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/${shot.path}`);
      // Pages are lazy-loaded: wait for the real heading, not the loading placeholder.
      await expect(page.locator("main h1").first()).toBeVisible();
      if (shot.prepare) await shot.prepare(page, wallets);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `screenshots/a9-${shot.name}-${size.name}.png`, fullPage: !shot.viewport });
    });
  }
}
