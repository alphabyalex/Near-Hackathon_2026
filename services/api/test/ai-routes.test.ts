import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { createChain, defaultSimSeed } from "../src/chain/index.js";
import { toDateClock } from "../src/time.js";
import { signNep413, type NearKeyLookup } from "../src/payee/proofs.js";
import { LOCAL_AUTH } from "./helpers.js";

const START = Date.parse("2026-11-09T12:00:00Z");
let nowMs = START;
const clock = () => BigInt(nowMs) * 1_000_000n;
const lp = (() => {
  const secret = ed25519.utils.randomSecretKey();
  return { account: "lp-new.testnet", secret, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
})();
const lookupKeys: NearKeyLookup = async (_n, accountId) => (accountId === lp.account ? [{ publicKey: lp.publicKey, fullAccess: true }] : []);

/** live: the server's sim with groups, history and proposals. Otherwise the launch seed, for exact numbers. */
function setup({ live = false }: { live?: boolean } = {}) {
  nowMs = START;
  const chain = live ? undefined : createChain("sim", toDateClock(clock), defaultSimSeed());
  const deps = bootstrap(":memory:", clock, { lookupKeys }, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "sim" }, ...(chain ? { chain } : {}) });
  return { deps, app: createApp(deps) };
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("group page data", () => {
  it("shows the budget, members, proposals, and flags the look-alike payout awaiting a vote", async () => {
    const { app } = setup();
    const group = (await (await app.request("/owner/group")).json()) as {
      budget: { deposit: string; members: { member: string }[] };
      proposals: { id: number; status: string; action: { type: string } | null }[];
      payouts: { receiver: string; verdict: string; flagged: boolean; domain: string | null; reasons: { code: string }[] }[];
      models: { model_id: string }[];
    };
    expect(group.budget.deposit).toBe("25000000");
    expect(group.budget.members.map((m) => m.member)).toEqual(["alice.testnet", "bob.testnet", "ci-agent.testnet"]);
    expect(group.proposals.find((p) => p.action?.type === "fund_budget")?.status).toBe("Approved");
    expect(group.proposals.find((p) => p.action?.type === "set_allowance")?.status).toBe("InProgress");
    const good = group.payouts.find((p) => p.receiver === "northwind.testnet")!;
    const bad = group.payouts.find((p) => p.receiver === "northw1nd.testnet")!;
    expect(good).toMatchObject({ verdict: "PAY", flagged: false, domain: "northwind.example" });
    expect(bad).toMatchObject({ verdict: "BLOCK", flagged: true });
    expect(bad.reasons.map((r) => r.code)).toContain("LOOKALIKE_ACCOUNT");
    expect(group.models.map((m) => m.model_id)).toContain("deepseek-ai/DeepSeek-V4.1-Flash-1017");
  });

  it("creates meter keys only for members, shows them once, and revokes them", async () => {
    const { app } = setup();
    expect((await app.request("/owner/meter-keys", post({ member: "mallory.testnet" }))).status).toBe(409);
    const created = (await (await app.request("/owner/meter-keys", post({ member: "alice.testnet", label: "notebook" }))).json()) as { key: string; row: { id: string; prefix: string } };
    expect(created.key).toMatch(/^wk_/);
    const listed = (await (await app.request("/owner/meter-keys")).json()) as { keys: Record<string, unknown>[] };
    expect(JSON.stringify(listed)).not.toContain(created.key);
    expect(listed.keys[0]).toMatchObject({ prefix: created.row.prefix, member: "alice.testnet" });
    expect((await app.request(`/owner/meter-keys/${created.row.id}/revoke`, post({}))).status).toBe(200);
    const models = await app.request("/v1/ai/models", { headers: { authorization: `Bearer ${created.key}` } });
    expect(models.status).toBe(401);
  });

  it("summarizes AI spend for the dashboard", async () => {
    const { app } = setup();
    const o = (await (await app.request("/owner/ai/overview")).json()) as { verifiedCalls: number; series: unknown[] };
    expect(o.verifiedCalls).toBe(0);
    expect(o.series).toHaveLength(14);
  });
});

describe("Wardline Mutual and WARD", () => {
  it("publishes WARD's price and supply, mints WARD for a signed USDC deposit, locks it for 7 days, then redeems it", async () => {
    const { app } = setup();
    const view = (await (await app.request("/v1/pool")).json()) as { pool: Record<string, unknown> };
    expect(view.pool).toMatchObject({ junior: "20000000", senior: "120000000", tvl: "140000000", ward_symbol: "WARD", ward_supply: "120000000", ward_price: "1000000", launch_price: "1000000", withdraw_delay_days: 7, trade_url: null });

    const sign = async (body: Record<string, string>) => {
      const ch = (await (await app.request("/v1/pool/challenge", post({ account: lp.account, ...body }))).json()) as { message: string; nonce: string; recipient: string };
      const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), lp.secret, ch.recipient);
      return app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: lp.publicKey, signature }));
    };
    const deposit = (await (await sign({ action: "deposit", amount: "10000000" })).json()) as { ward: string; position: { ward: string; value: string } };
    expect(deposit.ward).toBe("10000000");
    expect(deposit.position).toMatchObject({ ward: "10000000", value: "10000000" });

    const lock = (await (await sign({ action: "withdraw", amount: "10000000" })).json()) as { id: string; available_at: string; position: { ward: string; ward_locked: string } };
    expect(Date.parse(lock.available_at) - START).toBe(7 * 86_400_000);
    expect(lock.position).toMatchObject({ ward: "0", ward_locked: "10000000" });
    expect((await sign({ action: "withdraw", amount: "1" })).status).toBe(409);

    const early = await sign({ action: "redeem", id: lock.id });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { message: string }).message).toContain("7-day wait");

    nowMs = START + 7 * 86_400_000 + 1;
    const redeemed = (await (await sign({ action: "redeem", id: lock.id })).json()) as { usdc: string; position: { ward: string; ward_locked: string } };
    expect(redeemed.usdc).toBe("10000000");
    expect(redeemed.position).toMatchObject({ ward: "0", ward_locked: "0" });

    // A signature from the wrong key is refused, and the nonce cannot be reused.
    const ch = (await (await app.request("/v1/pool/challenge", post({ account: lp.account, action: "deposit", amount: "5000000" }))).json()) as { message: string; nonce: string; recipient: string };
    const forged = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), ed25519.utils.randomSecretKey(), ch.recipient);
    expect((await app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: lp.publicKey, signature: forged }))).status).toBe(401);
    expect((await app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: lp.publicKey, signature: forged }))).status).toBe(401);
  });

  it("WARD's price: deposits leave it, fees raise it, junior-only payouts leave it, bigger payouts dip it, fees bring it back", async () => {
    const pool = setup().deps.ai.chain.pool;
    const price = async () => BigInt((await pool.getPool()).ward_price);
    await pool.deposit("a.testnet", "25000000");
    expect(await price()).toBe(1_000_000n);
    await pool.addFees("2900000");
    const afterFees = await price();
    expect(afterFees).toBeGreaterThan(1_000_000n);
    const small = await pool.fileClaim({ subject: "s", claimant: "c", amount: "15000000", reason: "r" });
    expect(small).toMatchObject({ status: "paid", paid_from_junior: "15000000", paid_from_senior: "0" });
    expect(small.ward_price_after).toBe(small.ward_price_before);
    const big = await pool.fileClaim({ subject: "b", claimant: "c", amount: "20000000", reason: "r" });
    expect(big).toMatchObject({ status: "paid", paid_from_junior: "5000000", paid_from_senior: "15000000" });
    expect(BigInt(big.ward_price_after)).toBeLessThan(BigInt(big.ward_price_before));
    const dipped = await price();
    await pool.addFees("5000000");
    expect(await price()).toBeGreaterThan(dipped);
    const view = await pool.getPool();
    expect(view.price_history.map((p) => p.event)).toEqual(["launch", "deposit", "fees", "claim", "claim", "fees"]);
  });
});

describe("demo scenes run the real code paths", () => {
  const scene = async (name: string) => (await (await setup().app.request(`/v1/demo/${name}`, { method: "POST" })).json()) as Record<string, unknown>;

  it("1. the Mutual: stats, then an investor's USDC deposit mints WARD at today's price", async () => {
    const s = (await scene("mutual")) as { stats: { groups_covered: number; proven_payments: number; yield_earned: string; ward_price: string }; deposit: { usdc: string; ward: string; price: string }; position: { value: string } };
    expect(s.stats.groups_covered).toBe(4);
    expect((s.stats as unknown as { payouts: number; total_pooled: string }).payouts).toBe(1);
    expect((s.stats as unknown as { total_pooled: string }).total_pooled).toBe("141240000");
    expect(s.stats.proven_payments).toBeGreaterThan(600);
    expect(BigInt(s.stats.yield_earned)).toBeGreaterThan(0n);
    expect(BigInt(s.deposit.ward)).toBe((BigInt(s.deposit.usdc) * 1_000_000n) / BigInt(s.deposit.price));
    expect(Number(s.position.value)).toBeGreaterThanOrEqual(24_999_999);
  });

  it("2. a group plugs in: its DAO funds the budget, calls are paid only on proof, fees lift WARD", async () => {
    const s = (await scene("group")) as { proposal: { status: string; fund_tx: string }; calls: { proof: string; call: { status: string; settlement_tx: string; amount: string } }[]; batch: { proven: number; sent: number }; budget: { deposit: string }; ward: { before: string; after: string } };
    expect(s.proposal.status).toBe("Approved");
    expect(s.proposal.fund_tx).toMatch(/^sim-fund-/);
    expect(s.budget.deposit).toBe("20000000");
    expect(s.calls.map((c) => c.proof)).toEqual(["verified", "verified"]);
    expect(s.calls.every((c) => c.call.settlement_tx.startsWith("sim-settle-") && BigInt(c.call.amount) > 0n)).toBe(true);
    expect(s.batch.proven).toBe(s.batch.sent);
    expect(BigInt(s.ward.after)).toBeGreaterThan(BigInt(s.ward.before));
  });

  it("3. swapped model: refused and refunded", async () => {
    const s = (await scene("swap")) as { proof: string; error: { code: string }; call: { refund: string; reserved: string; amount: string } };
    expect(s).toMatchObject({ proof: "refused", error: { code: "MODEL_MISMATCH" } });
    expect(s.call.amount).toBe("0");
    expect(s.call.refund).toBe(s.call.reserved);
  });

  it("4. leaked key: stops at the member allowance, then the budget's hard cap", async () => {
    const s = (await scene("leak")) as { bursts: { paid: number; refused: number; reasons: string[] }[]; spent: string; cap: string; refused: number };
    expect(s.bursts[0]).toMatchObject({ paid: 20, refused: 20, reasons: ["ALLOWANCE_EXHAUSTED"] });
    expect(s.bursts[1]).toMatchObject({ paid: 10, refused: 30, reasons: ["BUDGET_EXHAUSTED"] });
    expect(s).toMatchObject({ spent: "15000000", cap: "15000000", refused: 50 });
  });

  it("5. look-alike payout: blocked before the DAO votes", async () => {
    const s = (await scene("invoice")) as { result: { verdict: string }; flagged: boolean; proposal: { receiver: string } };
    expect(s.result.verdict).toBe("BLOCK");
    expect(s.flagged).toBe(true);
    expect(s.proposal.receiver).toBe("northw1nd.testnet");
  });

  it("6. wrong approvals: our stake pays first and WARD holds; a bigger one dips WARD; fees refill it", async () => {
    const s = (await scene("payout")) as {
      before: { junior: string; ward_price: string; launch_price: string };
      payouts: { claim: { status: string; paid_from_junior: string; paid_from_senior: string }; pool: { junior: string; ward_price: string } }[];
      refill: { calls: number; ward_before: string; ward_after: string };
    };
    const [first, second] = s.payouts;
    expect(first!.claim).toMatchObject({ status: "paid", paid_from_junior: "8000000", paid_from_senior: "0" });
    expect(first!.pool.ward_price).toBe("1000000");
    expect(second!.claim).toMatchObject({ status: "paid", paid_from_junior: "12000000", paid_from_senior: "500000" });
    expect(second!.pool.junior).toBe("0");
    expect(second!.pool.ward_price).toBe("995833");
    expect(s.refill.ward_before).toBe("995833");
    expect(BigInt(s.refill.ward_after)).toBeGreaterThanOrEqual(BigInt(s.before.launch_price));
    expect(s.refill.calls).toBeGreaterThan(0);
  });

  it("7. a clean group moves up a tier and its fee drops", async () => {
    const s = (await scene("tier")) as { before: { tier: string; fee_bps: number }; after: { tier: string; fee_bps: number; coverage_cap: string }; first: { fee: string }; last: { fee: string } };
    expect(s.before).toMatchObject({ tier: "bronze", fee_bps: 200 });
    expect(s.after).toMatchObject({ tier: "silver", fee_bps: 150, coverage_cap: "50000000" });
    expect(s.first.fee).toBe("10000");
    expect(s.last.fee).toBe("7500");
  });
});

describe("near mode: the Mutual takes wallet transactions, never a signed message", () => {
  it("refuses the NEP-413 challenge and submit for deposit, withdraw, redeem, vote and propose, and never calls a pool", async () => {
    nowMs = START;
    const sim = createChain("sim", toDateClock(clock), defaultSimSeed());
    const calls: string[] = [];
    const spy = <T extends object>(target: T, label: string, methods: string[]): T =>
      new Proxy(target, {
        get(obj, prop, receiver) {
          const value = Reflect.get(obj, prop, receiver) as unknown;
          if (typeof prop === "string" && methods.includes(prop) && typeof value === "function") {
            return (...args: unknown[]) => {
              calls.push(`${label}.${prop}`);
              return (value as (...a: unknown[]) => unknown).apply(obj, args);
            };
          }
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(obj) : value;
        },
      });
    const chain = { ...sim, mode: "near" as const, pool: spy(sim.pool, "pool", ["deposit", "requestWithdraw", "redeem"]), governance: spy(sim.governance, "governance", ["vote", "propose"]) };
    const deps = bootstrap(":memory:", clock, { lookupKeys }, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "near" }, chain: chain as never });
    const app = createApp(deps);

    for (const body of [
      { action: "deposit", amount: "10000000" },
      { action: "withdraw", amount: "1000000" },
      { action: "redeem", id: "wd_1" },
      { action: "vote", id: 1, support: "for" },
      { action: "propose", description: "Raise coverage", proposal: { type: "set_coverage_multiplier", bps: 11_000 } },
    ]) {
      const res = await app.request("/v1/pool/challenge", post({ account: lp.account, ...body }));
      expect(res.status, body.action).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe("WALLET_TRANSACTION");
    }
    const submit = await app.request("/v1/pool/submit", post({ nonce: Buffer.alloc(32).toString("base64"), publicKey: lp.publicKey, signature: "AAAA" }));
    expect(submit.status).toBe(409);
    expect(calls).toEqual([]);
  });
});
