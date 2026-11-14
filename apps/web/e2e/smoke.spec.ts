/**
 * Smoke test for judges and reviewers: every main page loads with no console errors or failed requests,
 * shows no placeholder junk (NaN, undefined, [object Object]), every in-app link points at a real route,
 * the wallet picker lists wallets with their logos, and wide screens get the wide layout. Scrolling, the
 * account menu, the moved routes and 390px overflow are covered in a21.spec.ts.
 */
import type { Page } from "@playwright/test";
import { APPROVER_ACCOUNT } from "./keys";
import { expect, test } from "./fixtures";

const PAGES = ["#/", "#/groups", "#/proof", "#/about", "#/docs", "#/docs/quickstart", "#/wallet", "#/try", "#/verify"];
/** First path segments the router knows, including the ones that redirect. */
const ROUTES = ["", "wallet", "groups", "proof", "try", "docs", "verify", "about", "vault", "scoring", "app", "mutual", "me", "how-it-works", "demo", "connect", "developers"];

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("requestfailed", (r) => {
    // NEAR Connect fetches its wallet manifests from the network; the stub world has no internet promise.
    if (!/hot-labs|near-connect|walletconnect|fonts\.|rsms\.me/.test(r.url())) problems.push(`requestfailed: ${r.url().slice(0, 160)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 160)}`);
  });
  return problems;
}

test.describe("smoke", () => {
  for (const route of PAGES) {
    test(`${route} loads cleanly, with real numbers and real links`, async ({ page, wallets }) => {
      if (route === "#/wallet") {
        wallets.setNearAccount(APPROVER_ACCOUNT);
        await page.addInitScript((a) => sessionStorage.setItem("wardline.connected", JSON.stringify({ account: a, wallet: "test-wallet" })), APPROVER_ACCOUNT);
      }
      const problems = watch(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${route}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("main [aria-busy='true']")).toHaveCount(0, { timeout: 30_000 });
      const text = await page.locator("main").innerText();
      expect(text.trim().length, `${route} main has text`).toBeGreaterThan(40);
      for (const junk of [/\bNaN\b/, /\bundefined\b/, /\[object Object\]/]) expect(text, `${route} shows ${junk}`).not.toMatch(junk);

      const links = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      for (const href of new Set(links)) {
        expect(href, `${route} has an empty link`).not.toBe("");
        expect(href, `${route} has a dead # link`).not.toBe("#");
        if (href.startsWith("#/")) expect(ROUTES, `${route} links to ${href}`).toContain(href.replace(/^#\//, "").split("/")[0]);
      }
      // Every Sheen primary that is a link goes somewhere.
      for (const href of await page.locator("a.btn:not(.ghost)").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) expect(href, `${route} Sheen link`).toBeTruthy();

      expect(problems, `${route} console and network`).toEqual([]);
    });
  }

  test("the wallet picker lists the testnet wallets with their logos", async ({ page }) => {
    await page.goto("/#/");
    await page.getByTestId("connect-wallet").first().click();
    const dialog = page.getByTestId("connect-dialog");
    await expect(dialog).toBeVisible();
    const tiles = dialog.locator(".wp-grid").first().locator(".wp-tile");
    expect(await tiles.count()).toBeGreaterThanOrEqual(3);
    await expect(tiles.filter({ hasText: "Meteor" })).toHaveCount(1);
    const logos = await dialog.locator(".wp-tile img").evaluateAll((imgs) => Promise.all(imgs.map((i) => (i as HTMLImageElement).decode().then(() => [i.getAttribute("alt"), (i as HTMLImageElement).naturalWidth > 0], () => [i.getAttribute("alt"), false]))));
    for (const [name, loaded] of logos) expect(loaded, `${name} logo`).toBe(true);
  });

  test("1920px wide screens get the wide column", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const route of ["#/", "#/groups", "#/proof", "#/about"]) {
      await page.goto(`/${route}`);
      await page.waitForLoadState("networkidle");
      // Pages load lazily and fade in, so wait for the column rather than reading it once.
      await expect
        .poll(() => page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("main .wrap")].map((el) => el.getBoundingClientRect().width))), { message: `${route} column at 1920px` })
        .toBeGreaterThan(1280);
    }
  });
});
