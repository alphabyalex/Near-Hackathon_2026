import type { Page } from "@playwright/test";
import { OWNER_ACCOUNT } from "./keys";
import { expect, expectAccessible, expectNoHorizontalScroll, test } from "./fixtures";

/** Presses Tab until the focused element matches, the way a keyboard user would get there. */
async function tabTo(page: Page, matches: (el: { tag: string; name: string; testId: string | null }) => boolean, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return { tag: "", name: "", testId: null };
      const label = a.getAttribute("aria-label") ?? (a as HTMLInputElement).labels?.[0]?.textContent ?? a.textContent ?? "";
      return { tag: a.tagName.toLowerCase(), name: label.trim().replace(/\s+/g, " "), testId: a.getAttribute("data-testid") ?? a.closest("[data-testid]")?.getAttribute("data-testid") ?? null };
    });
    if (matches(el)) return;
  }
  throw new Error("Never reached the element by Tab.");
}

const focusedInDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

test.describe("keyboard only", () => {
  test("join the Mutual, cast a vote and run a demo scene without a mouse", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    await expect(page.getByTestId("home-stats")).toBeVisible();

    // Join the Mutual.
    await tabTo(page, (el) => el.tag === "button" && el.name === "Become a member");
    await page.keyboard.press("Enter");
    const dlg = page.getByTestId("join-dialog");
    await expect(dlg).toBeVisible();
    expect(await focusedInDialog(page)).toBe(true);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("10");
    await tabTo(page, (el) => el.name === "Your NEAR account");
    await page.keyboard.type(OWNER_ACCOUNT);
    await tabTo(page, (el) => el.tag === "button" && el.name === "Test wallet");
    await page.keyboard.press("Enter");
    await tabTo(page, (el) => el.tag === "button" && el.name === "Deposit 10.00 USDC");
    await page.keyboard.press("Enter");
    await expect(dlg.getByTestId("join-done")).toContainText("You received");
    await tabTo(page, (el) => el.tag === "button" && el.name === "Go to my share");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/me$/);

    // Cast a vote on #/me.
    const vote = page.getByTestId("me-open-vote").filter({ hasText: "Lower the Gold fee to 0.75%" });
    await expect(vote.getByRole("button", { name: "Vote for" })).toBeEnabled();
    await tabTo(page, (el) => el.tag === "button" && el.name === "Vote for");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("me-past-votes")).toContainText("Lower the Gold fee to 0.75%");

    // Run a demo scene.
    await page.goto("/#/demo");
    await expect(page.getByRole("heading", { name: "Seven scenes, real code paths" })).toBeVisible();
    await tabTo(page, (el) => el.tag === "button" && el.name.includes("Swapped model"));
    await page.keyboard.press("Enter");
    await tabTo(page, (el) => el.tag === "button" && el.name === "Run scene");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-scene-result="swap"] .verdict')).toHaveText("Below the line: refused and refunded");
  });

  test("the dialog traps focus, Escape closes it, and focus returns to the opener", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("home-stats")).toBeVisible();
    await tabTo(page, (el) => el.tag === "button" && el.name === "Become a member");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("join-dialog")).toBeVisible();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      expect(await focusedInDialog(page)).toBe(true);
    }
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusedInDialog(page)).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("join-dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Become a member");
  });

  test("keyboard focus is visible on every kind of control", async ({ page, browserName }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("home-stats")).toBeVisible();
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body) return null;
        const s = getComputedStyle(a);
        return { tag: a.tagName.toLowerCase(), style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
      if (!ring) continue;
      seen.add(ring.tag);
      expect(ring.style, `${ring.tag} has no focus ring`).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
    }
    // Safari's default skips links on Tab (Option+Tab reaches them), so links are checked elsewhere.
    if (browserName !== "webkit") expect(seen.has("a")).toBe(true);
    expect(seen.has("button")).toBe(true);
  });
});

test.describe("text alternatives and dialogs", () => {
  test("the hero sphere, fingerprints and charts describe themselves", async ({ page, wallets }) => {
    await page.goto("/#/");
    await expect(page.getByRole("img", { name: /A sphere of dots cut by one line/ })).toBeVisible();
    await page.goto("/#/proof");
    await expect(page.getByTestId("proofs").getByRole("img", { name: /^Call [0-9a-f]{8}, (above|below) the line$/ }).first()).toBeVisible();
    await page.goto("/#/app/share");
    const { signInAs } = await import("./fixtures");
    await signInAs(page, wallets, OWNER_ACCOUNT);
    await expect(page.getByTestId("price-chart").getByRole("img", { name: /WARD price since launch: [0-9.]+ to [0-9.]+ USDC/ })).toBeVisible();
  });

  for (const size of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "390", width: 390, height: 844 },
  ]) {
    test(`dialogs pass axe and fit at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/#/");
      await expect(page.getByTestId("home-stats")).toBeVisible();
      await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
      await expect(page.getByTestId("join-dialog")).toBeVisible();
      await expectAccessible(page);
      await expectNoHorizontalScroll(page);
      await page.keyboard.press("Escape");
      await page.getByTestId("connect-wallet").click();
      await expect(page.getByTestId("connect-dialog")).toBeVisible();
      await expectAccessible(page);
      await expectNoHorizontalScroll(page);
    });
  }
});
