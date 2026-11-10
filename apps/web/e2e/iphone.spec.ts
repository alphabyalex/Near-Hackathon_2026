import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Runs in the "iphone" project: WebKit, iPhone SE (375 x 667, touch, mobile viewport).
const ROUTES = ["#/", "#/me", "#/groups", "#/proof", "#/try", "#/demo", "#/developers", "#/verify", "#/about", "#/vault"];

/** What sticks out past the right edge, for a readable failure message. */
async function offenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= w + 1) continue;
      // Only report the outermost element that sticks out.
      if (el.parentElement && el.parentElement.getBoundingClientRect().right > w + 1) continue;
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").join(".")} right=${Math.round(r.right)}`);
    }
    return out.slice(0, 8);
  });
}

/** The page is exactly as wide as the screen, and a sideways swipe or scroll can't move it. */
async function expectNoSideways(page: Page, where: string) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: window.innerWidth }));
  expect(size.scroll, `${where}: page wider than the screen: ${(await offenders(page)).join(", ")}`).toBeLessThanOrEqual(size.inner);
  expect(size.body, `${where}: body wider than the screen`).toBeLessThanOrEqual(size.inner);
  // Playwright can't synthesize a native touch swipe (or a wheel) in mobile WebKit, so this pushes
  // the page's own scroller sideways every scripted way. If a swipe could pan it, these would too.
  await page.evaluate(() => {
    window.scrollBy(400, 0);
    window.scrollTo(400, window.scrollY);
    if (document.scrollingElement) document.scrollingElement.scrollLeft = 400;
  });
  expect(await page.evaluate(() => window.scrollX), `${where}: page moved sideways`).toBe(0);
}

test.describe("iPhone: no sideways sliding", () => {
  for (const route of ROUTES) {
    test(`${route} fits the screen`, async ({ page }) => {
      await page.goto(`/${route}`);
      await expect(page.locator("main").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoSideways(page, route);
    });
  }

  test("with the Join and Connect wallet dialogs open", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("home-stats")).toBeVisible();
    await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
    await expect(page.getByTestId("join-dialog")).toBeVisible();
    await expectNoSideways(page, "join dialog");
    await page.keyboard.press("Escape");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("connect-dialog")).toBeVisible();
    await expectNoSideways(page, "connect wallet");
  });

  test("pinch zoom stays on and inputs are big enough that iOS doesn't zoom on tap", async ({ page }) => {
    await page.goto("/#/");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("width=device-width");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
    await expect(page.getByTestId("home-stats")).toBeVisible();
    await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
    await expect(page.getByTestId("join-dialog")).toBeVisible();
    const sizes = await page.getByTestId("join-dialog").locator("input, select, textarea").evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  });
});
