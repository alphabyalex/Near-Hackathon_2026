import type { Page } from "@playwright/test";
import { APPROVER_ACCOUNT, OWNER_ACCOUNT, VENDOR_NEAR_ACCOUNT } from "./keys";
import { expect, expectAccessible, expectNoHorizontalScroll, test } from "./fixtures";

async function connectIn(page: Page, account: string) {
  const dlg = page.getByTestId("connect-dialog");
  await dlg.getByLabel("NEAR account").fill(account);
  await dlg.locator('[data-wallet="test-wallet"]').click();
  await dlg.getByRole("button", { name: "Use this wallet" }).click();
}

test.describe("#/me, the member view", () => {
  test("no wallet: one line and Connect wallet; a wallet with no WARD: one line and Join the Mutual", async ({ page, wallets }) => {
    wallets.setNearAccount(VENDOR_NEAR_ACCOUNT);
    await page.goto("/#/me");
    const connect = page.getByTestId("me-connect");
    await expect(connect).toContainText("Connect a wallet to see your share.");
    await connect.getByRole("button", { name: "Connect wallet" }).click();
    await connectIn(page, VENDOR_NEAR_ACCOUNT);
    const empty = page.getByTestId("me-empty");
    await expect(empty).toHaveText(/This wallet holds no WARD yet\.\s*Join the Mutual/);
    await expectAccessible(page);
    await empty.getByRole("button", { name: "Join the Mutual" }).click();
    await expect(page.getByTestId("join-dialog")).toBeVisible();
  });

  test("a member: position, earned since joining, the price chart, a vote with snapshot weight, past votes, a redemption countdown and where the share came from", async ({ page, wallets }) => {
    wallets.setNearAccount(APPROVER_ACCOUNT);
    await page.goto("/#/me");
    await page.getByTestId("me-connect").getByRole("button", { name: "Connect wallet" }).click();
    await connectIn(page, APPROVER_ACCOUNT);
    const me = page.getByTestId("me-position");
    await expect(me.locator(".vc-value")).toContainText("USDC");
    await expect(me).toContainText("WARD held");
    await expect(page.getByTestId("me-earned")).toHaveText("0.00 USDC");
    await expect(me).toContainText(APPROVER_ACCOUNT);
    await expect(me.getByTestId("price-chart").locator(".pc-launch")).toHaveCount(1);
    await expect(me.locator('.sources li[data-event="joined"]')).toContainText("You deposited 12.00 USDC");
    // The header account button opens this page.
    await expect(page.getByTestId("connect-wallet")).toHaveAttribute("href", "#/me");

    const vote = me.getByTestId("me-open-vote").filter({ hasText: "Lower the Gold fee to 0.75%" });
    await expect(vote.locator(".me-weight")).toContainText(/Your weight: [0-9.]+ WARD, counted at the snapshot/);
    await expect(me.getByTestId("me-open-vote").filter({ hasText: "Lower the Silver fee to 1.25%" }).locator(".me-weight")).toContainText("You held no WARD when this opened");
    await expect(me.getByText("You haven't voted yet.")).toBeVisible();
    await vote.getByRole("button", { name: "Vote for" }).click();
    await expect(me.getByTestId("me-past-votes")).toContainText("Lower the Gold fee to 0.75%");
    await expect(me.getByTestId("me-past-votes")).toContainText("For");
    await expectAccessible(page);

    // Lock some WARD on the home page's member card, then the countdown shows here.
    await page.goto("/#/");
    const card = page.getByTestId("member-card");
    await card.getByText("Redeem WARD").click();
    await card.getByLabel("WARD to redeem").fill("2");
    await card.getByRole("button", { name: "Lock for redemption" }).click();
    await expect(card.getByTestId("pool-done")).toContainText("WARD locked");
    await page.goto("/#/me");
    await expect(page.getByTestId("redemption")).toContainText(/Unlocks in (7d 0h|6d 23h)/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
  });

  test("Join the Mutual's Go to my share opens #/me", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
    const dlg = page.getByTestId("join-dialog");
    await dlg.getByLabel("Your NEAR account").fill(OWNER_ACCOUNT);
    await dlg.locator('[data-wallet="test-wallet"]').click();
    await dlg.getByRole("button", { name: "Deposit 25.00 USDC" }).click();
    await dlg.getByRole("button", { name: "Go to my share" }).click();
    await expect(page).toHaveURL(/#\/me$/);
    await expect(page.getByTestId("me-position")).toBeVisible();
  });
});

test.describe("states: what happened and what to do next", () => {
  test("API unreachable: says so, and Try again recovers", async ({ page }) => {
    await page.route("**/api/v1/mutual", (r) => r.abort("connectionrefused"));
    await page.goto("/#/");
    const problem = page.locator('[data-problem="apiDown"]');
    await expect(problem).toContainText("Wardline can't reach its API right now.");
    await expect(problem).toContainText("Your money hasn't moved.");
    await page.unroute("**/api/v1/mutual");
    await problem.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("home-stats")).toBeVisible();
    await expect(problem).toHaveCount(0);
  });

  test("chain RPC failing in near mode: says the network isn't answering and nothing moved", async ({ page }) => {
    await page.route("**/api/v1/mutual", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "CHAIN_UNAVAILABLE", message: "The NEAR RPC is not answering." }) }));
    await page.goto("/#/");
    const problem = page.locator('[data-problem="chainDown"]');
    await expect(problem).toContainText("The NEAR network isn't answering.");
    await expect(problem).toContainText("Nothing was sent or changed.");
    await expect(problem.getByRole("button", { name: "Try again" })).toBeVisible();
    await expectAccessible(page);
  });

  test("wallet signature rejected, then wallet not installed", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
    const dlg = page.getByTestId("join-dialog");
    await dlg.getByLabel("Your NEAR account").fill(OWNER_ACCOUNT);
    await dlg.locator('[data-wallet="test-wallet"]').click();
    await page.evaluate(() => {
      const w = window as unknown as { __wardlineTestWallet: { signMessage: () => Promise<never> } };
      w.__wardlineTestWallet.signMessage = () => Promise.reject(new Error("User rejected the request"));
    });
    await dlg.getByRole("button", { name: "Deposit 25.00 USDC" }).click();
    await expect(dlg.locator('[data-problem="walletRejected"]')).toContainText("Your wallet didn't sign.");
    await expect(dlg.locator('[data-problem="walletRejected"]')).toContainText("Nothing was sent.");

    await page.evaluate(() => delete (window as unknown as { __wardlineTestWallet?: unknown }).__wardlineTestWallet);
    await dlg.getByRole("button", { name: "Deposit 25.00 USDC" }).click();
    await expect(dlg.locator('[data-problem="walletMissing"]')).toContainText("That wallet isn't available in this browser.");
    await expect(dlg.locator('[data-problem="walletMissing"]')).toContainText("Install it, or choose another wallet.");
  });

  test("a deposit below the minimum is stopped before anything is signed", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    await page.locator(".hero").getByRole("button", { name: "Become a member" }).click();
    const dlg = page.getByTestId("join-dialog");
    await dlg.getByLabel("Amount in USDC").fill("0.5");
    await expect(dlg.locator('[data-problem="belowMinimum"]')).toContainText("The smallest deposit is 1.00 USDC.");
    await expect(dlg.getByRole("button", { name: "Deposit 0.50 USDC" })).toBeDisabled();
  });

  test("a vote after the window closed", async ({ page, wallets }) => {
    wallets.setNearAccount(OWNER_ACCOUNT);
    await page.goto("/#/");
    await page.getByTestId("connect-wallet").click();
    await connectIn(page, OWNER_ACCOUNT);
    await page.route("**/api/v1/pool/submit", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "VOTING_CLOSED", message: "Voting on this proposal is closed." }) }));
    const mine = page.getByTestId("governance").locator(".prop", { hasText: "Lower the Gold fee to 0.75%" });
    await expect(mine).toContainText(/Your vote: [0-9.]+ WARD/);
    await mine.getByRole("button", { name: "Vote for" }).click();
    await expect(mine.locator('[data-problem="votingClosed"]')).toContainText("Voting on this proposal has closed.");
    await expect(mine.locator('[data-problem="votingClosed"]')).toContainText("Its result is in the decided list.");
  });

  test("redeem before the cooldown ends", async ({ page, wallets }) => {
    wallets.setNearAccount(APPROVER_ACCOUNT);
    await page.goto("/#/");
    await page.getByTestId("connect-wallet").click();
    await connectIn(page, APPROVER_ACCOUNT);
    const card = page.getByTestId("member-card");
    await card.getByText("Redeem WARD").click();
    await card.getByLabel("WARD to redeem").fill("2");
    await card.getByRole("button", { name: "Lock for redemption" }).click();
    await expect(card.getByTestId("pool-done")).toContainText("WARD locked");
    // A stale page that thinks the wait is over: the API still refuses, and the page says why.
    await page.route("**/api/v1/pool/positions/**", async (r) => {
      const res = await r.fetch();
      const body = (await res.json()) as { pending_withdrawals: { available_at: string }[] };
      for (const w of body.pending_withdrawals) w.available_at = new Date(Date.now() - 60_000).toISOString();
      await r.fulfill({ response: res, json: body });
    });
    await page.goto("/#/me");
    await page.getByTestId("redemption").getByRole("button", { name: "Ready to redeem" }).click();
    const problem = page.locator('[data-problem="cooldown"]');
    await expect(problem).toContainText("This WARD is still in its 7-day wait.");
    await expect(problem).toContainText("Redeem it once the countdown reaches zero.");
  });

  test("loading keeps the layout: the skeleton has the stats strip's size", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/v1/mutual", async (r) => {
      await gate;
      await r.continue();
    });
    await page.goto("/#/");
    const skeleton = page.getByTestId("home-loading").locator(".stats");
    await expect(skeleton).toBeVisible();
    const before = await skeleton.boundingBox();
    release();
    const real = page.locator("section.stats").filter({ has: page.getByTestId("home-stats") });
    await expect(real).toBeVisible();
    const after = await real.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(6);
  });
});
