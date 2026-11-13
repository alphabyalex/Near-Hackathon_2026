import type { Page } from "@playwright/test";
import { API_PORT, APPROVER_ACCOUNT, OWNER_ACCOUNT, VENDOR_NEAR_ACCOUNT } from "./keys";
import { expect, expectAccessible, expectNoHorizontalScroll, signInAs, test } from "./fixtures";
import repo from "../../../repo.config.json" with { type: "json" };

// #/me and #/demo now redirect to #/wallet and #/about/steps (the redirects are covered in a21.spec.ts).
const PAGES = ["#/", "#/wallet", "#/groups", "#/proof", "#/try", "#/developers", "#/verify", "#/about"];

/** Connects the test wallet for an account through the header's Connect wallet dialog. */
async function connectWallet(page: Page, account: string) {
  await page.getByTestId("connect-wallet").click();
  const dlg = page.getByTestId("connect-dialog");
  await dlg.getByLabel("NEAR account").fill(account);
  await dlg.locator('[data-wallet="test-wallet"]').click();
  await dlg.getByRole("button", { name: "Use this wallet" }).click();
  await expect(page.getByTestId("connect-wallet")).toContainText(account);
}

test.describe("brand assets", () => {
  test("index.html links the favicons, touch icon, manifest, theme color and social card", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain('<link rel="icon" href="/favicon.ico"');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest"');
    expect(html).toContain('<meta name="theme-color" content="#0E0912"');
    // Social cards need an absolute URL, which exists only once the site is hosted (repo.config.json).
    if (repo.hosted.web) expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\/og-image\.png"/);
    else expect(html).toContain('<meta property="og:image" content="/og-image.png"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    const manifest = (await (await request.get("/site.webmanifest")).json()) as { name: string; theme_color: string; background_color: string; icons: { src: string }[] };
    expect(manifest).toMatchObject({ name: "Wardline", theme_color: "#0E0912", background_color: "#0E0912" });
    for (const path of ["/favicon.ico", "/favicon.svg", "/favicon-32.png", "/apple-touch-icon.png", "/og-image.png", ...manifest.icons.map((i) => i.src)]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});

test.describe("public site", () => {
  test("home: the hero, both sides of the line with real counts, the comparison, the safest groups and the nav", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A credit union for the AI economy.");
    await expect(page.locator(".hero-sub")).toContainText("Anything that can't prove itself stays below the line.");
    const stats = page.getByTestId("home-stats");
    await expect(stats.locator("dt")).toHaveText(["Total pooled", "WARD price", "Paid above the line", "Kept below it"]);
    await expect(stats).toContainText("USDC per WARD");
    await expect(stats.locator(".live-cell.below .live-value")).toHaveText(/^\d+$/);
    // Sim mode: the same strip, no live label.
    await expect(page.locator(".live-label")).toHaveCount(0);
    // No network badge outside the wallet panel.
    await expect(page.locator("footer")).not.toContainText("testnet");
    // The hero strip already counts both sides, so the page does not count them a second time.
    await expect(page.getByRole("heading", { level: 2, name: "Every payment, counted." })).toHaveCount(0);
    // The agent alone against the agent with Wardline, on the same 20 scams.
    await expect(page.getByRole("heading", { level: 2, name: "We tested 20 scam invoices" })).toBeVisible();
    const cmp = page.getByTestId("comparison");
    await expect(cmp.locator(".alone .cmp2-num")).toHaveText("5");
    await expect(cmp.locator(".with .cmp2-num")).toHaveText("0");
    await expect(cmp.locator(".with .cmp2-dots i.stopped")).toHaveCount(20);
    await expect(cmp.locator(".alone .cmp2-dots i.paid")).toHaveCount(5);
    await expect(page.locator("ul.share-lines li")).toHaveCount(3);
    const board = page.getByTestId("leaderboard");
    await expect(board.locator("tbody tr").first()).toContainText("Mission Street hacker house");
    await expect(board.locator("tbody tr").first().locator(".tier-name")).toHaveText("Gold");
    await expect(board.locator('tr[data-budget="bgt_kelp"] .tier-name')).toHaveText("Bronze");
    const nav = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    // Docs sits apart, top right; its copy inside the nav only shows in the phone menu.
    await expect(nav).toHaveText(["Mutual", "Groups", "Proof engine", "About"]);
    await expect(nav.first()).toHaveAttribute("aria-current", "page");
    const docs = page.locator("header .docs-link");
    await expect(docs).toHaveText("Docs");
    await expect(docs).toHaveAttribute("href", "#/developers");
    await expect(docs).not.toHaveAttribute("aria-current", "page");
    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "#/developers");
    await expect(footer.getByRole("link", { name: "Your balance" })).toHaveAttribute("href", "#/wallet");
    await expect(footer.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#/about/steps");
    await page.locator(".hero").getByRole("button", { name: "Watch a payment cross the line" }).click();
    await expect(page.locator("#watch")).toBeInViewport();
    await expect(page.locator("#watch")).toBeFocused();
    await page.getByLabel("Wardline home").first().click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test("home: blocks fade in as they scroll into view, and nothing is hidden under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/");
    await expect(page.getByTestId("leaderboard")).toBeVisible();
    await expect(page.locator("[data-rv]")).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    await expect(page.getByTestId("leaderboard")).toHaveCount(1);
    // Below the fold at load: waiting, not yet shown.
    await expect(page.locator('.cta .wrap > *[data-rv="out"]').first()).toBeAttached();
    await page.locator(".cta").scrollIntoViewIfNeeded();
    // Scroll down the way a person does; each block settles as it arrives.
    for (let y = 0; y < 8000; y += 350) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(60);
    }
    // Once in view every block settles back to its own styles: no leftover hidden state.
    await expect(page.locator("[data-rv]")).toHaveCount(0, { timeout: 8_000 });
    await expect(page.getByRole("heading", { level: 2, name: "Back the AI economy and earn from it" })).toBeVisible();
    await expect(page.locator(".cta").getByRole("button", { name: "Become a member" })).toBeVisible();
  });

  test("home: the closing Become a member opens the app: the wallet picker first, then Your balance", async ({ page, wallets }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    const cta = page.locator(".cta").getByRole("button", { name: "Become a member" });
    await cta.scrollIntoViewIfNeeded();
    // No wallet yet: the picker opens, and the join dialog does not.
    await cta.click();
    const dlg = page.getByTestId("connect-dialog");
    await expect(dlg).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Join the Mutual" })).toHaveCount(0);
    await dlg.getByLabel("NEAR account").fill(OWNER_ACCOUNT);
    await dlg.locator('[data-wallet="test-wallet"]').click();
    await dlg.getByRole("button", { name: "Use this wallet" }).click();
    // Connected: on into the app.
    await expect(page).toHaveURL(/#\/wallet$/);
    // Already connected: straight in, no picker.
    await page.goto("/#/");
    const again = page.locator(".cta").getByRole("button", { name: "Become a member" });
    await again.scrollIntoViewIfNeeded();
    await again.click();
    await expect(page).toHaveURL(/#\/wallet$/);
    await expect(page.getByTestId("connect-dialog")).toHaveCount(0);
  });

  test("hero: the final frame under reduced motion; otherwise the entrance, then a slow drift that stops off screen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/");
    const hero = page.getByTestId("hero-canvas");
    await expect(hero).toHaveAttribute("data-motion", "still");
    await expect(hero).toHaveAttribute("role", "img");
    expect(await page.locator(".hero-h1").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    await expect(hero).toHaveAttribute("data-motion", "playing");
    // Off screen, the drift stops; back on screen it carries on.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(hero).toHaveAttribute("data-motion", "paused", { timeout: 5_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(hero).toHaveAttribute("data-motion", "playing", { timeout: 5_000 });
  });

  test("watch a payment cross the line: plays once in view and rests on its last frame, with no replay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/#/");
    const stage = page.getByTestId("explainer-stage");
    await expect(stage).toHaveAttribute("data-motion", "waiting");
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toHaveAttribute("data-motion", "playing", { timeout: 5_000 });
    await expect(stage).toHaveAttribute("data-motion", "done", { timeout: 20_000 });
    await expect(page.locator("#watch").getByRole("button")).toHaveCount(0);
    await expect(stage).toHaveAttribute("aria-label", /refused, drops below the line and is refunded/);
    // How it works moved onto About as the seven steps; the explainer is on Home only.
    await page.goto("/#/how-it-works");
    await expect(page).toHaveURL(/#\/about\/steps$/);
    await expect(page.locator("#steps-title")).toHaveText("How it works");
    await expect(page.getByTestId("explainer-stage")).toHaveCount(0);
    // The old address still opens the same page.
    await page.goto("/#/demo");
    await expect(page).toHaveURL(/#\/about\/steps$/);
    await expect(page.locator("#steps-title")).toHaveText("How it works");
  });

  test("hero: nothing listens to the mouse", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __moves: string[] }).__moves = seen;
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type: string, ...rest: unknown[]) {
        if (/^(mousemove|pointermove|mouseover|pointerover)$/.test(type)) {
          const el = this as unknown as Element;
          const where = this === window ? "window" : this === document ? "document" : el.closest?.(".hero") ? "hero" : el.id === "root" ? "react-root" : (el.tagName ?? "other");
          seen.push(`${type}@${where}`);
        }
        return (add as (...a: unknown[]) => void).call(this, type, ...rest);
      };
    });
    await page.goto("/#/");
    await expect(page.getByTestId("hero-canvas")).toBeVisible();
    await page.waitForTimeout(800);
    const moves = await page.evaluate(() => (window as unknown as { __moves: string[] }).__moves);
    // React delegates its own events at its root; nothing else may listen for mouse movement.
    expect(moves.filter((m) => !m.endsWith("@react-root"))).toEqual([]);
    expect(await page.locator(".hero [onmousemove], .hero [onpointermove]").count()).toBe(0);
  });

  test("try it: resolve gives PAY with a receipt the browser verifies; check blocks a look-alike", async ({ page }) => {
    await page.goto("/#/try");
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    const card = page.locator(".result");
    await expect(card).toHaveAttribute("data-verdict", "PAY");
    await expect(card.locator(".tier")).toContainText("Domain linked");
    await expect(card).toContainText("near:testnet:northwind.testnet");
    await card.getByRole("button", { name: "Verify signature" }).click();
    await expect(card.locator("[data-verified]")).toHaveAttribute("data-verified", "valid");

    await page.getByRole("tab", { name: "Check an address" }).click();
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(card).toHaveAttribute("data-verdict", "BLOCK");
    await expect(card).toContainText("This account imitates one the vendor linked.");
    await expect(card.locator(".tier")).toContainText("Not verified");
  });

  test("how it works: seven steps on About run the real endpoints, each lands above or below the line", async ({ page }) => {
    await page.goto("/#/about/steps");
    await expect(page.getByTestId("stage").locator(".stage-n")).toHaveText("Step 1 of 7");
    await expect(page.locator("[data-scene]")).toHaveCount(7);
    const stage = page.getByTestId("stage");
    const run = async (id: string) => {
      await page.locator(`[data-scene="${id}"]`).click();
      await stage.locator(`[data-run="${id}"]`).click();
      const out = stage.locator(`[data-scene-result="${id}"]`);
      await expect(out).toBeVisible({ timeout: 15_000 });
      // A step runs once: no button to run it again.
      await expect(stage.locator(`[data-run="${id}"]`)).toHaveCount(0);
      return out;
    };

    let out = await run("mutual");
    await expect(out).toHaveAttribute("data-outcome", "above");
    await expect(out.locator(".verdict")).toContainText("Above the line:");
    await expect(out).toContainText("maya.testnet");
    // A simulated id is a short label with the full id on hover, never a raw sim-... string.
    await expect(out.locator(".tx-id")).toContainText("Simulated transaction");
    await expect(out.locator(".tx-id")).toHaveAttribute("title", /^sim-deposit-/);
    await expect(out).not.toContainText("sim-deposit-");

    out = await run("group");
    await expect(out.locator(".verdict")).toHaveText("Above the line: 8 calls paid on proof");
    await expect(out).toContainText("DeepSeek V4.1 Flash");
    await expect(out).toContainText("1.000000 to 1.000500");

    out = await run("swap");
    await expect(out).toHaveAttribute("data-outcome", "below");
    await expect(out.locator(".verdict")).toHaveText("Below the line: refused and refunded");
    await expect(out).toContainText("The signature names a different model.");
    await expect(out.locator("dd.t-below")).toContainText("GLM-5.3 Flash");

    out = await run("leak");
    await expect(out.locator(".verdict")).toHaveText("Below the line: capped at 15.00 USDC");
    await expect(out).toContainText("Spent 15.00 of 15.00 USDC");
    await expect(out).toContainText("50 requests refused with 402");

    out = await run("invoice");
    await expect(out.locator(".verdict")).toHaveText("Below the line: blocked before the vote");
    await expect(out).toContainText("northw1nd.testnet");
    await expect(out.locator(".result")).toHaveAttribute("data-verdict", "BLOCK");

    out = await run("payout");
    // Our stake paying is the protection working: not a below-the-line red.
    await expect(out).toHaveAttribute("data-outcome", "tier");
    await expect(out).toContainText("Paid by Wardline's stake 8.00, paid by WARD holders 0.00");
    await expect(out).toContainText("1.0000 to 0.9958");
    await expect(out).toContainText("0.9958 to 1.0000");

    out = await run("tier");
    await expect(out).toHaveAttribute("data-outcome", "tier");
    await expect(out.locator(".verdict")).toHaveText("Silver: the fee drops to 1.50%");
    await expect(out).toContainText("0.0100 USDC");
    await expect(out).toContainText("0.0075 USDC");

    // Next step moves along the list.
    await page.locator('[data-scene="swap"]').click();
    await stage.getByRole("button", { name: "Next step" }).click();
    await expect(stage.locator("h2")).toHaveText("Leaked key");
    // The 5-of-20 comparison moved to Home; the home test checks it.
  });

  test("join the Mutual: a dialog with quick picks, our stake in front, a wallet approval, then the member card and a 7-day sell request on the balance page", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    const opener = page.locator(".hero").getByRole("button", { name: "Become a member" });
    await opener.click();
    const dlg = page.getByTestId("join-dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("heading", { name: "Join the Mutual" })).toBeVisible();
    // Escape closes and focus returns to the opener.
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await dlg.getByRole("button", { name: "100", exact: true }).click();
    await expect(dlg.getByLabel("Amount in USDC")).toHaveValue("100");
    await expect(dlg).toContainText("You receive");
    await expect(dlg).toContainText("Our stake in front of yours");
    await dlg.getByRole("button", { name: "10", exact: true }).click();
    await dlg.getByLabel("Your NEAR account").fill(OWNER_ACCOUNT);
    await dlg.locator('[data-wallet="test-wallet"]').click();
    await expectAccessible(page);
    await dlg.getByRole("button", { name: "Deposit 10.00 USDC" }).click();
    await expect(dlg.getByTestId("join-done")).toContainText("You received");
    await expect(dlg.getByTestId("join-done")).toContainText("WARD");
    await dlg.getByRole("button", { name: "Go to my share" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page).toHaveURL(/#\/wallet$/);
    await expect(page.getByTestId("connect-wallet")).toContainText(OWNER_ACCOUNT);
    await page.goto("/#/");

    const card = page.getByTestId("member-card");
    const position = card.getByTestId("pool-position");
    await expect(position).toContainText("WARD held");
    await expect(position).toContainText(OWNER_ACCOUNT);
    // Selling moved to the Balance page: the card links there instead of opening a Redeem disclosure.
    await expect(card.getByText("Redeem WARD")).toHaveCount(0);
    await card.getByRole("link", { name: "Sell or redeem on your balance page" }).click();
    await expect(page).toHaveURL(/#\/wallet$/);
    await page.getByTestId("bal-ward").getByRole("button", { name: "Request to sell" }).click();
    const sell = page.getByTestId("sell-form");
    await sell.getByLabel("WARD to sell").fill("5");
    await sell.getByRole("button", { name: "Request to sell this WARD" }).click();
    await expect(sell.getByRole("status")).toContainText("WARD locked. Redeemable from");
    await expect(page.getByTestId("redemption")).toContainText(/Unlocks in (7d 0h|6d 23h)/);
    await page.goto("/#/");
    await expect(position).toContainText("Locked for redemption");
    await expect(card.getByTestId("redemption")).toContainText(/Unlocks in (7d 0h|6d 23h)/);
  });

  test("governance: WARD holders vote with their wallet, anyone executes a passed proposal, once", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    const gov = page.getByTestId("governance");
    // Votes and groups share one section; the votes sit in its left column.
    await expect(page.getByRole("heading", { level: 2, name: "Run by the people who hold it" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Safest groups" })).toBeVisible();
    // No connect row in the middle of the page.
    await expect(gov.locator(".voter")).toHaveCount(0);
    // The record sits behind one click; the open votes are the news.
    await gov.getByRole("button", { name: /^Decided \(\d+\)/ }).click();
    // Each change in plain English, old value to new.
    const executed = gov.locator('.prop[data-status="executed"]', { hasText: "Set the Gold fee to 1.00%" });
    await expect(executed.getByTestId("prop-change")).toHaveText(/^Gold fee is now 1\.00%, was \d\.\d\d%$/);
    await expect(executed.getByRole("progressbar")).toHaveCount(0);
    await expect(gov.locator('.prop[data-status="rejected"]')).toContainText("Raise the Bronze fee to 2.50%");

    const mine = gov.locator(".prop", { hasText: "Lower the Gold fee to 0.75%" });
    await expect(mine).toHaveAttribute("data-status", "open");
    await expect(mine.getByTestId("prop-change")).toHaveText(/^Gold groups would pay 0\.75% instead of \d\.\d\d%$/);
    await expect(mine.locator(".prop-progress")).toContainText(/Needs \d+(\.\d)?% of WARD to vote/);
    await expect(mine.getByRole("progressbar")).toBeVisible();
    await expect(mine.locator(".prop-when")).toHaveText(/^(\d+ days? \d+ hours? left|\d+ hours? \d+ min left|\d+ min left)$/);
    // Without a wallet the vote button is the way in: it opens the wallet picker.
    await mine.getByRole("button", { name: "Vote for" }).click();
    await expect(page.getByTestId("connect-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("connect-dialog")).toHaveCount(0);
    await connectWallet(page, OWNER_ACCOUNT);
    // The picker closes once the wallet connects.
    await expect(page.getByTestId("connect-dialog")).toHaveCount(0);
    await expect(gov.locator(".voter")).toContainText(OWNER_ACCOUNT);
    await expect(mine).toContainText(/Your vote: [0-9.]+ WARD/);
    const split = (await mine.locator(".prop-split").textContent()) ?? "";
    await mine.getByRole("button", { name: "Vote for" }).click();
    await expect(mine.getByRole("status")).toContainText("Vote counted: for.");
    // The share of WARD voting for moves with the vote.
    await expect(gov.locator(".prop", { hasText: "Lower the Gold fee to 0.75%" }).locator(".prop-split")).not.toHaveText(split);

    const silver = gov.locator(".prop", { hasText: "Lower the Silver fee to 1.25%" });
    await expect(silver).toContainText("You held no WARD when this opened.");
    await expect(silver.getByTestId("prop-change")).toHaveText("Silver groups would pay 1.25% instead of 1.50%");

    // Propose a change: a disclosure button; fee or coverage only.
    const propose = gov.getByRole("button", { name: "Propose a change" });
    await expect(propose).toHaveAttribute("aria-expanded", "false");
    await propose.click();
    await expect(propose).toHaveAttribute("aria-expanded", "true");
    await expect(gov.locator(".propose select").first().locator("option")).toHaveText(["Fee for a tier", "Coverage for every tier", "Sell wait (days)"]);

    const passed = gov.locator('.prop[data-status="passed"]', { hasText: "Raise coverage to 1.25x" });
    await passed.getByRole("button", { name: "Execute" }).click();
    await expect(gov.locator('.prop[data-status="executed"]', { hasText: "Raise coverage to 1.25x" })).toBeVisible();
    await expect(gov.locator('.prop[data-status="passed"]', { hasText: "Raise coverage to 1.25x" })).toHaveCount(0);
    await expectAccessible(page);
  });

  test("groups: the orbit with filters and a detail panel, three tiers, and four steps to start one", async ({ page }) => {
    await page.goto("/#/groups");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The orbit.");
    const tiers = page.getByTestId("tier-table").locator(".ob-tier");
    await expect(tiers).toHaveCount(3);
    await expect(tiers.locator(".tier-name")).toHaveText(["Bronze", "Silver", "Gold"]);
    await expect(tiers.locator(".ob-tier-fee")).toHaveText(["2.00%", "1.50%", "1.00%"]);
    await expect(tiers.nth(1)).toContainText("10 clean proven calls in a row at Bronze");

    const canvas = page.locator(".ob-canvas");
    await expect(canvas).toBeVisible();
    const detail = page.getByTestId("group-detail");
    const filters = page.getByRole("group", { name: "Show" }).getByRole("button");
    await expect(filters).toHaveText(["All", "Groups", "Solo builders"]);
    await expect(filters.first()).toHaveAttribute("aria-pressed", "true");
    // Turns the orbit with Next group until this group is at the front.
    const bringToFront = async (id: string) => {
      const n = Number(await canvas.getAttribute("data-count"));
      for (let i = 0; i < n && (await detail.getAttribute("data-budget")) !== id; i++) {
        const before = (await detail.getAttribute("data-budget")) ?? "";
        await page.getByRole("button", { name: "Next group" }).click();
        await expect(detail).not.toHaveAttribute("data-budget", before);
      }
      await expect(detail).toHaveAttribute("data-budget", id);
      await expect(canvas).toHaveAttribute("data-selected", id);
    };
    const proven = async () => Number(((await detail.locator(".ob-stats div", { hasText: "Proven" }).locator("dd").textContent()) ?? "").replace(/,/g, ""));
    // The top-ranked group starts at the front.
    await expect(detail).toHaveAttribute("data-budget", "bgt_mission");
    await expect(page.locator(".ob-counter")).toHaveText(/^1 of \d+$/);
    await expect(detail).toHaveAttribute("data-tier", "gold");
    await expect(detail).toContainText("Mission Street hacker house");
    await expect(detail).toContainText("Top tier reached");
    await expect(page.locator(".ob-open")).toHaveAttribute("href", /nearblocks\.io\/address\//);
    const missionCalls = await proven();
    await bringToFront("bgt_kelp");
    await expect(detail).toHaveAttribute("data-tier", "bronze");
    await expect(detail.locator(".ob-next")).toContainText("clean payments to Silver");
    // A bigger record ranks higher.
    expect(missionCalls).toBeGreaterThan(await proven());
    await bringToFront("bgt_nightshade");
    await expect(detail).toContainText("clean payments to Gold");
    await page.getByRole("button", { name: "Previous group" }).click();
    await expect(detail).not.toHaveAttribute("data-budget", "bgt_nightshade");
    await filters.nth(2).click();
    await expect(filters.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(filters.first()).toHaveAttribute("aria-pressed", "false");
    await filters.first().click();
    await expect(filters.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".ob-steps li b")).toHaveText(["Connect your DAO", "Vote in a budget", "Members get keys", "Change one line"]);
    await expectAccessible(page);
  });

  test("proof engine: the one-line snippet, four steps, the latest proofs on each side of the line, and the red-team numbers", async ({ page }) => {
    await page.goto("/#/proof");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing crosses the line without proof.");
    await expect(page.locator(".snippet")).toContainText("/v1/ai");
    await expect(page.locator(".steps-row li b")).toHaveText(["Reserve", "Forward", "Prove", "Settle"]);
    const proofs = page.getByTestId("proofs");
    await expect(proofs.locator('li.pf-item[data-side="above"]').first().locator(".pf-verdict")).toHaveText("Paid");
    await expect(proofs.locator('li.pf-item[data-side="below"]').first().locator(".pf-verdict")).toHaveText(/^(Refunded|Capped|Blocked)$/);
    await expect(proofs.locator('li.pf-item[data-side="below"] svg.fp-below')).toHaveCount(await proofs.locator('li.pf-item[data-side="below"]').count());
    await expect(proofs.locator("button.pf-row").first()).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("proof-stats")).toContainText("100%");
    await expect(page.locator("main")).not.toContainText("stub rules engine");
    const verify = page.getByTestId("verify-business");
    await expect(verify.getByRole("heading", { level: 2 })).toHaveText("Verify your business. Get paid without a hold.");
    await verify.getByRole("link", { name: "Verify your business" }).click();
    await expect(page).toHaveURL(/#\/verify$/);
  });

  test("developers: with no API URL set, snippets show the hosted URL, never a variable or localhost; copy works", async ({ page, context, browserName }) => {
    // Only Chromium lets a test grant and read the clipboard; elsewhere the button label is the check.
    if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // The old route still works: it lands here and the address bar shows the new one.
    await page.goto("/#/connect");
    await expect(page).toHaveURL(/#\/developers$/);
    // Developers is the quiet Docs link top right.
    await expect(page.locator("header .docs-link")).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-unset]')).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("VITE_WARDLINE");
    await expect(page.locator("main")).not.toContainText("process.env.WARDLINE_API_URL");
    // The hosted URLs, or the named placeholder while nothing is hosted: never a local address.
    const api = repo.hosted.api || "https://your-wardline-api.example";
    const mcp = repo.hosted.mcp || "https://your-wardline-api.example/mcp";
    await expect(page.locator("main")).not.toContainText("127.0.0.1");
    await expect(page.locator("main")).not.toContainText("localhost");
    // One code panel for the picked path; AI models is picked first.
    const picks = page.getByRole("group", { name: "What are you building?" }).getByRole("button");
    await expect(picks).toHaveCount(3);
    await expect(picks.first()).toHaveAttribute("aria-pressed", "true");
    const panel = page.locator(".codetabs [role=tabpanel]:visible");
    await expect(page.getByRole("tab", { name: "JavaScript" })).toHaveAttribute("aria-selected", "true");
    await expect(panel).toContainText(`baseURL: "${api}/v1/ai"`);
    await page.getByRole("tab", { name: "Python" }).click();
    await expect(panel).toContainText(`base_url="${api}/v1/ai"`);
    await picks.filter({ hasText: "An agent that pays vendors" }).click();
    await expect(picks.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "MCP URL" }).click();
    await expect(panel).toContainText(mcp);
    await page.getByRole("tab", { name: "curl resolve" }).click();
    await expect(panel).toContainText(`curl -s ${api}/v1/resolve`);
    await page.getByRole("button", { name: "Copy curl resolve" }).click();
    await expect(page.getByRole("button", { name: "Copy curl resolve" })).toHaveText("Copied");
    if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/v1/resolve");
    await expect(page.getByRole("link", { name: "llms.txt", exact: true })).toHaveAttribute("href", "/llms.txt");
    // #/developers/<path> opens that path.
    await page.goto("/#/developers/app");
    await expect(picks.filter({ hasText: "My own app" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "SDK, hosted" })).toHaveAttribute("aria-selected", "true");
  });

  test("developers: with VITE_ URLs set, snippets use them", async ({ page }) => {
    await page.goto(`http://127.0.0.1:5198/#/developers`);
    await expect(page.locator('[data-unset="api"]')).toHaveCount(0);
    // One path and one tab at a time: click through to each snippet.
    const panel = page.locator(".codetabs [role=tabpanel]:visible");
    await expect(panel).toContainText('baseURL: "https://api.wardline.example/v1/ai"');
    await page.getByRole("tab", { name: "Python" }).click();
    await expect(panel).toContainText('base_url="https://api.wardline.example/v1/ai"');
    await page.getByRole("group", { name: "What are you building?" }).getByRole("button", { name: /An agent that pays vendors/ }).click();
    await page.getByRole("tab", { name: "MCP URL" }).click();
    await expect(panel).toContainText("https://mcp.wardline.example/mcp");
    await page.getByRole("tab", { name: "curl check" }).click();
    await expect(panel).toContainText("https://api.wardline.example/v1/check");
  });

  test("verify: sign with NEAR, EVM and Solana wallets, host the file, reach domain linked", async ({ page, wallets, request }) => {
    const domain = `acme-${Date.now()}.example`;
    wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
    await page.goto("/#/verify");
    await page.getByLabel("Your domain").fill(domain);
    await page.getByLabel("Display name").fill("Acme Freight");
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByLabel("NEAR account").fill(VENDOR_NEAR_ACCOUNT);
    await page.getByRole("button", { name: "Sign with Test wallet" }).click();
    await expect(page.locator(".signed li")).toHaveCount(1);
    await page.getByRole("button", { name: "Connect and sign" }).first().click();
    await expect(page.locator(".signed li")).toHaveCount(2);
    await page.getByRole("button", { name: "Connect and sign" }).nth(1).click();
    await expect(page.locator(".signed li")).toHaveCount(3);
    await expect(page.locator(".signed")).toContainText("eip155:84532:");
    await expect(page.locator(".signed")).toContainText("solana:devnet:");
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.locator(".host-url")).toHaveText(`https://${domain}/.well-known/wardline-payee.json`);
    // Headless Chromium on this machine never completes blob downloads, so capture the blob and anchor the button hands to the browser.
    await page.evaluate(() => {
      const w = window as unknown as { __dl?: { name: string; text: Promise<string> } };
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = create(blob);
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.href === url) w.__dl = { name: this.download, text: (blob as Blob).text() };
          else click.call(this);
        };
        return url;
      };
    });
    await page.getByRole("button", { name: "Download wardline-payee.json" }).click();
    const captured = await page.evaluate(async () => {
      const dl = (window as unknown as { __dl?: { name: string; text: Promise<string> } }).__dl;
      return dl ? { name: dl.name, text: await dl.text } : null;
    });
    expect(captured?.name).toBe("wardline-payee.json");
    const text = captured?.text ?? "";
    const json = JSON.parse(text) as { version: number; domain: string; accounts: { proof: { type: string } }[] };
    expect(json).toMatchObject({ version: 2, domain });
    expect(json.accounts.map((a) => a.proof.type)).toEqual(["nep413", "eip191", "solana-ed25519"]);
    // The vendor hosts the file on its website.
    await request.post(`http://127.0.0.1:${API_PORT}/__e2e/host`, { data: { domain, file: text } });

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Check my domain" }).click();
    const reached = page.locator(".reached");
    await expect(reached).toHaveAttribute("data-reached", "T2_DOMAIN_LINKED");
    await expect(reached.locator(".tier")).toContainText("Domain linked");
    await expect(reached).toContainText("Legal ownership");
    await expect(reached.locator(".acct-list li")).toHaveCount(3);
    await expect(reached.locator(".acct-list")).not.toContainText("cooldown");
  });

  test("verify: an unhosted domain fails with the reason", async ({ page, wallets }) => {
    wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
    await page.goto("/#/verify");
    await page.getByLabel("Your domain").fill("not-hosted.example");
    await page.getByLabel("Display name").fill("Nobody");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("NEAR account").fill(VENDOR_NEAR_ACCOUNT);
    await page.getByRole("button", { name: "Sign with Test wallet" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Check my domain" }).click();
    await expect(page.getByRole("alert")).toContainText("answered 404");
  });

  test("about: trust levels say what each does not establish", async ({ page }) => {
    await page.goto("/#/about");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wardline is a credit union for the AI economy.");
    await expect(page.locator("#steps-title")).toHaveText("How it works");
    await expect(page.locator("[data-scene]")).toHaveCount(7);
    await expect(page.locator(".tbl.trust tbody tr")).toHaveCount(5);
    await expect(page.locator(".tbl.trust")).toContainText("Legal ownership");
  });

  for (const path of PAGES) {
    test(`accessible and no sideways scroll at 390px: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${path}`);
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expectAccessible(page);
    });
  }

  test("small screens get a menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    // The phone menu carries Docs too.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" })).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Groups" }).click();
    await expect(page).toHaveURL(/#\/groups$/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  });

  test("keyboard focus shows the red ring, a mouse click does not", async ({ page }) => {
    await page.goto("/#/try");
    const input = page.getByLabel("Vendor domain");
    await input.click();
    expect(await input.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const outline = await input.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineColor]);
    expect(outline).toEqual(["solid", "rgb(165, 155, 255)"]);
  });
});

test.describe("owner app", () => {
  test("review desk: sign in, approve an endpoint change with a wallet signature, see who approved it", async ({ page, wallets }) => {
    await page.goto("/#/app/review");
    await signInAs(page, wallets, APPROVER_ACCOUNT);
    await expect(page.getByRole("heading", { name: "Review Desk" })).toBeVisible();
    const quarry = page.locator(".desk-item", { hasText: "Quarry Lane Legal" });
    await expect(quarry).toContainText("near:testnet:quarrylanelegal.testnet");
    await expect(quarry).toContainText("Cooldown over");
    await expect(quarry.locator(".tier")).toContainText("Domain linked");
    const fernhill = page.locator(".desk-item", { hasText: "Fernhill Cloud Hosting" });
    await expect(fernhill.locator('[data-countdown="running"]')).toHaveText(/\d+h \d{2}m \d{2}s/);
    await expect(fernhill).toContainText("This account imitates one the vendor linked.");
    await expect(fernhill).toContainText("800.00 USDC");
    await expect(page.getByRole("button", { name: /approve all/i })).toHaveCount(0);
    await expectAccessible(page);

    await quarry.getByRole("button", { name: "Approve and sign" }).click();
    await quarry.getByRole("button", { name: "Sign with Test wallet" }).click();
    await expect(page.locator(".okline")).toContainText("Approved. The new account is in effect.");
    const row = page.locator(".desk-log tbody tr").first();
    await expect(row).toContainText("Quarry Lane Legal");
    await expect(row).toContainText("approved");
    await expect(row).toContainText(APPROVER_ACCOUNT);
    await expect(page.locator(".desk-item", { hasText: "Quarry Lane Legal" })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("api keys: create a check-only key, see it once, revoke it", async ({ page, wallets }) => {
    await page.goto("/#/app/keys");
    await signInAs(page, wallets, OWNER_ACCOUNT);
    const payee = page.locator(".keys:not(.meter-keys)");
    await payee.getByLabel("Label").fill("Invoice agent");
    await page.getByRole("button", { name: "Create key", exact: true }).click();
    await expect(payee.locator(".newkey pre")).toContainText("rk_");
    const row = payee.locator("tbody tr", { hasText: "Invoice agent" });
    await expect(row).toContainText("check");
    page.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("Revoked");
    await expectAccessible(page);
  });

  test("sign-in with a NEAR wallet opens NEAR Connect, listing only wallets that sign transactions on testnet", async ({ page, context }) => {
    // Nothing leaves the machine: NEAR Connect gets this manifest, and every other outside request is blocked.
    const wallet = (id: string, name: string, features: Record<string, boolean>) => ({ id, name, icon: "", description: "", website: "https://example.invalid", version: "1.0.0", executor: "https://example.invalid/x.js", type: "sandbox", permissions: {}, platform: {}, features });
    const manifest = {
      version: "1.0.0",
      wallets: [
        wallet("meteor-wallet", "Meteor Wallet", { signMessage: true, signAndSendTransaction: true, signAndSendTransactions: true, testnet: true }),
        wallet("hot-wallet", "HOT Wallet", { signMessage: true, signAndSendTransaction: true, signAndSendTransactions: true }),
        wallet("near-mobile", "NEAR Mobile", { signAndSendTransaction: true, signAndSendTransactions: true, testnet: false }),
        wallet("ethereum-wallets", "Ethereum Wallets", { signAndSendTransaction: true, signAndSendTransactions: true, testnet: true }),
      ],
    };
    await context.route(/manifest\.json/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }));
    await context.route(/example\.invalid|rpc|fastnear|near\.org|meteorwallet/, (route) => route.abort());
    await page.goto("/#/app/overview");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // No typed account without the scripted test wallet: the account comes from the wallet.
    await expect(page.getByLabel("NEAR account")).toHaveCount(0);
    await page.getByRole("button", { name: /NEAR wallet/ }).click();
    const list = page.locator(".hot-connector-popup");
    await expect(list).toContainText("Meteor Wallet", { timeout: 30_000 });
    await expect(list).not.toContainText("HOT Wallet");
    await expect(list).not.toContainText("NEAR Mobile");
    await expect(list).not.toContainText("Ethereum Wallets");
  });

  test("sign-in refuses an account that is not an owner or approver", async ({ page, wallets }) => {
    wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
    await page.goto("/#/app/overview");
    await page.getByLabel("NEAR account").fill(VENDOR_NEAR_ACCOUNT);
    await page.getByRole("button", { name: /Test wallet/ }).click();
    await expect(page.getByRole("alert")).toContainText("cannot be used to sign in");
  });

  test("group: shared budget, members, every call with model claimed and proven, and flagged payouts awaiting a vote", async ({ page, wallets }) => {
    await page.goto("/#/app/group");
    await signInAs(page, wallets, OWNER_ACCOUNT);
    await expect(page.getByTestId("budget-strip")).toContainText("25.00");
    await expect(page.locator(".group")).toContainText("aurora-lab.sputnikv2.testnet");
    await expect(page.getByTestId("group-tier").locator(".tier-name")).toHaveText("Bronze");
    await expect(page.getByTestId("group-tier")).toContainText("more clean proven calls to Silver");
    await expect(page.getByTestId("group-tier")).toContainText("Fee 2.00%");
    const calls = page.locator("table.calls tbody tr");
    await expect(calls.filter({ hasText: "DeepSeek V4.1 Flash" })).toHaveAttribute("data-status", "verified");
    await expect(calls.filter({ hasText: "bob.testnet" })).toContainText("Signed by the gateway, not by a model TEE.");
    const bad = page.locator('.payouts li[data-receiver="northw1nd.testnet"]');
    await expect(bad).toHaveClass(/flagged/);
    await expect(bad).toHaveAttribute("data-verdict", "BLOCK");
    await expect(page.locator('.payouts li[data-receiver="northwind.testnet"]')).toHaveAttribute("data-verdict", "PAY");
    await expect(page.locator(".proposals")).toContainText("Set ci-agent.testnet's allowance");
    await expectAccessible(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
  });

  test("my share: the value card, the WARD price chart against launch, where the share came from, and voting", async ({ page, wallets }) => {
    await page.goto("/#/app/share");
    await signInAs(page, wallets, OWNER_ACCOUNT);
    const share = page.getByTestId("my-share");
    await expect(share.locator(".vc-value")).toContainText("USDC");
    await expect(share).toContainText(OWNER_ACCOUNT);
    const chart = page.getByTestId("price-chart");
    await expect(chart.locator(".pc-launch")).toHaveCount(1);
    await expect(chart.locator(".pc-above")).toHaveAttribute("clip-path", /#above-/);
    await expect(chart.locator(".pc-below")).toHaveAttribute("clip-path", /#below-/);
    await expect(chart.locator(".pc-dot")).toHaveCount(1);
    await expect(share.locator(".sources li").first()).toContainText("Launch at 1.0000 USDC");
    await expect(share.locator('.sources li[data-event="claim"]')).toContainText("Our stake paid 1.50 USDC first");
    await expect(share.getByTestId("governance")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "My share" })).toHaveAttribute("aria-current", "page");
    await expectAccessible(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
  });

  test("meter keys and the AI spend panel", async ({ page, wallets }) => {
    await page.goto("/#/app/keys");
    await signInAs(page, wallets, OWNER_ACCOUNT);
    const meter = page.locator(".meter-keys");
    await meter.getByLabel("Member").selectOption("bob.testnet");
    await meter.getByLabel("Label").fill("Bob notebook");
    await meter.getByRole("button", { name: "Create meter key" }).click();
    const key = ((await meter.locator(".newkey pre").textContent()) ?? "").trim();
    expect(key).toMatch(/^wk_/);
    const row = meter.locator("tbody tr", { hasText: "Bob notebook" });
    await expect(row).not.toContainText(key);
    page.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("Revoked");
    await page.goto("/#/app/overview");
    await expect(page.locator(".panel", { hasText: "AI spend" })).toContainText("Verified calls");
    await expect(page.locator(".spend-chart svg")).toBeVisible();
  });
});
