/** Your transactions: plain words, Pending right after an action, Confirmed once the API returns it. */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/source", () => ({ DATA_SOURCE: "testnet" }));

import { addPending, confirmedTotals, setTransactionsFetch, useTransactions, type TransactionsView, type WalletTx } from "../src/data/transactions";
import { Transactions } from "../src/views/site/Transactions";

const ME = "hyperios.testnet";
const H = (c: string) => c.repeat(44).slice(0, 44);
const row = (over: Partial<WalletTx>): WalletTx => ({ hash: H("A"), at: "2026-11-10T20:42:00.450Z", type: "buy", status: "confirmed", usdc: "10000000", ward: "9996121", price: "1000388", proposal: null, support: null, unlock_at: null, explorer_url: `https://testnet.nearblocks.io/txns/${H("A")}`, ...over });
const view = (transactions: WalletTx[], complete = true): TransactionsView => ({ account: ME, transactions, complete, explorer_account_url: `https://testnet.nearblocks.io/address/${ME}`, totals: confirmedTotals(transactions) });

function Page({ account = ME }: { account?: string }) {
  const t = useTransactions(account);
  return <Transactions view={t.view} rows={t.rows} loading={!t.view} />;
}

afterEach(() => {
  cleanup();
  setTransactionsFetch(null);
  vi.useRealTimers();
});

describe("the table", () => {
  it("says what each transaction was, with its amounts, price, status and a link to the explorer", async () => {
    setTransactionsFetch(async () =>
      view([
        row({ hash: H("V"), type: "vote", proposal: 3, support: "against", usdc: null, ward: null, price: null, at: "2026-11-10T22:00:00Z" }),
        row({ hash: H("S"), type: "sell_request", usdc: null, ward: "100000", price: null, unlock_at: "2026-11-17T22:00:00Z", at: "2026-11-10T21:00:00Z" }),
        row({ hash: H("F"), type: "vote", status: "failed", proposal: 3, support: "for", usdc: null, ward: null, price: null, at: "2026-11-10T20:50:00Z" }),
        row({}),
      ]),
    );
    render(<Page />);
    const table = await screen.findByRole("table");
    const rows = table.querySelectorAll("tbody tr");
    expect([...rows].map((r) => r.querySelector(".tx-type")!.textContent)).toEqual(["Voted against #3", expect.stringMatching(/^Sell requestedUnlocks /), "Voted for #3", "Bought WARD"]);
    const buy = rows[3]!;
    expect(buy.textContent).toContain("10.00");
    expect(buy.textContent).toContain("+9.99");
    expect(buy.textContent).toContain("1.0004");
    expect(buy.querySelector("a")!.getAttribute("href")).toBe(`https://testnet.nearblocks.io/txns/${H("A")}`);
    expect(buy.querySelector("time")!.getAttribute("title")).toMatch(/2026/);
    expect(rows[2]!.textContent).toContain("Failed");
    expect(rows[0]!.className).toContain("f-gov");
    expect(rows[1]!.className).toContain("f-out");
    expect(buy.className).toContain("f-in");
  });

  it("shows 10 at a time with Show more", async () => {
    setTransactionsFetch(async () => view(Array.from({ length: 23 }, (_, i) => row({ hash: H(String.fromCharCode(65 + i)), at: new Date(Date.UTC(2026, 10, 10, 0, 60 - i)).toISOString() }))));
    render(<Page />);
    await screen.findByRole("table");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more" }));
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(23);
  });

  it("says history may be missing, with the account on the explorer, when the indexer was down", async () => {
    setTransactionsFetch(async () => view([row({})], false));
    render(<Page />);
    const link = await screen.findByRole("link", { name: "Check the explorer" });
    expect(link.getAttribute("href")).toBe(`https://testnet.nearblocks.io/address/${ME}`);
  });

  it("uses no red: buys and sells differ by their mark, not by a below-the-line color", () => {
    expect(readFileSync("src/views/site/transactions.css", "utf8")).not.toMatch(/--red|#ff5c73|#ff7a8c/i);
  });
});

describe("pending, then confirmed", () => {
  it("a new deposit shows at the top as Pending with its hash, then flips to Confirmed once the API returns it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const NEW = H("N");
    let onChain = false;
    const asked: string[][] = [];
    setTransactionsFetch(async (_a, pending) => {
      asked.push(pending);
      return view(onChain ? [row({ hash: NEW, at: "2026-11-10T23:00:00Z" }), row({})] : [row({})]);
    });
    render(<Page />);
    await screen.findByRole("table");
    act(() => addPending(ME, { hash: NEW, type: "buy", usdc: "5000000", ward: "4998000" }));
    const first = () => document.querySelector("tbody tr")!;
    await waitFor(() => expect(first().getAttribute("data-status")).toBe("pending"));
    expect(first().textContent).toContain("Pending");
    expect(first().querySelector("a")!.getAttribute("href")).toContain(NEW);
    await waitFor(() => expect(asked.some((p) => p.includes(NEW))).toBe(true));
    onChain = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    await waitFor(() => expect(first().getAttribute("data-status")).toBe("confirmed"));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("adds up deposits and redemptions from confirmed rows only", () => {
    expect(confirmedTotals([row({}), row({ hash: H("P"), status: "pending" }), row({ hash: H("R"), type: "sell", usdc: "2000000" }), row({ hash: H("X"), status: "failed" })])).toEqual({ deposited: "10000000", redeemed: "2000000" });
  });
});
