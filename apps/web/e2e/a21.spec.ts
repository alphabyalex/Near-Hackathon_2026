/**
 * The big UI pass: the page always scrolls under the wheel (the old steps stage trapped it), the account
 * menu, the moved routes, and no sideways scroll at 390px on any main page.
 */
import type { Page } from "@playwright/test";
import { APPROVER_ACCOUNT } from "./keys";
import { expect, expectAccessible, expectNoHorizontalScroll, test } from "./fixtures";

/** Connects the scripted test wallet for this tab, as the picker's developer section does. */
async function connectTestWallet(page: Page, account: string) {
  await page.addInitScript((a) => sessionStorage.setItem("wardline.connected", JSON.stringify({ account: a, wallet: "test-wallet" })), account);
}

/** Wheels over an element and returns how far the page moved. */
async function wheelOver(page: Page, selector: string): Promise<number> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  // Start from a known position with room to scroll both ways.
  await page.evaluate(() => window.scrollBy(0, -40));
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).not.toBe(before);
  return (await page.evaluate(() => window.scrollY)) - before;
}

test.describe("scrolling", () => {
  test("the wheel scrolls the page over the step list and over the stage on About", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/about");
    await expect(page.getByTestId("stage")).toBeVisible();
    expect(await wheelOver(page, ".scenes")).toBeGreaterThan(0);
    expect(await wheelOver(page, '[data-testid="stage"]')).toBeGreaterThan(0);
    // The stage sizes to its content: it is not its own scroll box.
    const stage = await page.getByTestId("stage").evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, overscroll: getComputedStyle(el).overscrollBehaviorY, scrolls: el.scrollHeight > el.clientHeight }));
    expect(stage).toEqual({ overflow: "visible", overscroll: "auto", scrolls: false });
  });

  test("the wheel scrolls the page over the Groups orbit, the proofs feed and the code panel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/groups");
    await expect(page.locator(".ob-canvas")).toBeVisible();
    expect(await wheelOver(page, ".ob-canvas")).toBeGreaterThan(0);
    await page.goto("/#/proof");
    await expect(page.getByTestId("proofs")).toBeVisible();
    expect(await wheelOver(page, '[data-testid="proofs"]')).toBeGreaterThan(0);
    await page.goto("/#/developers");
    await expect(page.locator(".codetabs pre").first()).toBeVisible();
    expect(await wheelOver(page, ".codetabs pre")).toBeGreaterThan(0);
  });
});

test.describe("the account menu", () => {
  test("opens from the Joined control, copies the account name, and Disconnect brings back Connect wallet", async ({ page, context, wallets }) => {
    wallets.setNearAccount(APPROVER_ACCOUNT);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await connectTestWallet(page, APPROVER_ACCOUNT);
    await page.goto("/#/");
    const control = page.getByTestId("account-control");
    await expect(control).toContainText("Balance");
    await expect(page.getByTestId("balance-button")).toContainText("$");
    const trigger = page.getByRole("button", { name: `${APPROVER_ACCOUNT}, account menu` });
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("account-menu")).toContainText("Connected with Test wallet");
    await expect(menu.getByRole("menuitem")).toHaveText(["Open your balance", "Copy account name", "Connect a different wallet", "Disconnect"]);
    await expectAccessible(page);

    // Arrow keys move through the items; Escape closes and returns focus.
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Copy account name" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole("menuitem", { name: "Copy account name" }).click();
    await expect(page.getByRole("menuitem", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(APPROVER_ACCOUNT);

    // Disconnect is quiet text, never red.
    const out = page.getByRole("menuitem", { name: "Disconnect" });
    const color = await out.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toBe("rgb(255, 92, 115)");
    expect(color).not.toBe("rgb(255, 122, 140)");
    await out.click();
    const connect = page.getByRole("button", { name: "Connect wallet" }).first();
    await expect(connect).toBeVisible();
    await expect(connect).toBeFocused();
    await expect(page.getByTestId("account-control")).toHaveCount(0);
  });

  test("Open your balance goes to #/wallet, where the Balance half shows it is the current page", async ({ page, wallets }) => {
    wallets.setNearAccount(APPROVER_ACCOUNT);
    await connectTestWallet(page, APPROVER_ACCOUNT);
    await page.goto("/#/");
    await page.getByRole("button", { name: `${APPROVER_ACCOUNT}, account menu` }).click();
    await page.getByRole("menuitem", { name: "Open your balance" }).click();
    await expect(page).toHaveURL(/#\/wallet$/);
    await expect(page.getByTestId("balance-button")).toHaveAttribute("aria-current", "page");
    const rows = page.getByTestId("me-position");
    await expect(rows.getByTestId("bal-usdc")).toContainText("USDC");
    await expect(rows.getByTestId("bal-ward")).toContainText("WARD");
    await expect(rows.getByRole("button", { name: "Deposit" })).toBeVisible();
    await expect(page.getByText("Your mark, drawn from your account name")).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe("moved routes", () => {
  for (const [from, to, check] of [
    ["#/me", /#\/wallet$/, "balance"],
    ["#/how-it-works", /#\/about\/steps$/, "steps"],
    ["#/demo", /#\/about\/steps$/, "steps"],
  ] as const) {
    test(`${from} redirects`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${from}`);
      await expect(page).toHaveURL(to);
      if (check === "steps") {
        await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
        // Scrolled to the steps.
        await expect.poll(() => page.locator("#steps").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
      } else {
        await expect(page.getByTestId("me-connect")).toContainText("Connect a wallet to see your balance.");
      }
    });
  }
});

test.describe("phones", () => {
  test("no page scrolls sideways at 390px", async ({ page }) => {
    await connectTestWallet(page, APPROVER_ACCOUNT);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["#/", "#/groups", "#/proof", "#/about", "#/wallet", "#/developers"]) {
      await page.goto(`/${route}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(scrollWidth, `${route} is wider than the screen`).toBeLessThanOrEqual(innerWidth);
      await expectNoHorizontalScroll(page);
    }
  });
});
