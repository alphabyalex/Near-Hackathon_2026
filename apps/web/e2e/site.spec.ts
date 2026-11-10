import type { Page } from "@playwright/test";
import { API_PORT, APPROVER_ACCOUNT, OWNER_ACCOUNT, VENDOR_NEAR_ACCOUNT } from "./keys";
import { expect, expectAccessible, expectNoHorizontalScroll, signInAs, test } from "./fixtures";
import repo from "../../../repo.config.json" with { type: "json" };

const PAGES = ["#/", "#/me", "#/groups", "#/proof", "#/try", "#/demo", "#/developers", "#/verify", "#/about"];

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
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\/og-image\.png"/);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    const manifest = (await (await request.get("/site.webmanifest")).json()) as { name: string; theme_color: string; background_color: string; icons: { src: string }[] };
    expect(manifest).toMatchObject({ name: "Wardline", theme_color: "#0E0912", background_color: "#0E0912" });
    for (const path of ["/favicon.ico", "/favicon.svg", "/favicon-32.png", "/apple-touch-icon.png", "/og-image.png", ...manifest.icons.map((i) => i.src)]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});

test.describe("public site", () => {
  test("home: the hero, both sides of the line with real counts, the safest groups and the nav", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A credit union for the AI economy.");
    await expect(page.locator(".hero-sub")).toContainText("Anything that can't prove itself stays below the line.");
    const stats = page.getByTestId("home-stats");
    await expect(stats.locator("dt")).toHaveText(["Total pooled", "WARD price", "Paid above the line", "Kept below it"]);
    await expect(stats).toContainText("since launch at 1.0000");
    await expect(stats.locator(".below-text")).toHaveText(/^\d+$/);
    const sides = page.getByTestId("sides");
    await expect(sides.locator(".above h3")).toHaveText("Above the line");
    await expect(sides.locator(".above li b")).toHaveText(["The model is proven", "The payee is real", "It fits the budget"]);
    const below = page.getByTestId("below-panel");
    await expect(below.locator("h3")).toHaveText("Below the line");
    await expect(below.locator('[data-kind="swapped"]')).toContainText("Swapped models");
    await expect(below.locator('[data-kind="lookalike"]')).toContainText("Look-alike payees");
    await expect(below.locator('[data-kind="capped"]')).toContainText("Leaked keys");
    const board = page.getByTestId("leaderboard");
    await expect(board.locator("tbody tr").first()).toContainText("Mission Street hacker house");
    await expect(board.locator("tbody tr").first().locator(".tier-name")).toHaveText("Gold");
    await expect(board.locator('tr[data-budget="bgt_kelp"] .tier-name')).toHaveText("Bronze");
    const nav = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(nav).toHaveText(["Mutual", "Groups", "Proof engine", "Demo", "Developers", "About"]);
    await expect(nav.first()).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Watch the demo" })).toHaveAttribute("href", "#/demo");
    await page.getByLabel("Wardline home").first().click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test("hero: a static sphere under reduced motion; otherwise the cut, the assembly and a drift that stops off screen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/");
    const still = page.locator("svg.hero-horizon");
    await expect(still).toHaveAttribute("data-static", "true");
    expect(await still.locator("circle").count()).toBeGreaterThan(500);
    await expect(page.locator(".hero canvas")).toHaveCount(0);
    expect(await still.locator(".hero-cut").evaluate((el) => getComputedStyle(el).strokeDashoffset)).toMatch(/^0(px)?$/);
    const r1 = await still.locator("circle").nth(40).getAttribute("r");
    await page.waitForTimeout(600);
    expect(await still.locator("circle").nth(40).getAttribute("r")).toBe(r1);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    const live = page.locator("div.hero-horizon");
    await expect(live).toHaveAttribute("data-static", "false");
    await expect(live.locator("canvas.hero-dots")).toHaveCount(1);
    await expect(live).toHaveAttribute("role", "img");
    // The line draws, the dots assemble, then the light drifts.
    await expect(live).toHaveAttribute("data-phase", "assemble", { timeout: 3_000 });
    await expect(live).toHaveAttribute("data-phase", "drift", { timeout: 8_000 });
    await expect.poll(async () => Number(await live.getAttribute("data-frames")), { timeout: 5_000 }).toBeGreaterThan(3);
    // Off screen, the drift stops.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const offscreen = Number(await live.getAttribute("data-frames"));
    await page.waitForTimeout(1200);
    expect(Number(await live.getAttribute("data-frames"))).toBe(offscreen);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => Number(await live.getAttribute("data-frames")), { timeout: 5_000 }).toBeGreaterThan(offscreen);
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
    await expect(page.locator(".hero-horizon")).toBeVisible();
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

  test("demo: seven scenes run the real endpoints, each lands above or below the line, then the red-team numbers", async ({ page }) => {
    await page.goto("/#/demo");
    await expect(page.locator("[data-scene]")).toHaveCount(7);
    const stage = page.getByTestId("stage");
    const run = async (id: string) => {
      await page.locator(`[data-scene="${id}"]`).click();
      await stage.locator(`[data-run="${id}"]`).click();
      const out = stage.locator(`[data-scene-result="${id}"]`);
      await expect(out).toBeVisible({ timeout: 15_000 });
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

    // Next scene moves along the list.
    await page.locator('[data-scene="swap"]').click();
    await stage.getByRole("button", { name: "Next scene" }).click();
    await expect(stage.locator("h2")).toHaveText("Leaked key");

    const rows = page.locator(".cmp-row");
    await expect(rows.nth(0)).toContainText("5 of 20");
    await expect(rows.nth(1)).toContainText("0 of 20");
  });

  test("join the Mutual: a dialog with quick picks, our stake in front, a wallet approval, then the member card and a 7-day redemption", async ({ page, wallets }) => {
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
    await expect(page).toHaveURL(/#\/me$/);
    await expect(page.getByTestId("connect-wallet")).toContainText(OWNER_ACCOUNT);
    await page.goto("/#/");

    const card = page.getByTestId("member-card");
    const position = card.getByTestId("pool-position");
    await expect(position).toContainText("WARD held");
    await expect(position).toContainText(OWNER_ACCOUNT);
    await card.getByText("Redeem WARD").click();
    await expect(card).toContainText("locks your WARD for 7 days");
    await card.getByLabel("WARD to redeem").fill("5");
    await card.getByRole("button", { name: "Lock for redemption" }).click();
    await expect(card.getByTestId("pool-done")).toContainText("WARD locked. Redeemable from");
    await expect(card.getByTestId("redemption")).toContainText(/Unlocks in (7d 0h|6d 23h)/);
    await expect(position).toContainText("Locked for redemption");
  });

  test("governance: WARD holders vote with their wallet, anyone executes a passed proposal, once", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    const gov = page.getByTestId("governance");
    await expect(gov.getByRole("heading", { level: 2 })).toHaveText("WARD holders decide the risks.");
    await expect(gov.locator('.prop[data-status="executed"]')).toContainText("Set the Gold fee to 1.00%");
    await expect(gov.locator('.prop[data-status="rejected"]')).toContainText("Raise the Bronze fee to 2.50%");

    const mine = gov.locator(".prop", { hasText: "Lower the Gold fee to 0.75%" });
    await expect(mine).toHaveAttribute("data-status", "open");
    await expect(mine.getByRole("button", { name: "Vote for" })).toBeDisabled();
    await connectWallet(page, OWNER_ACCOUNT);
    await expect(gov.locator(".voter")).toContainText(OWNER_ACCOUNT);
    await expect(mine).toContainText(/Your vote: [0-9.]+ WARD/);
    const weight = (/Your vote: ([0-9.]+) WARD/.exec((await mine.textContent()) ?? "") ?? [])[1] ?? "";
    await mine.getByRole("button", { name: "Vote for" }).click();
    await expect(mine.getByRole("status")).toContainText("Vote counted: for.");
    await expect(gov.locator(".prop", { hasText: "Lower the Gold fee to 0.75%" }).locator(".prop-facts")).toContainText(`For${weight} WARD`);

    await expect(gov.locator(".prop", { hasText: "Lower the Silver fee to 1.25%" })).toContainText("You held no WARD when this opened.");

    const passed = gov.locator('.prop[data-status="passed"]', { hasText: "Raise coverage to 1.25x" });
    await passed.getByRole("button", { name: "Execute" }).click();
    await expect(gov.locator('.prop[data-status="executed"]', { hasText: "Raise coverage to 1.25x" })).toBeVisible();
    await expect(gov.locator('.prop[data-status="passed"]', { hasText: "Raise coverage to 1.25x" })).toHaveCount(0);
    await expectAccessible(page);
  });

  test("groups: three tier cards, every group with its own horizon, tier and history, and four steps to start one", async ({ page }) => {
    await page.goto("/#/groups");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("One shared AI budget for your crew.");
    const tiers = page.getByTestId("tier-table").locator(".tier-card");
    await expect(tiers).toHaveCount(3);
    await expect(tiers.locator(".tier-name")).toHaveText(["Bronze", "Silver", "Gold"]);
    await expect(tiers.locator(".tc-fee")).toHaveText(["2.00%", "1.50%", "1.00%"]);
    await expect(tiers.nth(1)).toContainText("10 clean proven calls in a row at Bronze");
    const mission = page.locator('.gcard[data-budget="bgt_mission"]');
    await expect(mission).toHaveAttribute("data-tier", "gold");
    await expect(mission).toContainText("Top tier");
    await expect(mission.locator("svg.group-horizon")).toBeVisible();
    const kelp = page.locator('.gcard[data-budget="bgt_kelp"]');
    await expect(kelp).toHaveAttribute("data-tier", "bronze");
    await expect(kelp.locator(".gfacts")).toContainText("Claims1");
    await expect(page.locator('.gcard[data-budget="bgt_nightshade"]')).toContainText("more clean proven calls to Gold");
    // Each group's horizon has its own light.
    const a = await mission.locator("svg.group-horizon circle").first().getAttribute("r");
    const b = await kelp.locator("svg.group-horizon circle").first().getAttribute("r");
    expect(a).not.toBe(b);
    await expect(page.locator(".steps-row li b")).toHaveText(["Connect your DAO", "Vote in a budget", "Members get keys", "Change one line"]);
    await expectAccessible(page);
  });

  test("proof engine: the one-line snippet, four steps, the latest proofs on each side of the line, and the red-team numbers", async ({ page }) => {
    await page.goto("/#/proof");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing crosses the line without proof.");
    await expect(page.locator(".snippet")).toContainText("/v1/ai");
    await expect(page.locator(".steps-row li b")).toHaveText(["Reserve", "Forward", "Prove", "Settle"]);
    const proofs = page.getByTestId("proofs");
    await expect(proofs.locator('tr[data-side="above"]').first()).toContainText("Above, paid");
    await expect(proofs.locator('tr[data-side="below"]').first()).toContainText("Below, refunded");
    await expect(proofs.locator('tr[data-side="below"] svg.fp-below')).toHaveCount(await proofs.locator('tr[data-side="below"]').count());
    await expect(page.locator(".stat-row.results")).toContainText("100%");
    await expect(page.locator("main")).not.toContainText("stub rules engine");
  });

  test("developers: with no API URL set, snippets show the hosted URL, never a variable or localhost; copy works", async ({ page, context, browserName }) => {
    // Only Chromium lets a test grant and read the clipboard; elsewhere the button label is the check.
    if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // The old route still works: it lands here and the address bar shows the new one.
    await page.goto("/#/connect");
    await expect(page).toHaveURL(/#\/developers$/);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Developers" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-unset]')).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("VITE_WARDLINE");
    await expect(page.locator("main")).not.toContainText("process.env.WARDLINE_API_URL");
    // The hosted URLs, or the local ones while nothing is hosted (repo.config.json's hosted values empty).
    const api = repo.hosted.api || "http://127.0.0.1:8787";
    const mcp = repo.hosted.mcp || "http://127.0.0.1:8790/mcp";
    if (repo.hosted.api) await expect(page.locator("main")).not.toContainText("127.0.0.1");
    await expect(page.locator("main")).not.toContainText("localhost");
    await expect(page.locator("main")).toContainText(`curl -s ${api}/v1/resolve`);
    const openai = page.locator(".conn").first();
    await expect(openai).toContainText("OpenAI client, one line");
    await expect(openai).toContainText(`baseURL: "${api}/v1/ai"`);
    await expect(openai).toContainText(`base_url="${api}/v1/ai"`);
    await expect(page.locator("main")).toContainText(mcp);
    await page.getByRole("button", { name: "Copy curl resolve example" }).click();
    await expect(page.getByRole("button", { name: "Copy curl resolve example" })).toHaveText("Copied");
    if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/v1/resolve");
    await expect(page.getByRole("link", { name: "/llms.txt" })).toHaveAttribute("href", "/llms.txt");
  });

  test("developers: with VITE_ URLs set, snippets use them", async ({ page }) => {
    await page.goto(`http://127.0.0.1:5198/#/developers`);
    await expect(page.locator('[data-unset="api"]')).toHaveCount(0);
    await expect(page.locator("main")).toContainText("https://mcp.wardline.example/mcp");
    await expect(page.locator("main")).toContainText("https://api.wardline.example/v1/check");
    await expect(page.locator("main")).toContainText('baseURL: "https://api.wardline.example/v1/ai"');
    await expect(page.locator("main")).toContainText('base_url="https://api.wardline.example/v1/ai"');
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

  test("sign-in with MyNearWallet loads the real wallet selector and opens a NEP-413 sign request", async ({ page, context }) => {
    // Nothing leaves the machine: the wallet site is blocked, only the request URL is checked.
    let signRequest: URL | null = null;
    await context.route(/mynearwallet|rpc|fastnear|near\.org|meteorwallet/, (route) => {
      const requested = new URL(route.request().url());
      if (requested.pathname === "/sign-message") signRequest = requested;
      return route.abort();
    });
    await page.goto("/#/app/overview");
    await page.getByLabel("NEAR account").fill(APPROVER_ACCOUNT);
    await page.getByRole("button", { name: /MyNearWallet/ }).click();
    await expect.poll(() => signRequest?.href ?? "", { timeout: 30_000 }).toContain("/sign-message");
    const url = signRequest as unknown as URL;
    expect(url.pathname).toBe("/sign-message");
    expect(url.searchParams.get("recipient")).toBe("wardline-owner-login");
    expect(url.searchParams.get("message")).toContain(`wardline-owner-login:v1:${APPROVER_ACCOUNT}:`);
    expect(Buffer.from(url.searchParams.get("nonce") ?? "", "base64")).toHaveLength(32);
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
