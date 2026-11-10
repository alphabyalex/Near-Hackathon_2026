import { describe, expect, it } from "vitest";
import type { Rpc } from "../src/activity/log.js";
import { AccountTransactions, confirmTx, fromLog, mergeRows, totals, touchesWardline, type IndexedTx, type Indexer } from "../src/activity/transactions.js";
import type { ActivityItem } from "../src/activity/types.js";

const ME = "hyperios.testnet";
const C = { pool: "pool.wardline-labs.testnet", usdc: "usdc.fake.testnet" };
const H = (c: string) => c.repeat(44).slice(0, 44);
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const NS = "1794343320450662019";

const DEPOSIT: IndexedTx = { hash: H("A"), signer: ME, receiver: C.usdc, methods: ["ft_transfer_call"], timestampNs: NS };
const VOTE: IndexedTx = { hash: H("B"), signer: ME, receiver: C.pool, methods: ["vote"], timestampNs: "1794343400000000000" };
const FAILED_VOTE: IndexedTx = { hash: H("C"), signer: ME, receiver: C.pool, methods: ["vote"], timestampNs: "1794343500000000000" };
const OTHER: IndexedTx = { hash: H("D"), signer: ME, receiver: "someone-else.testnet", methods: ["ft_transfer_call"], timestampNs: NS };
const STORAGE: IndexedTx = { hash: H("E"), signer: ME, receiver: C.pool, methods: ["storage_deposit"], timestampNs: NS };
const FAKE: IndexedTx = { hash: H("F"), signer: ME, receiver: C.pool, methods: ["vote"], timestampNs: NS };
const USDC_ELSEWHERE: IndexedTx = { hash: H("G"), signer: ME, receiver: C.usdc, methods: ["ft_transfer_call"], timestampNs: NS };
const RECEIVE_WARD: IndexedTx = { hash: H("R"), signer: "sender.testnet", receiver: C.pool, methods: ["ft_transfer"], timestampNs: NS };
const SEND_WARD_CALL: IndexedTx = { hash: H("S"), signer: ME, receiver: C.pool, methods: ["ft_transfer_call"], timestampNs: NS };

/** The RPC knows A, B, C, G, R, and S; F is a hash nobody ever sent. */
const rpc: Rpc = async (_method, params) => {
  const { tx_hash } = params as { tx_hash: string };
  const fc = (method_name: string, args: unknown) => [{ FunctionCall: { method_name, args: b64(args), deposit: "1", gas: 1 } }];
  if (tx_hash === DEPOSIT.hash)
    return {
      transaction: { hash: tx_hash, signer_id: ME, receiver_id: C.usdc, actions: fc("ft_transfer_call", { receiver_id: C.pool, amount: "10000000", msg: "" }) },
      status: { SuccessValue: b64("10000000") },
      receipts_outcome: [{ outcome: { logs: [`EVENT_JSON:${JSON.stringify({ standard: "wardline", version: "1.0.0", event: "pool_deposited", data: [{ account: ME, amount: "10000000", shares: "9996121" }] })}`] } }],
    };
  if (tx_hash === VOTE.hash) return { transaction: { hash: tx_hash, signer_id: ME, receiver_id: C.pool, actions: fc("vote", { id: 3, support: "for" }) }, status: { SuccessValue: "" }, receipts_outcome: [] };
  if (tx_hash === FAILED_VOTE.hash) return { transaction: { hash: tx_hash, signer_id: ME, receiver_id: C.pool, actions: fc("vote", { id: 3, support: "against" }) }, status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "already voted" } } } } }, receipts_outcome: [] };
  if (tx_hash === USDC_ELSEWHERE.hash) return { transaction: { hash: tx_hash, signer_id: ME, receiver_id: C.usdc, actions: fc("ft_transfer_call", { receiver_id: "dex.testnet", amount: "5", msg: "" }) }, status: { SuccessValue: b64("5") }, receipts_outcome: [] };
  if (tx_hash === RECEIVE_WARD.hash)
    return {
      transaction: { hash: tx_hash, signer_id: "sender.testnet", receiver_id: C.pool, actions: fc("ft_transfer", { receiver_id: ME, amount: "5000000" }) },
      status: { SuccessValue: "" },
      receipts_outcome: [{ outcome: { logs: [`EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [{ old_owner_id: "sender.testnet", new_owner_id: ME, amount: "5000000" }] })}`] } }],
    };
  if (tx_hash === SEND_WARD_CALL.hash)
    return {
      transaction: { hash: tx_hash, signer_id: ME, receiver_id: C.pool, actions: fc("ft_transfer_call", { receiver_id: "vault.testnet", amount: "2000000", msg: "" }) },
      status: { SuccessValue: b64("2000000") },
      receipts_outcome: [],
    };
  throw new Error("UNKNOWN_TRANSACTION");
};

describe("the filter: only our contracts", () => {
  it("keeps USDC ft_transfer_call and the pool's own methods; drops other receivers, other methods and non-hashes", () => {
    expect(touchesWardline(DEPOSIT, C)).toBe(true);
    expect(touchesWardline(VOTE, C)).toBe(true);
    for (const m of ["request_redeem", "request_withdraw", "redeem", "propose", "execute", "ft_transfer", "ft_transfer_call"]) expect(touchesWardline({ ...VOTE, methods: [m] }, C), m).toBe(true);
    expect(touchesWardline(OTHER, C)).toBe(false);
    expect(touchesWardline(STORAGE, C)).toBe(false);
    expect(touchesWardline({ ...VOTE, hash: "pool:proposal:2" }, C)).toBe(false);
  });

  it("drops a USDC transfer that went anywhere but the pool, once the RPC shows its arguments", async () => {
    expect(await confirmTx(rpc, USDC_ELSEWHERE, ME, C)).toBeNull();
  });
});

describe("confirmation with the RPC", () => {
  it("reads a deposit's USDC, the WARD the pool minted and the price", async () => {
    const row = await confirmTx(rpc, DEPOSIT, ME, C);
    expect(row).toMatchObject({ type: "buy", status: "confirmed", usdc: "10000000", ward: "9996121", price: "1000388", explorer_url: `https://testnet.nearblocks.io/txns/${DEPOSIT.hash}` });
    expect(row!.at).toBe(new Date(Number(BigInt(NS) / 1_000_000n)).toISOString());
  });

  it("drops a hash the RPC doesn't know, and one whose signer isn't what the indexer said", async () => {
    expect(await confirmTx(rpc, FAKE, ME, C)).toBeNull();
    expect(await confirmTx(rpc, { ...VOTE, signer: "mallory.testnet" }, ME, C)).toBeNull();
  });

  it("keeps a failed transaction, as failed", async () => {
    expect(await confirmTx(rpc, FAILED_VOTE, ME, C)).toMatchObject({ type: "vote", status: "failed", proposal: 3, support: "against" });
  });

  it("confirms received WARD via ft_transfer and sent WARD via ft_transfer_call", async () => {
    const rx = await confirmTx(rpc, RECEIVE_WARD, ME, C);
    expect(rx).toMatchObject({ type: "receive", status: "confirmed", ward: "5000000" });
    const sx = await confirmTx(rpc, SEND_WARD_CALL, ME, C);
    expect(sx).toMatchObject({ type: "send", status: "confirmed", ward: "2000000" });
  });
});

describe("merging and totals", () => {
  const logItem = (tx: string, kind: string, outcome: string, amount: string | null, text: string): ActivityItem =>
    ({ at: "2026-11-10T11:00:00.000Z", actor: ME, community: "mutual", group: "mutual", budget_id: "mutual", kind, side: "above", text, amount, model: null, outcome, reason: null, tx, tx_hash: tx, block_height: 1, explorer_url: "" }) as ActivityItem;

  it("de-duplicates by hash, the chain's reading first, newest first", async () => {
    const chain = [(await confirmTx(rpc, DEPOSIT, ME, C))!, (await confirmTx(rpc, VOTE, ME, C))!];
    const log = [fromLog(logItem(DEPOSIT.hash, "deposit", "paid", "10000000", "deposited"), ME)!, fromLog(logItem(H("Z"), "vote", "voted", null, "voted for on proposal 1"), ME)!];
    const rows = mergeRows(chain, log);
    expect(rows.map((r) => r.hash)).toEqual([VOTE.hash, DEPOSIT.hash, H("Z")]);
    expect(rows.find((r) => r.hash === DEPOSIT.hash)!.source).toBe("chain");
    expect(rows.find((r) => r.hash === H("Z"))).toMatchObject({ type: "vote", proposal: 1, support: "for", source: "log" });
  });

  it("adds up deposits and redemptions from confirmed rows only", async () => {
    const buy = (await confirmTx(rpc, DEPOSIT, ME, C))!;
    expect(totals([buy, { ...buy, hash: H("Q"), status: "failed" }, { ...buy, hash: H("R"), type: "sell", usdc: "2500000" }])).toEqual({ deposited: "10000000", redeemed: "2500000" });
  });
});

describe("the indexer and the cache", () => {
  it("returns only confirmed rows from what the indexer lists", async () => {
    const indexer: Indexer = { list: async () => [DEPOSIT, VOTE, FAILED_VOTE, OTHER, STORAGE, FAKE, USDC_ELSEWHERE] };
    const view = await new AccountTransactions({ indexer, rpc, contracts: C, log: () => [] }).get(ME);
    expect(view.complete).toBe(true);
    expect(view.transactions.map((r) => [r.hash[0], r.status])).toEqual([["C", "failed"], ["B", "confirmed"], ["A", "confirmed"]]);
  });

  it("caches each account for 30 seconds", async () => {
    let calls = 0;
    let now = 0;
    const indexer: Indexer = { list: async () => (calls++, [DEPOSIT]) };
    const t = new AccountTransactions({ indexer, rpc, contracts: C, log: () => [], now: () => now });
    await t.get(ME);
    now = 29_000;
    await t.get(ME);
    expect(calls).toBe(1);
    now = 31_000;
    await t.get(ME);
    expect(calls).toBe(2);
  });

  it("when the indexer is down, returns the rows it already had and says the list may be incomplete", async () => {
    let up = true;
    let now = 0;
    const indexer: Indexer = { list: async () => (up ? [DEPOSIT] : Promise.reject(new Error("NearBlocks answered HTTP 503"))) };
    const t = new AccountTransactions({ indexer, rpc, contracts: C, log: () => [], now: () => now });
    expect((await t.get(ME)).complete).toBe(true);
    up = false;
    now = 60_000;
    const down = await t.get(ME);
    expect(down.complete).toBe(false);
    expect(down.transactions.map((r) => r.hash)).toEqual([DEPOSIT.hash]);
    expect(down.explorer_account_url).toBe(`https://testnet.nearblocks.io/address/${ME}`);
  });
});
