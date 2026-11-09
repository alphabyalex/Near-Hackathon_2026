import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";
import { evmAccount, signNep413, signSolana, solanaAddress } from "./keys";

export interface Wallets {
  /** The NEAR account the scripted wallet signs as. */
  setNearAccount(account: string): void;
}

/**
 * Scripted wallets: a NEAR wallet the app lists as "Test wallet" (only in builds with
 * VITE_WARDLINE_TEST_WALLET=1), an injected EIP-1193 provider and a Phantom-shaped provider. Keys
 * live in the test process; the page only receives signatures.
 */
export const test = base.extend<{ wallets: Wallets }>({
  wallets: async ({ page }, use) => {
    let nearAccount = "";
    await page.exposeFunction("__e2eNearSign", (message: string, recipient: string, nonce: string) => signNep413(nearAccount, message, recipient, nonce));
    await page.exposeFunction("__e2eEvmSign", (hex: `0x${string}`) => evmAccount.signMessage({ message: { raw: hex } }));
    await page.exposeFunction("__e2eSolanaSign", (bytes: number[]) => signSolana(bytes));
    await page.addInitScript(
      ({ evmAddress, solAddress }) => {
        const w = window as unknown as Record<string, unknown>;
        const call = (name: string, ...args: unknown[]) => (w[name] as (...a: unknown[]) => Promise<unknown>)(...args);
        w.__wardlineTestWallet = {
          name: "Test wallet",
          signMessage: (r: { message: string; recipient: string; nonce: string }) => call("__e2eNearSign", r.message, r.recipient, r.nonce),
        };
        w.ethereum = {
          request: async ({ method, params }: { method: string; params?: unknown[] }) => {
            if (method === "eth_requestAccounts" || method === "eth_accounts") return [evmAddress];
            if (method === "eth_chainId") return "0x14a34";
            if (method === "personal_sign") return call("__e2eEvmSign", (params as string[])[0]);
            throw new Error(`Unsupported: ${method}`);
          },
        };
        w.phantom = {
          solana: {
            isPhantom: true,
            connect: async () => ({ publicKey: { toString: () => solAddress } }),
            signMessage: async (bytes: Uint8Array) => ({ signature: Uint8Array.from((await call("__e2eSolanaSign", Array.from(bytes))) as number[]) }),
          },
        };
      },
      { evmAddress: evmAccount.address, solAddress: solanaAddress },
    );
    await use({ setNearAccount: (account) => (nearAccount = account) });
  },
});

export { expect };

/** No horizontal page scroll at the current viewport. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

/** axe-core with WCAG A and AA rules. Serious and critical findings fail the test. */
export async function expectAccessible(page: Page): Promise<void> {
  const appmain = page.locator(".appmain");
  if (await appmain.count() > 0) {
    await appmain.first().evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
  }
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

export async function signInAs(page: Page, wallets: Wallets, account: string): Promise<void> {
  wallets.setNearAccount(account);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("NEAR account").fill(account);
  await page.getByRole("button", { name: /Test wallet/ }).click();
  await expect(page.locator(".whoami")).toContainText(account);
}
