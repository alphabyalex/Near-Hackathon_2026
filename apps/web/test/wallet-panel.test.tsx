/**
 * The connect panel: the wallet list and its order, one-click connect through NEAR Connect (mocked),
 * a first connect that sticks however it lands, the connected state, errors, and axe in both states.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/source", () => ({ DATA_SOURCE: "testnet" }));

import { setRpcFetch } from "../src/data/chain";
import { installedIds, NEVER_SHOWN, orderWallets, WALLETS } from "../src/wallets/catalog";
import { setConnected, useConnected } from "../src/wallets/connected";
import { setConnectorFactory, type ConnectorLike } from "../src/wallets/near";
import { WalletPanel } from "../src/wallets/WalletPanel";

const ACCOUNT = "hyperios.testnet";
type SignIn = (p: { wallet?: { manifest: { id: string } }; accounts?: Array<{ accountId: string }> }) => void;

let onSignIn: SignIn | null;
let connect: ReturnType<typeof vi.fn>;
let near = "496000000000000000000000"; // 0.496 NEAR

function mockConnector(result: () => Promise<unknown>) {
  connect = vi.fn(() => result());
  setConnectorFactory(
    () =>
      ({
        connect: connect as never,
        wallet: async () => {
          throw new Error("No accounts found");
        },
        disconnect: async () => undefined,
        on: (event: string, cb: SignIn) => {
          if (event === "wallet:signIn") onSignIn = cb;
        },
      }) as unknown as ConnectorLike,
  );
}

const wallet = (id: string, accountId = ACCOUNT) => ({ manifest: { id, name: id, features: {} }, getAccounts: async () => [{ accountId }] });

beforeEach(() => {
  onSignIn = null;
  near = "496000000000000000000000";
  setConnected(null);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ contract: "pool.wardline-labs.testnet", token: "usdc.testnet" }), { status: 200, headers: { "content-type": "application/json" } })));
  setRpcFetch(async (_url, init) => {
    const { params } = JSON.parse(String(init.body)) as { params: { request_type: string; method_name?: string } };
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result }));
    if (params.request_type === "view_account") return reply({ amount: near, locked: "0", storage_usage: 0 });
    return reply({ result: Array.from(new TextEncoder().encode(JSON.stringify("10000000"))) });
  });
});

afterEach(() => {
  cleanup();
  setConnectorFactory(null);
  setRpcFetch(null);
  vi.unstubAllGlobals();
  setConnected(null);
});

async function axeClean(node: Element) {
  const result = await axe.run(node, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

describe("the wallet list", () => {
  it("shows Meteor, Intear and Nightly in the grid, Ledger under More wallets, and never the excluded ones", () => {
    expect(WALLETS.filter((w) => w.group === "main").map((w) => w.name)).toEqual(["Meteor", "Intear", "Nightly"]);
    expect(WALLETS.filter((w) => w.group === "more").map((w) => w.name)).toEqual(["Ledger"]);
    for (const id of NEVER_SHOWN) expect(WALLETS.map((w) => w.id)).not.toContain(id);
    for (const w of WALLETS) expect(existsSync(`public${w.logo}`), w.logo).toBe(true);
  });

  it("puts installed wallets first, then on phones wallets with a phone app", () => {
    const ids = (o: Parameters<typeof orderWallets>[1]) => orderWallets(WALLETS, o).map((w) => w.id);
    expect(ids({ installed: new Set(), mobile: false })).toEqual(["meteor-wallet", "intear-wallet", "nightly-wallet", "ledger"]);
    expect(ids({ installed: new Set(["nightly-wallet"]), mobile: false })[0]).toBe("nightly-wallet");
    expect(ids({ installed: new Set(), mobile: true })[0]).toBe("meteor-wallet");
    expect(ids({ installed: new Set(["intear-wallet"]), mobile: true }).slice(0, 2)).toEqual(["intear-wallet", "meteor-wallet"]);
  });

  it("detects an installed extension", () => {
    (window as unknown as { nightly?: unknown }).nightly = { near: {} };
    expect(installedIds().has("nightly-wallet")).toBe(true);
    delete (window as unknown as { nightly?: unknown }).nightly;
  });

  it("keeps red out of the panel: a failed connect is not below the line", () => {
    expect(readFileSync("src/wallets/wallet-panel.css", "utf8")).not.toMatch(/--red|#ff5c73|#ff7a8c/i);
  });
});

describe("one click connects", () => {
  it("a tile connects that wallet directly, shows Opening on it and dims the rest", async () => {
    mockConnector(() => new Promise(() => undefined));
    render(<WalletPanel onClose={() => undefined} />);
    const panel = screen.getByTestId("connect-dialog");
    await axeClean(panel);
    fireEvent.click(screen.getByRole("button", { name: /Meteor/ }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ walletId: "meteor-wallet" }));
    expect(screen.getByText("Opening Meteor")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Intear/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("NEAR account")).toBeNull();
  });

  it("the first connect sticks from the sign-in event, even when the wallet's answer never comes", async () => {
    mockConnector(() => new Promise(() => undefined));
    let seen: string | null = null;
    function Probe() {
      seen = useConnected()?.account ?? null;
      return null;
    }
    const { unmount } = render(
      <>
        <WalletPanel onClose={() => undefined} />
        <Probe />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Meteor/ }));
    await waitFor(() => expect(onSignIn).not.toBeNull());
    act(() => onSignIn!({ wallet: { manifest: { id: "meteor-wallet" } }, accounts: [{ accountId: ACCOUNT }] }));
    expect(seen).toBe(ACCOUNT);
    expect(await screen.findByTestId("wallet-connected")).toBeTruthy();
    unmount();
  });

  it("the first connect sticks after the panel closed (focus lost, slow wallet window)", async () => {
    mockConnector(() => new Promise(() => undefined));
    const { unmount } = render(<WalletPanel onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Meteor/ }));
    await waitFor(() => expect(onSignIn).not.toBeNull());
    unmount();
    onSignIn!({ wallet: { manifest: { id: "meteor-wallet" } }, accounts: [{ accountId: ACCOUNT }] });
    expect(JSON.parse(localStorage.getItem("wardline.connected")!)).toMatchObject({ account: ACCOUNT, wallet: "near-connect", via: "meteor-wallet" });
  });

  it("an account on another network does not stick", async () => {
    mockConnector(() => new Promise(() => undefined));
    render(<WalletPanel onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Meteor/ }));
    await waitFor(() => expect(onSignIn).not.toBeNull());
    act(() => onSignIn!({ accounts: [{ accountId: "someone.near" }] }));
    expect(localStorage.getItem("wardline.connected")).toBeNull();
  });
});

describe("errors", () => {
  it("a rejected sign-in says so in the panel, and Try again asks the same wallet again", async () => {
    mockConnector(() => Promise.reject(new Error("User rejected")));
    render(<WalletPanel onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Intear/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your wallet didn't sign.");
    await axeClean(screen.getByTestId("connect-dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    expect(connect).toHaveBeenLastCalledWith({ walletId: "intear-wallet" });
  });

  it("a blocked window and an unreachable wallet each get their own words", async () => {
    mockConnector(() => Promise.reject(new Error("Couldn't open popup window to complete wallet action")));
    render(<WalletPanel onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Meteor/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Your browser blocked the wallet window.");
    cleanup();
    mockConnector(() => Promise.reject(new TypeError("Failed to fetch")));
    render(<WalletPanel onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Nightly/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("That wallet didn't answer.");
  });
});

describe("connected, in the same panel", () => {
  it("shows the member's sphere, the account, USDC and NEAR, and the next steps; Disconnect is a quiet link", async () => {
    mockConnector(async () => wallet("meteor-wallet"));
    setConnected({ account: ACCOUNT, wallet: "near-connect", via: "meteor-wallet" });
    render(<WalletPanel onClose={() => undefined} />);
    const done = await screen.findByTestId("wallet-connected");
    expect(done.textContent).toContain(ACCOUNT);
    expect(done.textContent).toContain("Connected with Meteor");
    expect(done.querySelector("svg[role=img]")?.getAttribute("aria-label")).toContain(ACCOUNT);
    await waitFor(() => expect(done.textContent).toContain("10.00"));
    expect(done.textContent).toContain("0.496");
    expect(done.textContent).not.toContain("network fees");
    expect(screen.getByRole("button", { name: "Go to my share" }).className).toBe("btn");
    expect(screen.getByRole("button", { name: "Switch wallet" }).className).toContain("ghost");
    expect(screen.getByRole("button", { name: "Disconnect" }).className).toBe("wp-quiet");
    await axeClean(screen.getByTestId("connect-dialog"));
  });

  it("says when the account needs a little NEAR for fees", async () => {
    near = "10000000000000000000000"; // 0.01 NEAR
    setConnected({ account: ACCOUNT, wallet: "near-connect" });
    render(<WalletPanel onClose={() => undefined} />);
    expect(await screen.findByText(/a little NEAR/)).toBeTruthy();
  });

  it("Switch wallet goes back to the grid; Disconnect clears the account", async () => {
    mockConnector(async () => wallet("meteor-wallet"));
    setConnected({ account: ACCOUNT, wallet: "near-connect" });
    const { unmount } = render(<WalletPanel onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch wallet" }));
    expect(screen.getByRole("button", { name: /Meteor/ })).toBeTruthy();
    unmount();
    setConnected({ account: ACCOUNT, wallet: "near-connect" });
    render(<WalletPanel onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(localStorage.getItem("wardline.connected")).toBeNull();
  });
});
