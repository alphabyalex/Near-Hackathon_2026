import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { signNep413, type NearKeyLookup } from "../src/payee/proofs.js";
import { LOCAL_AUTH } from "./helpers.js";

const clock = () => BigInt(Date.parse("2026-11-09T12:00:00Z")) * 1_000_000n;
const lp = (() => {
  const secret = ed25519.utils.randomSecretKey();
  return { account: "lp-new.testnet", secret, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
})();
const lookupKeys: NearKeyLookup = async (_n, accountId) => (accountId === lp.account ? [{ publicKey: lp.publicKey, fullAccess: true }] : []);

function setup() {
  const deps = bootstrap(":memory:", clock, { lookupKeys }, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "sim" } });
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

describe("Wardline Mutual", () => {
  it("publishes TVL, tranches and claims, and takes a wallet-signed deposit and a 7-day withdrawal", async () => {
    const { app } = setup();
    const view = (await (await app.request("/v1/pool")).json()) as { pool: { tvl: string; junior: string; senior: string; withdraw_delay_days: number } };
    expect(view.pool).toMatchObject({ junior: "5000000000", senior: "20000000000", tvl: "25000000000", withdraw_delay_days: 7 });

    const sign = async (action: string, amount: string) => {
      const ch = (await (await app.request("/v1/pool/challenge", post({ account: lp.account, action, amount }))).json()) as { message: string; nonce: string; recipient: string };
      const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), lp.secret, ch.recipient);
      return app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: lp.publicKey, signature }));
    };
    const deposit = (await (await sign("deposit", "100000000")).json()) as { position: { value: string; shares: string } };
    expect(deposit.position.value).toBe("100000000");
    const withdraw = (await (await sign("withdraw", deposit.position.shares)).json()) as { available_at: string };
    expect(Date.parse(withdraw.available_at) - Date.parse("2026-11-09T12:00:00Z")).toBe(7 * 86_400_000);

    // A signature from the wrong key is refused, and the nonce cannot be reused.
    const ch = (await (await app.request("/v1/pool/challenge", post({ account: lp.account, action: "deposit", amount: "5" }))).json()) as { message: string; nonce: string; recipient: string };
    const forged = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), ed25519.utils.randomSecretKey(), ch.recipient);
    expect((await app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: lp.publicKey, signature: forged }))).status).toBe(401);
    expect((await app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: lp.publicKey, signature: forged }))).status).toBe(401);
  });
});

describe("demo scenes run the real code paths", () => {
  const scene = async (name: string) => (await (await setup().app.request(`/v1/demo/${name}`, { method: "POST" })).json()) as Record<string, unknown>;

  it("1. plug-in: two recorded NEAR AI calls, both verified and settled", async () => {
    const s = (await scene("plugin")) as { calls: { proof: string; call: { status: string; settlement_tx: string; amount: string } }[] };
    expect(s.calls.map((c) => c.proof)).toEqual(["verified", "verified"]);
    expect(s.calls.every((c) => c.call.settlement_tx.startsWith("sim-settle-") && BigInt(c.call.amount) > 0n)).toBe(true);
  });

  it("2. swapped model: refused and refunded", async () => {
    const s = (await scene("swap")) as { proof: string; error: { code: string }; call: { refund: string; reserved: string; amount: string } };
    expect(s).toMatchObject({ proof: "refused", error: { code: "MODEL_MISMATCH" } });
    expect(s.call.amount).toBe("0");
    expect(s.call.refund).toBe(s.call.reserved);
  });

  it("3. leaked key: stops at the member allowance, then the budget's hard cap", async () => {
    const s = (await scene("leak")) as { bursts: { paid: number; refused: number; reasons: string[] }[]; spent: string; cap: string; refused: number };
    expect(s.bursts[0]).toMatchObject({ paid: 10, refused: 30, reasons: ["ALLOWANCE_EXHAUSTED"] });
    expect(s.bursts[1]).toMatchObject({ paid: 5, refused: 35, reasons: ["BUDGET_EXHAUSTED"] });
    expect(s.spent).toBe(s.cap);
  });

  it("4. fake bank details: blocked", async () => {
    const s = (await scene("invoice")) as { result: { verdict: string } };
    expect(s.result.verdict).toBe("BLOCK");
  });

  it("5. wrong approval: the Mutual pays at once, junior tranche first", async () => {
    const s = (await scene("mutual")) as { before: { junior: string; senior: string }; after: { junior: string; senior: string }; claim: { status: string; paid_from_junior: string; paid_from_senior: string } };
    expect(s.claim).toMatchObject({ status: "paid", paid_from_junior: "400000000", paid_from_senior: "0" });
    expect(BigInt(s.before.junior) - BigInt(s.after.junior)).toBe(400_000_000n);
    expect(s.after.senior).toBe(s.before.senior);
  });
});
