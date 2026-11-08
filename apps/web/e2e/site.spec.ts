import { API_PORT, APPROVER_ACCOUNT, OWNER_ACCOUNT, VENDOR_NEAR_ACCOUNT } from "./keys";
import { expect, expectAccessible, expectNoHorizontalScroll, signInAs, test } from "./fixtures";

const PAGES = ["#/", "#/try", "#/demo", "#/mutual", "#/connect", "#/verify", "#/about"];

test.describe("public site", () => {
  test("home: hero, feature rows and results read from the red-team report", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("AI that only pays on proof.");
    await expect(page.locator(".spec")).toHaveCount(6);
    await expect(page.locator(".spec b")).toHaveText(["Proof of delivery", "Proof of payee", "Hard cap", "Wardline Mutual", "Social Money", "One-line plug-in"]);
    const strip = page.locator(".strip.results");
    await expect(strip).toContainText("100%");
    await expect(strip).toContainText("0%");
    await expect(page.locator(".engine-note")).toContainText("stub rules engine");
    const nav = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(nav).toHaveText(["Try it", "Demo", "Mutual", "Connect", "Verify", "About"]);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "About" }).click();
    await expect(page).toHaveURL(/#\/about$/);
    await page.getByLabel("Wardline home").first().click();
    await expect(page).toHaveURL(/#\/$/);
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

  test("demo: five scenes end in real results from the gateway, payee check and pool, then the red-team numbers", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/demo");
    const out = page.locator(".stage .scene-out");

    await page.locator('[data-scene="plugin"]').click();
    await expect(out).toHaveAttribute("data-outcome", "verified");
    await expect(out.locator(".out-card")).toHaveCount(2);
    await expect(out).toContainText("DeepSeek-V4.1-Flash-1017");
    await expect(out).toContainText("sim-settle-");

    await page.locator('[data-scene="swap"]').click();
    await expect(out).toHaveAttribute("data-outcome", "refused");
    await expect(out).toContainText("The signature names a different model.");
    await expect(out.locator(".out-row.mismatch")).toContainText("glm-5.3-flash");

    await page.locator('[data-scene="leak"]').click();
    await expect(out).toContainText("Spent 15.00 of 15.00 USDC");
    await expect(out).toContainText("50 requests refused with 402");

    await page.locator('[data-scene="invoice"]').click();
    await expect(page.locator(".stage .result")).toHaveAttribute("data-verdict", "BLOCK");

    await page.locator('[data-scene="mutual"]').click();
    await expect(out).toHaveAttribute("data-outcome", "paid");
    const first = out.locator('[data-payout="1"]');
    const second = out.locator('[data-payout="2"]');
    await expect(first).toContainText("Paid by Wardline's stake8.00 USDC");
    await expect(first).toContainText("Paid by WARD holders0.00 USDC");
    await expect(first).toContainText("1.0000 to 1.0000 USDC");
    await expect(second).toContainText("Paid by Wardline's stake12.00 USDC");
    await expect(second).toContainText("Paid by WARD holders6.00 USDC");
    await expect(second.locator(".out-row.mismatch")).toContainText("1.0000 to 0.9500 USDC");

    const rows = page.locator(".cmp-row");
    await expect(rows.nth(0)).toContainText("5 of 20");
    await expect(rows.nth(1)).toContainText("0 of 20");
  });

  test("demo: steps play in order when motion is allowed", async ({ page }) => {
    await page.goto("/#/demo");
    await page.locator('[data-scene="swap"]').click();
    await expect(page.locator(".steps li.on")).toHaveCount(1);
    await expect(page.locator(".stage .scene-out")).toHaveAttribute("data-outcome", "refused", { timeout: 10_000 });
    await expect(page.locator(".steps li.on")).toHaveCount(3);
  });

  test("mutual: WARD price and pitch, we lose first, a wallet-signed USDC deposit for WARD, and a 7-day redemption", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/mutual");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("the pool pays you back");
    const ward = page.getByTestId("ward-panel");
    await expect(ward).toContainText("Earn a share of Wardline's fees by backing its proofs.");
    await expect(ward).toContainText("If Wardline is wrong, WARD holders cover it after Wardline's own stake.");
    await expect(ward).toContainText("Yield-bearing, loss-sharing.");
    expect(Number(await page.getByTestId("ward-price").textContent())).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("trade-ward")).toHaveCount(0);
    await expect(page.getByTestId("pool-stats")).toContainText("20.00");
    await expect(page.locator(".lose-first")).toContainText("We lose first.");
    await page.getByLabel("Your NEAR account").fill(OWNER_ACCOUNT);
    await page.getByLabel("Amount (USDC)").fill("20");
    await page.locator('.pool-form [data-wallet="test-wallet"]').click();
    await expect(page.getByTestId("pool-done")).toContainText("Received");
    await expect(page.getByTestId("pool-done")).toContainText("WARD. sim-deposit-");
    const position = page.getByTestId("pool-position");
    await expect(position).toContainText(/worth (19.99|20.00) USDC/);
    await page.getByRole("tab", { name: "Redeem WARD" }).click();
    await expect(page.locator(".pool-form")).toContainText("locks your WARD for 7 days");
    const balance = (/Balance ([0-9.,]+) WARD/.exec((await position.textContent()) ?? "") ?? [])[1] ?? "";
    await page.getByLabel("WARD to redeem").fill(balance.replace(/,/g, ""));
    await page.locator('.pool-form [data-wallet="test-wallet"]').click();
    await expect(page.getByTestId("pool-done")).toContainText("WARD locked. Redeemable from");
    await expect(page.getByTestId("redemption")).toContainText(/Unlocks in (7d 0h|6d 23h)/);
    await expect(position).toContainText("Locked for redemption");
    await expectAccessible(page);
  });


  test("connect: no API URL set shows the set-your-URL state, never localhost; copy works", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/#/connect");
    await expect(page.locator('[data-unset="api"]')).toContainText("Set your API URL");
    await expect(page.locator('[data-unset="mcp"]')).toBeVisible();
    await expect(page.locator("main")).not.toContainText("127.0.0.1");
    await expect(page.locator("main")).not.toContainText("localhost");
    await expect(page.locator("main")).toContainText("$WARDLINE_API_URL/v1/resolve");
    const openai = page.locator(".conn").first();
    await expect(openai).toContainText("OpenAI client, one line");
    await expect(openai).toContainText("process.env.WARDLINE_API_URL}/v1/ai");
    await expect(openai).toContainText('os.environ["WARDLINE_API_URL"] + "/v1/ai"');
    await page.getByRole("button", { name: "Copy curl resolve example" }).click();
    await expect(page.getByRole("button", { name: "Copy curl resolve example" })).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/v1/resolve");
    await expect(page.getByRole("link", { name: "/llms.txt" })).toHaveAttribute("href", "/llms.txt");
  });

  test("connect: with VITE_ URLs set, snippets use them", async ({ page }) => {
    await page.goto(`http://127.0.0.1:5198/#/connect`);
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
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Verify" }).click();
    await expect(page).toHaveURL(/#\/verify$/);
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
    expect(outline).toEqual(["solid", "rgb(225, 37, 27)"]);
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
    const calls = page.locator("table.calls tbody tr");
    await expect(calls.filter({ hasText: "DeepSeek-V4.1-Flash-1017" })).toHaveAttribute("data-status", "verified");
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
