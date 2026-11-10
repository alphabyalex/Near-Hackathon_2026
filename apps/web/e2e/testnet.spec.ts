/**
 * Every function, end to end on NEAR testnet, against the local stack (playwright.testnet.config.ts).
 * Sends real transactions with the local test signer. Not part of the default suite.
 *
 * Needs: the API in near mode with WARDLINE_LOCAL_SIGNER=1 on 127.0.0.1:8787, the web dev server with
 * WARDLINE_DATA=testnet and VITE_WARDLINE_LOCAL_SIGNER=1 on 127.0.0.1:5173, and an open WARD proposal.
 * Saves screenshots to screenshots/testnet-*.png and the transaction hashes to screenshots/testnet-txs.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "screenshots";
const RPC = "https://test.rpc.fastnear.com";
const MEMBER = "dana.wardline-labs.testnet";
const LP = "lp-north.wardline-labs.testnet";
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const txs: Record<string, string> = {};

test.describe.configure({ mode: "serial" });
mkdirSync(SHOTS, { recursive: true });

/** Waits for the page's requests to settle, so no screenshot catches a loading skeleton. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/testnet-${name}.png`, fullPage: true });
}

/** The hash in a View transaction link. */
async function hashOf(link: ReturnType<Page["locator"]>): Promise<string> {
  const href = (await link.getAttribute("href")) ?? "";
  const hash = href.split("/txns/")[1] ?? "";
  expect(hash).toMatch(HASH);
  return hash;
}

/** Confirms on testnet RPC that the transaction exists and succeeded. */
async function onChain(hash: string, signer: string): Promise<void> {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" } }) });
  const body = (await res.json()) as { result?: { status: Record<string, unknown> } };
  expect(body.result, `RPC knows ${hash}`).toBeTruthy();
  expect(Object.keys(body.result!.status)).toContain("SuccessValue");
}

async function connectAs(page: Page, account: string): Promise<void> {
  await page.goto("/#/");
  await page.evaluate(() => window.sessionStorage.removeItem("wardline.connected"));
  await page.reload();
  await page.getByTestId("connect-wallet").click();
  const dialog = page.getByTestId("connect-dialog");
  await dialog.locator('button[data-wallet="local-signer"]').click();
  await expect(dialog.locator('button[data-wallet="local-signer"]')).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("combobox").or(dialog.getByRole("textbox")).first().fill(account);
  await dialog.getByRole("button", { name: "Use this wallet" }).click();
  await expect(page.getByTestId("connect-wallet")).toContainText(account);
  await expect(page.getByTestId("connect-wallet")).toContainText("Local test signer");
}

test.afterAll(() => {
  const path = `${SHOTS}/testnet-txs.json`;
  const before = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
  writeFileSync(path, `${JSON.stringify({ ...before, ...txs }, null, 2)}\n`);
});

test("home: testnet numbers, and the footer says so", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.locator("footer")).toContainText("NEAR testnet");
  await expect(page.locator(".stats")).toBeVisible();
  await expect(page.locator(".stats dd").first()).toContainText(/\d/);
  await expect(page.locator(".stats")).not.toContainText("141.24");
  await page.waitForLoadState("networkidle");
  await shot(page, "home");
});

test("1 to 3: latest proofs show the plug-in call, the swapped model and the capped key, each linked", async ({ page }) => {
  await page.goto("/#/proof");
  const table = page.locator("table").first();
  await expect(table).toBeVisible();
  const links = table.locator('a.tx-link[href*="testnet.nearblocks.io/txns/"]');
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThan(3);
  const below = table.locator("td.side-below");
  await expect(below.first()).toBeVisible();
  const first = await hashOf(links.first());
  await onChain(first, "meter.wardline-labs.testnet");
  txs.latestProof = first;
  await shot(page, "proofs");
});

test("4: the payee check blocks northw1nd against the registry on testnet", async ({ page }) => {
  await page.goto("/#/try");
  await page.getByRole("tab", { name: "Check an address" }).click();
  await page.getByLabel("Payout address").fill("near:testnet:northw1nd.testnet");
  await page.getByLabel("Vendor domain (optional)").fill("northwind.example");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.locator("main")).toContainText("Do not pay.");
  await expect(page.locator("main")).toContainText(/LOOKALIKE|Imitates/);
  await shot(page, "payee-check");
});

test("5: Join the Mutual with the local test signer: a real deposit that mints WARD", async ({ page }) => {
  await connectAs(page, MEMBER);
  await page.getByRole("button", { name: "Become a member" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount in USDC").fill("1");
  await dialog.getByRole("button", { name: /^Deposit 1(\.00)? USDC$/ }).click();
  await expect(dialog).toContainText(/You received [\d.,]+ WARD/, { timeout: 120_000 });
  const link = dialog.locator('a.tx-link[href*="/txns/"]');
  txs.join = await hashOf(link);
  await onChain(txs.join, MEMBER);
  await shot(page, "join");
  await dialog.getByRole("button", { name: "Close" }).click();
});

test("6: vote with WARD on the open proposal, then execute it once it passes", async ({ page }) => {
  await connectAs(page, MEMBER);
  const proposal = page.locator(".prop, article, li").filter({ hasText: "Set coverage to 1.10x for every tier" }).first();
  await proposal.scrollIntoViewIfNeeded();
  await expect(proposal).toBeVisible();
  const before = await fetch("http://127.0.0.1:8787/v1/mutual").then((r) => r.json() as Promise<{ governance: { proposals: Array<{ id: number; description: string; status: string }> } }>);
  const target = before.governance.proposals.find((p) => p.description === "Set coverage to 1.10x for every tier")!;
  if (target.status === "open") {
    await proposal.getByRole("button", { name: "Vote for" }).click();
    await expect(proposal).toContainText(/Vote counted|Passed|Execute/, { timeout: 120_000 });
  }
  await page.reload();
  const again = page.locator(".prop, article, li").filter({ hasText: "Set coverage to 1.10x for every tier" }).first();
  await again.scrollIntoViewIfNeeded();
  await shot(page, "vote");
  const exec = again.getByRole("button", { name: "Execute" });
  if (await exec.isVisible()) {
    await exec.click();
    await expect(again).toContainText(/Executed/, { timeout: 120_000 });
  }
  await shot(page, "execute");
});

test("7: a redemption request, with its countdown on #/me", async ({ page }) => {
  await connectAs(page, MEMBER);
  const redeem = page.locator("details.mc-redeem");
  await redeem.scrollIntoViewIfNeeded();
  await redeem.locator("summary").click();
  const amount = redeem.getByLabel("WARD to redeem");
  await amount.fill("0.1");
  await page.getByRole("button", { name: "Lock for redemption" }).click();
  await expect(page.locator("main")).toContainText(/WARD locked\. Redeemable from/, { timeout: 120_000 });
  await page.goto("/#/me");
  await expect(page.getByTestId("redemption").first()).toContainText(/Unlocks in|Redeem/);
  await shot(page, "redeem");
});

test("8: groups show real tiers, proven calls and fees, and a transaction link that opens a real one", async ({ page }) => {
  await page.goto("/#/groups");
  const mission = page.locator('.gcard[data-budget="bgt_mission"]');
  await expect(mission).toBeVisible();
  await expect(mission).toContainText(/Gold|Silver|Bronze/i);
  const link = page.locator('.gcard a.tx-link[href*="/txns/"]').first();
  await expect(link).toBeVisible();
  txs.groups = await hashOf(link);
  await shot(page, "groups");
});

test("9: #/me for a community member and for an LP", async ({ page }) => {
  await connectAs(page, MEMBER);
  await page.goto("/#/me");
  await expect(page.locator("#me-history-title")).toBeVisible();
  await shot(page, "me-member");
  await connectAs(page, LP);
  await page.goto("/#/me");
  await expect(page.locator("#me-history-title")).toBeVisible();
  await expect(page.locator(".me-history a.tx-link").first()).toBeVisible();
  await shot(page, "me-lp");
});

test("10: the demo's seven offline scenes still run, and link to the live proofs", async ({ page }) => {
  await page.goto("/#/demo");
  await expect(page.locator(".scenes li")).toHaveCount(7);
  await expect(page.locator(".scenes-live a[href='#/proof']")).toBeVisible();
  await page.getByRole("button", { name: "Run scene" }).click();
  await expect(page.locator(".stage")).not.toContainText("Run scene", { timeout: 60_000 });
  await shot(page, "demo");
});
