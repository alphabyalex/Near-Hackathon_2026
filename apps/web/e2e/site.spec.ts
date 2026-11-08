import { API_PORT, APPROVER_ACCOUNT, OWNER_ACCOUNT, VENDOR_NEAR_ACCOUNT } from "./keys";
import { expect, expectAccessible, expectNoHorizontalScroll, signInAs, test } from "./fixtures";

const PAGES = ["#/", "#/try", "#/demo", "#/connect", "#/verify", "#/about"];

test.describe("public site", () => {
  test("home: hero, feature rows and results read from the red-team report", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your agent can read every invoice.");
    await expect(page.locator(".spec")).toHaveCount(6);
    await expect(page.locator(".spec b")).toHaveText(["Pay by reference", "Payee Proof", "Vendor change control", "Release Guard", "x402 guard", "Private mode"]);
    const strip = page.locator(".strip.results");
    await expect(strip).toContainText("100%");
    await expect(strip).toContainText("0%");
    await expect(page.locator(".engine-note")).toContainText("stub rules engine");
    const nav = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(nav).toHaveText(["Try it", "Demo", "Connect", "Verify", "About"]);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "About" }).click();
    await expect(page).toHaveURL(/#\/about$/);
    await page.getByLabel("Redline home").first().click();
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

  test("demo: four scenes end in real API results, and the first-payment comparison comes from the report", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/demo");
    const expected: Record<string, string> = { bank: "BLOCK", x402: "BLOCK", poison: "BLOCK", resolve: "PAY" };
    for (const [scene, verdict] of Object.entries(expected)) {
      await page.locator(`[data-scene="${scene}"]`).click();
      await expect(page.locator(".stage .result")).toHaveAttribute("data-verdict", verdict);
    }
    await page.locator('[data-scene="x402"]').click();
    await expect(page.locator(".guard-line")).toContainText("Stopped by the x402 guard");
    await expect(page.locator(".stage .result")).toContainText("ACCOUNT_NOT_VENDORS");
    await page.locator('[data-scene="poison"]').click();
    await expect(page.locator(".stage .result")).toContainText("LOOKALIKE_ACCOUNT");
    const rows = page.locator(".cmp-row");
    await expect(rows.nth(0)).toContainText("5 of 20");
    await expect(rows.nth(1)).toContainText("0 of 20");
  });

  test("demo: steps play in order when motion is allowed", async ({ page }) => {
    await page.goto("/#/demo");
    await page.locator('[data-scene="bank"]').click();
    await expect(page.locator(".steps li.on")).toHaveCount(1);
    await expect(page.locator(".stage .result")).toHaveAttribute("data-verdict", "BLOCK", { timeout: 10_000 });
    await expect(page.locator(".steps li.on")).toHaveCount(3);
  });

  test("connect: no API URL set shows the set-your-URL state, never localhost; copy works", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/#/connect");
    await expect(page.locator('[data-unset="api"]')).toContainText("Set your API URL");
    await expect(page.locator('[data-unset="mcp"]')).toBeVisible();
    await expect(page.locator("main")).not.toContainText("127.0.0.1");
    await expect(page.locator("main")).not.toContainText("localhost");
    await expect(page.locator("pre").first()).toContainText("$REDLINE_API_URL/v1/resolve");
    await page.getByRole("button", { name: "Copy curl resolve example" }).click();
    await expect(page.getByRole("button", { name: "Copy curl resolve example" })).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/v1/resolve");
    await expect(page.getByRole("link", { name: "/llms.txt" })).toHaveAttribute("href", "/llms.txt");
  });

  test("connect: with VITE_ URLs set, snippets use them", async ({ page }) => {
    await page.goto(`http://127.0.0.1:5198/#/connect`);
    await expect(page.locator('[data-unset="api"]')).toHaveCount(0);
    await expect(page.locator("main")).toContainText("https://mcp.redline.example/mcp");
    await expect(page.locator("main")).toContainText("https://api.redline.example/v1/check");
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

    await expect(page.locator(".host-url")).toHaveText(`https://${domain}/.well-known/redline-payee.json`);
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
    await page.getByRole("button", { name: "Download redline-payee.json" }).click();
    const captured = await page.evaluate(async () => {
      const dl = (window as unknown as { __dl?: { name: string; text: Promise<string> } }).__dl;
      return dl ? { name: dl.name, text: await dl.text } : null;
    });
    expect(captured?.name).toBe("redline-payee.json");
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
    await expect(fernhill).toContainText("800.00 REDL");
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
    await page.getByLabel("Label").fill("Invoice agent");
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.locator(".newkey pre")).toContainText("rk_");
    const row = page.locator("tbody tr", { hasText: "Invoice agent" });
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
    expect(url.searchParams.get("recipient")).toBe("redline-owner-login");
    expect(url.searchParams.get("message")).toContain(`redline-owner-login:v1:${APPROVER_ACCOUNT}:`);
    expect(Buffer.from(url.searchParams.get("nonce") ?? "", "base64")).toHaveLength(32);
  });

  test("sign-in refuses an account that is not an owner or approver", async ({ page, wallets }) => {
    wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
    await page.goto("/#/app/overview");
    await page.getByLabel("NEAR account").fill(VENDOR_NEAR_ACCOUNT);
    await page.getByRole("button", { name: /Test wallet/ }).click();
    await expect(page.getByRole("alert")).toContainText("cannot be used to sign in");
  });
});
