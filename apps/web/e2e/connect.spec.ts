import type { Page } from "@playwright/test";
import { OWNER_ACCOUNT } from "./keys";
import { expect, test } from "./fixtures";

const box = (page: Page) => page.getByTestId("connect-dialog");

test.describe("Connect wallet", () => {
  test("on a wide screen it opens under its button, fully on screen, and Cancel, Escape and an outside click close it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/groups");
    const button = page.getByTestId("connect-wallet");
    await button.click();
    await expect(box(page)).toBeVisible();
    await expect(box(page).getByRole("heading", { name: "Connect a wallet" })).toBeVisible();
    await expect(box(page).getByRole("button", { name: "Close" })).toBeVisible();
    const b = (await button.boundingBox())!;
    const d = (await box(page).boundingBox())!;
    expect(d.y).toBeGreaterThanOrEqual(b.y + b.height);
    expect(d.y).toBeLessThan(b.y + b.height + 24);
    expect(Math.abs(d.x + d.width - (b.x + b.width))).toBeLessThanOrEqual(2);
    expect(d.y + d.height).toBeLessThanOrEqual(900);

    await box(page).getByRole("button", { name: "Cancel" }).click();
    await expect(box(page)).toHaveCount(0);
    await button.click();
    await page.keyboard.press("Escape");
    await expect(box(page)).toHaveCount(0);
    await button.click();
    await page.mouse.click(200, 600);
    await expect(box(page)).toHaveCount(0);
  });

  test("on a phone it is a bottom sheet with its title and close button on screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/#/groups");
    await page.getByTestId("connect-wallet").click();
    await expect(box(page)).toBeVisible();
    const d = (await box(page).boundingBox())!;
    expect(Math.round(d.y + d.height)).toBe(667);
    expect(d.width).toBe(375);
    await expect(box(page).getByRole("button", { name: "Close" })).toBeInViewport();
    await expect(box(page).getByRole("button", { name: "Cancel" })).toBeInViewport();
  });

  test("once connected, Join skips the account step and shows the account with Change", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    await page.getByTestId("connect-wallet").click();
    await box(page).getByLabel("NEAR account").fill(OWNER_ACCOUNT);
    await box(page).locator('[data-wallet="test-wallet"]').click();
    await box(page).getByRole("button", { name: "Use this wallet" }).click();
    await expect(page.getByTestId("home-stats")).toBeVisible();
    await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
    const dlg = page.getByTestId("join-dialog");
    await expect(dlg.getByTestId("join-from")).toContainText(`From ${OWNER_ACCOUNT}`);
    await expect(dlg.getByLabel("Your NEAR account")).toHaveCount(0);
    await dlg.getByRole("button", { name: "Change" }).click();
    await expect(dlg.getByLabel("Your NEAR account")).toHaveValue(OWNER_ACCOUNT);
  });

  test("a blocked wallet window says to allow pop-ups, and the page never freezes waiting on a wallet", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    await expect(page.getByTestId("home-stats")).toBeVisible();
    await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
    const dlg = page.getByTestId("join-dialog");
    await dlg.getByLabel("Your NEAR account").fill(OWNER_ACCOUNT);
    await dlg.locator('[data-wallet="test-wallet"]').click();
    await page.evaluate(() => {
      const w = window as unknown as { __wardlineTestWallet: { signMessage: () => Promise<never> } };
      w.__wardlineTestWallet.signMessage = () => Promise.reject(new Error("Couldn't open popup window to complete wallet action"));
    });
    await dlg.getByRole("button", { name: "Deposit 25.00 USDC" }).click();
    await expect(dlg.locator('[data-problem="walletPopup"]')).toContainText("Your browser blocked the wallet window.");
    await expect(dlg.locator('[data-problem="walletPopup"]')).toContainText("Allow pop-ups for this site, then try again.");
    await expect(dlg).not.toContainText("Couldn't open popup");

    // A wallet that never answers: Stop waiting brings the form back, and the page still responds.
    await page.evaluate(() => {
      const w = window as unknown as { __wardlineTestWallet: { signMessage: () => Promise<never> } };
      w.__wardlineTestWallet.signMessage = () => new Promise<never>(() => {});
    });
    await dlg.getByRole("button", { name: "Deposit 25.00 USDC" }).click();
    await expect(dlg.getByRole("status")).toContainText("Approve the deposit in your wallet");
    await dlg.getByRole("button", { name: "Stop waiting" }).click();
    await expect(dlg.getByRole("button", { name: "Deposit 25.00 USDC" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  });
});
