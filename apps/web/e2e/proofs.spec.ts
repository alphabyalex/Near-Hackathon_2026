/** The latest proofs feed on #/proof: every row opens its plain-English explanation in place, one at a time. */
import { expect, expectNoHorizontalScroll, test } from "./fixtures";

test.describe("latest proofs", () => {
  test("each proofs row expands and collapses", async ({ page }) => {
    // The stub API seeds a few metered calls (paid and refused), so the feed needs no live data.
    await page.goto("/#/proof");
    const feed = page.getByTestId("proofs");
    const rows = feed.locator("li.pf-item");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);
    const buttons = feed.locator("button.pf-row");
    await expect(buttons).toHaveCount(count);
    for (let i = 0; i < count; i++) await expect(buttons.nth(i)).toHaveAttribute("aria-expanded", "false");

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const panel = page.locator(`[id="${await button.getAttribute("aria-controls")}"]`);
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".pf-story")).not.toBeEmpty();
      await expect(panel).toContainText("This pattern is drawn from the call's signed receipt, so every answer gets its own.");
      // One open at a time.
      await expect(feed.locator('button.pf-row[aria-expanded="true"]')).toHaveCount(1);
      if (i > 0) await expect(buttons.nth(i - 1)).toHaveAttribute("aria-expanded", "false");
    }

    // A second click on the open row closes it.
    const last = buttons.nth(count - 1);
    await last.click();
    await expect(last).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(`[id="${await last.getAttribute("aria-controls")}"]`)).toBeHidden();
    await expect(feed.locator('button.pf-row[aria-expanded="true"]')).toHaveCount(0);

    // Clicking the fingerprint, outside the button's own text, toggles the row too.
    await rows.first().locator(".pf-line").click({ position: { x: 10, y: 20 } });
    await expect(buttons.first()).toHaveAttribute("aria-expanded", "true");

    // The transaction link is never inside a row's button.
    await expect(feed.locator("button a")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});
