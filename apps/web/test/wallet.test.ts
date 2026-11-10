/**
 * NEAR Connect with a mocked connector: connect, deposit, vote and redeem send real-shaped transactions
 * from the wallet, and nothing reaches the API's NEP-413 pool routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRpcFetch } from "../src/data/chain";
import { MIN_NEAR_FOR_FEES, planDeposit, sendDeposit, sendPoolAction, STORAGE_DEPOSIT } from "../src/data/wallet-pool";
import { connectNear, EXCLUDED_WALLETS, onNetwork, setConnectorFactory } from "../src/wallets/near";

const ACCOUNT = "hyperios.testnet";
const POOL = "pool.wardline-labs.testnet";
const USDC = "usdc.fake.testnet";
const NEAR = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const b64 = (v: unknown) => btoa(JSON.stringify(v));

interface Chain {
  usdc: bigint;
  near: string;
  ward: bigint[];
  registered: boolean;
}
let chain: Chain;
let apiCalls: string[];
let wallet: ReturnType<typeof mockWallet>;

function mockWallet(accountId = ACCOUNT) {
  const outcome = (value: unknown, hash: string) => ({ transaction: { hash }, status: { SuccessValue: b64(value) } });
  return {
    manifest: { id: "meteor-wallet", name: "Meteor", features: { signMessage: true, signAndSendTransaction: true, signAndSendTransactions: true, testnet: true } },
    getAccounts: vi.fn(async () => [{ accountId }]),
    signIn: vi.fn(),
    signOut: vi.fn(),
    signMessage: vi.fn(),
    signInAndSignMessage: vi.fn(),
    signDelegateActions: vi.fn(),
    signAndSendTransaction: vi.fn(async (p: { receiverId: string; actions: Array<{ params: { methodName: string } }> }) => {
      const m = p.actions[0]!.params.methodName;
      if (m === "request_redeem") return outcome({ id: "wd_7", available_at: "1794500000000000000ns", ward: "100000" }, "RedeemTx1111111111111111111111111111111111111");
      if (m === "redeem") return outcome({ usdc: "100024" }, "RedeemTx2222222222222222222222222222222222222");
      return outcome(null, `${m}Tx`.padEnd(44, "3"));
    }),
    signAndSendTransactions: vi.fn(async (p: { transactions: Array<{ receiverId: string; actions: Array<{ params: { methodName: string } }> }> }) =>
      p.transactions.map((t, i) => {
        const m = t.actions[0]!.params.methodName;
        if (m === "ft_transfer_call") chain.ward.push(chain.ward[0]! + 999_736n);
        return outcome(m === "ft_transfer_call" ? "1000000" : { total: STORAGE_DEPOSIT, available: "0" }, `Tx${i}`.padEnd(44, "4"));
      }),
    ),
  };
}

beforeEach(() => {
  chain = { usdc: 5_000_000n, near: NEAR(0.5), ward: [0n], registered: false };
  apiCalls = [];
  wallet = mockWallet();
  setConnectorFactory(() => ({ connect: async () => wallet as never, wallet: async () => wallet as never, disconnect: async () => undefined }));
  // The API: only GET /v1/pool, for the contract ids. Any other call is recorded, and the pool routes fail the test below.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    apiCalls.push(String(url));
    return new Response(JSON.stringify({ contract: POOL, token: USDC }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  setRpcFetch(async (_url, init) => {
    const { params } = JSON.parse(String(init.body)) as { params: { request_type: string; account_id: string; method_name?: string; args_base64?: string } };
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result }));
    if (params.request_type === "view_account") return reply({ amount: chain.near, locked: "0", storage_usage: 182 });
    const value = (v: unknown) => reply({ result: Array.from(new TextEncoder().encode(JSON.stringify(v))) });
    const args = JSON.parse(atob(params.args_base64 ?? "e30=")) as Record<string, string>;
    if (params.method_name === "ft_balance_of" && params.account_id === USDC) return value(chain.usdc.toString());
    if (params.method_name === "ft_balance_of" && params.account_id === POOL) return value(chain.ward[chain.ward.length - 1]!.toString());
    if (params.method_name === "storage_balance_of") return value(chain.registered ? { total: STORAGE_DEPOSIT, available: "0" } : null);
    if (params.method_name === "get_position") return value({ account: args.account, ward: chain.ward[chain.ward.length - 1]!.toString(), ward_locked: "0", value: "999736", pending_withdrawals: [] });
    return reply({ error: `no mock for ${params.method_name}` });
  });
});

afterEach(() => {
  setConnectorFactory(null);
  setRpcFetch(null);
  vi.unstubAllGlobals();
  expect(apiCalls.filter((u) => /\/v1\/pool\/(challenge|submit)/.test(u))).toEqual([]);
});

describe("connect with NEAR Connect", () => {
  it("takes the account from the wallet, and refuses an account on another network", async () => {
    expect(await connectNear()).toBe(ACCOUNT);
    wallet = mockWallet("someone.near");
    await expect(connectNear()).rejects.toThrow(/not a NEAR testnet account/);
    expect(onNetwork("a".repeat(64))).toBe(true);
    expect(EXCLUDED_WALLETS).toContain("ethereum-wallets");
  });
});

describe("Join on testnet: real transactions from the wallet", () => {
  it("registers storage on the pool first, then ft_transfer_call on USDC to the pool with 1 yocto and an empty msg, and reports WARD read before and after", async () => {
    const plan = await planDeposit(ACCOUNT, "1000000");
    expect(plan.problem).toBeNull();
    expect(plan.registered).toBe(false);
    expect(plan.calls.map((c) => [c.receiverId, c.methodName, c.deposit])).toEqual([
      [POOL, "storage_deposit", STORAGE_DEPOSIT],
      [USDC, "ft_transfer_call", "1"],
    ]);
    expect(plan.calls[1]!.args).toEqual({ receiver_id: POOL, amount: "1000000", msg: "" });

    const res = await sendDeposit(plan);
    expect(wallet.signAndSendTransactions).toHaveBeenCalledOnce();
    expect(wallet.signAndSendTransactions.mock.calls[0]![0]).toMatchObject({ network: "testnet", signerId: ACCOUNT });
    expect(res.ward).toBe("999736");
    expect(res.tx).toMatch(/^Tx1/);
  });

  it("skips registration once registered: one transaction", async () => {
    chain.registered = true;
    const plan = await planDeposit(ACCOUNT, "1000000");
    expect(plan.calls.map((c) => c.methodName)).toEqual(["ft_transfer_call"]);
    await sendDeposit(plan);
    expect(wallet.signAndSendTransaction).toHaveBeenCalledOnce();
    expect(wallet.signAndSendTransactions).not.toHaveBeenCalled();
  });

  it("stops before signing when USDC is short, then when NEAR for fees is short", async () => {
    chain.usdc = 400_000n;
    const short = await planDeposit(ACCOUNT, "1000000");
    expect(short.problem?.code).toBe("INSUFFICIENT_USDC");
    await expect(sendDeposit(short)).rejects.toThrow(/Not enough USDC/);

    chain.usdc = 5_000_000n;
    chain.near = NEAR(0.01);
    const broke = await planDeposit(ACCOUNT, "1000000");
    expect(broke.problem?.code).toBe("INSUFFICIENT_NEAR");
    expect(broke.problem?.message).toBe("You need about 0.05 NEAR for network fees.");
    expect(BigInt(broke.problem!.need)).toBe(MIN_NEAR_FOR_FEES);
    expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
    expect(wallet.signAndSendTransactions).not.toHaveBeenCalled();
  });
});

describe("vote and redeem on testnet: real transactions from the wallet", () => {
  it("votes with a pool transaction", async () => {
    const res = await sendPoolAction(ACCOUNT, { action: "vote", id: 3, support: "for" });
    const sent = wallet.signAndSendTransaction.mock.calls[0]![0] as unknown as { receiverId: string; signerId: string; actions: Array<{ params: { methodName: string; args: object; deposit: string } }> };
    expect(sent.receiverId).toBe(POOL);
    expect(sent.signerId).toBe(ACCOUNT);
    expect(sent.actions[0]!.params).toMatchObject({ methodName: "vote", args: { id: 3, support: "for" }, deposit: "0" });
    expect(res.tx).toMatch(/^voteTx/);
  });

  it("asks to redeem with request_redeem, then redeems with redeem", async () => {
    const lock = await sendPoolAction(ACCOUNT, { action: "withdraw", amount: "100000" });
    expect(lock).toMatchObject({ id: "wd_7", available_at: new Date(Number(1794500000000000000n / 1_000_000n)).toISOString() });
    const out = await sendPoolAction(ACCOUNT, { action: "redeem", id: "wd_7" });
    expect(out.usdc).toBe("100024");
    const methods = wallet.signAndSendTransaction.mock.calls.map((c) => (c[0] as unknown as { actions: Array<{ params: { methodName: string; args: object } }> }).actions[0]!.params);
    expect(methods).toEqual([
      expect.objectContaining({ methodName: "request_redeem", args: { amount: "100000" } }),
      expect.objectContaining({ methodName: "redeem", args: { account: ACCOUNT, id: "wd_7" } }),
    ]);
  });

  it("refuses to sign as an account the wallet isn't signed in as", async () => {
    await expect(sendPoolAction("dana.wardline-labs.testnet", { action: "vote", id: 3, support: "for" })).rejects.toThrow(/signed as hyperios.testnet/);
    expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
});
