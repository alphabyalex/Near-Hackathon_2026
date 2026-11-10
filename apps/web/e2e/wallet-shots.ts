/**
 * Screenshots of the connect panel at 1440 and iPhone SE: the picker, a tile on hover, a wallet
 * opening, an error, and the connected state. Run against the local testnet dev server:
 *
 *   node --import tsx e2e/wallet-shots.ts [baseUrl]
 *
 * Sends no transaction. Opening and the error are staged by holding or failing the wallet's code
 * download; the connected state is set the way a sign-in sets it (wallets/connected.ts).
 */
import { mkdirSync } from "node:fs";
import { chromium, devices, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
const OUT = "screenshots";
const ACCOUNT = "hyperios.testnet";
mkdirSync(OUT, { recursive: true });

async function openPanel(page: Page): Promise<void> {
  await page.goto(`${BASE}/#/`);
  await page.evaluate(() => sessionStorage.removeItem("wardline.connected"));
  await page.reload();
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("connect-dialog").waitFor();
  await page.waitForTimeout(500);
}

async function shoot(name: string, viewport: { width: number; height: number }, mobile: boolean): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext(mobile ? { ...devices["iPhone SE (3rd gen)"], browserName: undefined } as never : { viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const panel = () => page.getByTestId("connect-dialog");
  const shot = (what: string) => panel().screenshot({ path: `${OUT}/wallet-${what}-${name}.png` });
  const full = (what: string) => page.screenshot({ path: `${OUT}/wallet-${what}-${name}.png` });

  // The picker
  await openPanel(page);
  await (mobile ? full : shot)("picker");

  // A tile on hover (desktop only: phones have no hover)
  if (!mobile) {
    await panel().locator('[data-wallet-id="intear-wallet"]').hover();
    await page.waitForTimeout(250);
    await shot("hover");
  }

  // A wallet opening: Meteor's code download is held, so it stays on "Opening Meteor".
  await page.route(/meteor-near-connect/, () => undefined);
  await panel().locator('[data-wallet-id="meteor-wallet"]').click();
  await page.waitForTimeout(600);
  await (mobile ? full : shot)("opening");
  await page.unroute(/meteor-near-connect/);

  // An error: Intear's code download fails.
  await openPanel(page);
  await page.route(/wallet\.intear\.tech/, (r) => r.abort());
  await panel().locator('[data-wallet-id="intear-wallet"]').click();
  await panel().locator(".wp-error").waitFor({ timeout: 20_000 });
  await (mobile ? full : shot)("error");
  await page.unroute(/wallet\.intear\.tech/);

  // Connected: saved the way a sign-in saves it, then the panel opens from Change wallet.
  await page.goto(`${BASE}/#/`);
  await page.evaluate((account) => sessionStorage.setItem("wardline.connected", JSON.stringify({ account, wallet: "near-connect", via: "meteor-wallet" })), ACCOUNT);
  await page.reload();
  await page.getByRole("button", { name: "Change wallet" }).click();
  await panel().getByTestId("wallet-connected").waitFor();
  await page.waitForTimeout(2500);
  await (mobile ? full : shot)("connected");
  await browser.close();
}

await shoot("1440", { width: 1440, height: 900 }, false);
await shoot("iphone-se", { width: 375, height: 667 }, true);
console.log("saved screenshots/wallet-*.png");
