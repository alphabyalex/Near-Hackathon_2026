import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { createChain, defaultSimSeed, GROUP_BUDGET, recordedModels, type SimChainSeed, type SimGovernance, type SimPool } from "../src/chain/index.js";
import { demoMeterKeyFromEnv, seedMeterKeysFromEnv } from "../src/demo-key.js";
import { signNep413, type NearKeyLookup } from "../src/payee/proofs.js";
import { toDateClock } from "../src/time.js";
import { LOCAL_AUTH } from "./helpers.js";

const START = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
let nowMs = START;
const now = () => new Date(nowMs);
const W = (n: number) => String(Math.round(n * 1_000_000));

function chain(seed: SimChainSeed = defaultSimSeed()) {
  nowMs = START;
  const c = createChain("sim", now, seed);
  return { c, pool: c.pool as SimPool, gov: c.governance as SimGovernance };
}

describe("WARD-holder voting (sim)", () => {
  it("weights votes by WARD at the snapshot: a deposit after it gets no vote", async () => {
    const { pool, gov } = chain();
    const p = await gov.propose({ proposer: "lp-north.testnet", description: "Lower the Silver fee to 1.25%", action: { type: "set_fee_bps", tier: "silver", fee_bps: 125 } });
    expect(p.snapshot_supply).toBe(W(120));
    await pool.deposit("late.testnet", W(500));
    await expect(gov.vote({ id: p.id, voter: "late.testnet", support: "for" })).rejects.toThrow(/held no WARD/);
    expect(await gov.weightOf(p.id, "lp-harbor.testnet")).toBe(W(50));
  });

  it("a transfer after the snapshot does not double-count", async () => {
    const { pool, gov } = chain();
    const p = await gov.propose({ proposer: "lp-harbor.testnet", description: "Raise coverage to 1.25x", action: { type: "set_coverage_multiplier", multiplier_bps: 12_500 } });
    await gov.vote({ id: p.id, voter: "lp-harbor.testnet", support: "for" });
    await pool.transfer("lp-harbor.testnet", "friend.testnet", W(50));
    await expect(gov.vote({ id: p.id, voter: "friend.testnet", support: "for" })).rejects.toThrow(/held no WARD/);
    await expect(gov.vote({ id: p.id, voter: "lp-harbor.testnet", support: "for" })).rejects.toThrow(/already voted/);
    const view = (await gov.getProposal(p.id))!;
    expect(view.votes_for).toBe(W(50));
    expect(view.voters).toBe(1);
  });

  it("needs quorum: one small vote when the window closes is rejected", async () => {
    const seed = defaultSimSeed();
    seed.pool.positions.push({ account: "small.testnet", amount: W(10) });
    const { gov } = chain(seed);
    const p = await gov.propose({ proposer: "small.testnet", description: "Raise the Bronze fee to 2.50%", action: { type: "set_fee_bps", tier: "bronze", fee_bps: 250 } });
    expect(p.quorum).toBe(W(26)); // 20% of 130 WARD
    await gov.vote({ id: p.id, voter: "small.testnet", support: "for" });
    expect((await gov.getProposal(p.id))!.status).toBe("open");
    nowMs = START + 3 * DAY + 1;
    expect((await gov.getProposal(p.id))!.status).toBe("rejected");
    await expect(gov.execute(p.id)).rejects.toThrow(/Only a passed proposal/);
  });

  it("passes with quorum and more for than against when the window closes", async () => {
    const { gov } = chain();
    const p = await gov.propose({ proposer: "lp-harbor.testnet", description: "Lower the Silver fee to 1.25%", action: { type: "set_fee_bps", tier: "silver", fee_bps: 125 } });
    await gov.vote({ id: p.id, voter: "lp-harbor.testnet", support: "for" });
    await expect(gov.execute(p.id)).rejects.toThrow(/Only a passed proposal/);
    nowMs = START + 3 * DAY + 1;
    expect((await gov.getProposal(p.id))!.status).toBe("passed");
  });

  it("passes early with a majority of the snapshot, executes once, and the change takes effect", async () => {
    const { c, gov } = chain();
    const p = await gov.propose({ proposer: "lp-north.testnet", description: "Lower the Bronze fee to 1.75%", action: { type: "set_fee_bps", tier: "bronze", fee_bps: 175 } });
    await gov.vote({ id: p.id, voter: "lp-north.testnet", support: "for" }); // 70 of 120
    expect((await gov.getProposal(p.id))!.status).toBe("passed");
    await expect(gov.vote({ id: p.id, voter: "lp-harbor.testnet", support: "against" })).rejects.toThrow(/closed/);
    const done = await gov.execute(p.id);
    expect(done).toMatchObject({ status: "executed" });
    expect(done.tx).toMatch(/^sim-execute-/);
    await expect(gov.execute(p.id)).rejects.toThrow(/already executed/);
    expect((await c.reputation.getReputation(GROUP_BUDGET))!.fee_bps).toBe(175);
  });

  it("uncovering a model by vote makes the registry refuse its signer", async () => {
    const { c, gov } = chain();
    const deepseek = recordedModels().find((m) => m.model_id.startsWith("deepseek"))!;
    expect(await c.registry.isAttested(deepseek.model_id, deepseek.signing_address)).toBe(true);
    const p = await gov.propose({ proposer: "lp-north.testnet", description: "Stop covering DeepSeek V4.1 Flash", action: { type: "uncover_model", model_id: deepseek.model_id } });
    await gov.vote({ id: p.id, voter: "lp-north.testnet", support: "for" });
    await gov.execute(p.id);
    expect(await c.registry.isAttested(deepseek.model_id, deepseek.signing_address)).toBe(false);
  });

  it("only WARD holders can propose", async () => {
    const { gov } = chain();
    await expect(gov.propose({ proposer: "nobody.testnet", description: "Raise coverage", action: { type: "set_coverage_multiplier", multiplier_bps: 20_000 } })).rejects.toThrow(/Only WARD holders/);
  });
});

describe("reputation tiers (sim)", () => {
  it("get_reputation answers tier, history, fee_bps and coverage_cap", async () => {
    const { c } = chain();
    expect(await c.reputation.getReputation(GROUP_BUDGET)).toMatchObject({ tier: "bronze", proven_calls: 0, refused_calls: 0, claims: 0, fee_bps: 200, coverage_cap: W(25), next_tier_at: 10 });
    expect(await c.reputation.getReputation("bgt_nope")).toBeNull();
    const { rules } = await c.reputation.tierRules();
    expect(rules.map((r) => [r.tier, r.fee_bps])).toEqual([["bronze", 200], ["silver", 150], ["gold", 100]]);
  });

  it("moves up after 10 clean proven calls, down one tier on a paid claim; refused calls do not move it", async () => {
    const seed = defaultSimSeed();
    seed.reputation = { [GROUP_BUDGET]: { tier: "silver", clean_calls: 24 } };
    const { c, pool } = chain(seed);
    const rep = c.reputation as import("../src/chain/index.js").SimReputation;
    rep.recordRefused(GROUP_BUDGET);
    expect((await c.reputation.getReputation(GROUP_BUDGET))!.tier).toBe("silver");
    rep.recordProven(GROUP_BUDGET, 1_000_000n, 15_000n);
    expect(await c.reputation.getReputation(GROUP_BUDGET)).toMatchObject({ tier: "gold", fee_bps: 100, coverage_cap: W(100), clean_calls: 0, next_tier_at: null });
    const claim = await pool.fileClaim({ subject: "rcpt_x", claimant: "dao", amount: W(5), reason: "wrong PAY", budget_id: GROUP_BUDGET });
    expect(claim.status).toBe("paid");
    expect(await c.reputation.getReputation(GROUP_BUDGET)).toMatchObject({ tier: "silver", claims: 1, clean_calls: 0, refused_calls: 1 });
  });

  it("a claim above the group's coverage cap waits for a WARD vote, which pays it", async () => {
    const { c, pool, gov } = chain();
    const claim = await pool.fileClaim({ subject: "rcpt_big", claimant: "dao", amount: W(26), reason: "wrong PAY", budget_id: GROUP_BUDGET });
    expect(claim.status).toBe("pending_vote");
    const [p] = await gov.listProposals();
    expect(p!.action).toEqual({ type: "approve_payout", claim_id: claim.claim_id });
    await gov.vote({ id: p!.id, voter: "lp-north.testnet", support: "for" });
    await gov.execute(p!.id);
    const paid = (await c.pool.listClaims()).find((x) => x.claim_id === claim.claim_id)!;
    expect(paid).toMatchObject({ status: "paid", paid_from_junior: W(20), paid_from_senior: W(6) });
    expect((await c.reputation.getReputation(GROUP_BUDGET))!.claims).toBe(1);
  });
});

describe("demo meter key is opt-in and local only", () => {
  it("is off unless WARDLINE_DEMO_METER_KEY is set", () => {
    expect(demoMeterKeyFromEnv({}, "sim")).toBeNull();
    expect(demoMeterKeyFromEnv({ WARDLINE_DEMO_METER_KEY: "wk_demo_alice_key" }, "sim")).toBe("wk_demo_alice_key");
  });
  it("is refused in near mode, on a public bind and in production", () => {
    const key = { WARDLINE_DEMO_METER_KEY: "wk_demo_alice_key" };
    expect(() => demoMeterKeyFromEnv(key, "near")).toThrow(/sim mode only/);
    expect(() => demoMeterKeyFromEnv({ ...key, WARDLINE_BIND_PUBLIC: "true" }, "sim")).toThrow(/WARDLINE_BIND_PUBLIC/);
    expect(() => demoMeterKeyFromEnv({ ...key, NODE_ENV: "production" }, "sim")).toThrow(/production/);
  });
  it("printed seed keys follow the same rules", () => {
    expect(seedMeterKeysFromEnv({}, "sim")).toBe(false);
    expect(seedMeterKeysFromEnv({ WARDLINE_SEED_METER_KEYS: "true" }, "sim")).toBe(true);
    expect(() => seedMeterKeysFromEnv({ WARDLINE_SEED_METER_KEYS: "true", NODE_ENV: "production" }, "sim")).toThrow(/production/);
    expect(() => seedMeterKeysFromEnv({ WARDLINE_SEED_METER_KEYS: "true" }, "near")).toThrow(/sim mode only/);
  });
});

describe("Mutual routes", () => {
  const holder = (() => {
    const secret = ed25519.utils.randomSecretKey();
    return { account: "voter.testnet", secret, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
  })();
  const lookupKeys: NearKeyLookup = async (_n, accountId) => (accountId === holder.account ? [{ publicKey: holder.publicKey, fullAccess: true }] : []);
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const clock = () => BigInt(nowMs) * 1_000_000n;

  function setup(live = true) {
    nowMs = START;
    const deps = bootstrap(":memory:", clock, { lookupKeys }, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "sim" }, ...(live ? {} : { chain: createChain("sim", toDateClock(clock), defaultSimSeed()) }) });
    const app = createApp(deps);
    const signed = async (body: Record<string, unknown>) => {
      const ch = (await (await app.request("/v1/pool/challenge", post({ account: holder.account, ...body }))).json()) as { message: string; nonce: string; recipient: string };
      const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), holder.secret, ch.recipient);
      return app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: holder.publicKey, signature }));
    };
    return { app, deps, signed };
  }

  it("GET /v1/mutual: live stats, a leaderboard safest first, tiers and proposals", async () => {
    const { app } = setup();
    const m = (await (await app.request("/v1/mutual")).json()) as {
      mutual_mode: string;
      stats: { total_pooled: string; ward_price: string; yield_earned: string; groups_covered: number; proven_payments: number; payouts: number };
      groups: { budget_id: string; tier: string; claims: number }[];
      governance: { quorum_bps: number; proposals: { status: string }[] };
    };
    expect(m.mutual_mode).toBe("sim");
    expect(m.stats.groups_covered).toBe(4);
    expect(m.stats.payouts).toBe(1);
    expect(BigInt(m.stats.ward_price)).toBeGreaterThan(1_000_000n);
    expect(m.groups[0]).toMatchObject({ budget_id: "bgt_mission", tier: "gold", claims: 0 });
    expect(m.groups.find((g) => g.budget_id === "bgt_kelp")).toMatchObject({ tier: "bronze", claims: 1 });
    expect(m.governance.proposals.map((p) => p.status).sort()).toEqual(["executed", "open", "passed", "rejected"]);
    const rep = (await (await app.request("/v1/reputation/bgt_nightshade")).json()) as { tier: string; fee_bps: number };
    expect(rep).toMatchObject({ tier: "silver", fee_bps: 150 });
    expect((await app.request("/v1/reputation/bgt_nope")).status).toBe(404);
  });

  it("a wallet-signed deposit, then propose and vote with the wallet; anyone executes, once", async () => {
    const { app, signed } = setup(false);
    expect((await signed({ action: "deposit", amount: W(150) })).status).toBe(200);
    const proposed = (await (await signed({ action: "propose", description: "Lower the Gold fee to 0.75%", proposal: { type: "set_fee_bps", tier: "gold", fee_bps: 75 } })).json()) as { proposal: { id: number; status: string } };
    expect(proposed.proposal.status).toBe("open");
    const id = proposed.proposal.id;
    const weight = (await (await app.request(`/v1/mutual/proposals/${id}/weight/${holder.account}`)).json()) as { weight: string };
    expect(weight.weight).toBe(W(150));
    const voted = (await (await signed({ action: "vote", id, support: "for" })).json()) as { proposal: { status: string; votes_for: string } };
    expect(voted.proposal).toMatchObject({ status: "passed", votes_for: W(150) });
    expect((await signed({ action: "vote", id, support: "for" })).status).toBe(409);
    expect((await app.request(`/v1/mutual/proposals/${id}/execute`, post({}))).status).toBe(200);
    expect((await app.request(`/v1/mutual/proposals/${id}/execute`, post({}))).status).toBe(409);
    expect((await app.request(`/v1/mutual/proposals/99/execute`, post({}))).status).toBe(404);
    const groups = (await (await app.request("/v1/groups")).json()) as { tiers: { rules: { tier: string; fee_bps: number }[] } };
    expect(groups.tiers.rules.find((r) => r.tier === "gold")!.fee_bps).toBe(75);
  });

  it("refuses a proposal with an out-of-range value before anyone signs", async () => {
    const { app } = setup(false);
    const res = await app.request("/v1/pool/challenge", post({ account: holder.account, action: "propose", description: "Make fees huge", proposal: { type: "set_fee_bps", tier: "gold", fee_bps: 5_000 } }));
    expect(res.status).toBe(400);
  });
});

describe("near mode wiring", () => {
  it("reads contract ids from repo.config.json, and tiers and voting from the contracts (T4.6)", async () => {
    const c = createChain("near", now);
    expect(c.mode).toBe("near");
    expect((c.meter as unknown as { contractId: string }).contractId).toBe("meter.wardline-labs.testnet");
    expect((c.pool as unknown as { contractId: string }).contractId).toBe("pool.wardline-labs.testnet");
    expect((c.registry as unknown as { contractId: string }).contractId).toBe("model-registry.wardline-labs.testnet");
    expect(c.reputation.mode).toBe("near");
    expect(c.governance.mode).toBe("near");
    // The API never casts a vote for a holder on testnet; their wallet signs it against the pool.
    await expect(c.governance.vote({ id: 0, voter: "lp-north.testnet", support: "for" })).rejects.toThrow(/own wallet/);
  });
});

describe("below the line counts and the proofs feed", () => {
  it("a reservation stopped at an allowance or the deposit counts as capped for the group", async () => {
    const { c } = chain();
    const r = await c.meter.reserve({ budget_id: GROUP_BUDGET, member: "alice.testnet", call_id: "call_big", model_id: "m", max_amount: W(6) });
    expect(r.ok).toBe(false);
    expect((await c.reputation.getReputation(GROUP_BUDGET))!.capped_calls).toBe(1);
  });

  it("GET /v1/mutual counts swapped, look-alike and capped, and GET /v1/proofs lists calls without members or keys", async () => {
    nowMs = START;
    const deps = bootstrap(":memory:", () => BigInt(nowMs) * 1_000_000n, {}, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "sim" } });
    const app = createApp(deps);
    const m = (await (await app.request("/v1/mutual")).json()) as { stats: { below: { swapped: number; lookalike: number; capped: number; total: number } } };
    // Seeded history (15 refused, 3 blocked, 83 capped) plus the look-alike payout awaiting a vote in the group's DAO.
    expect(m.stats.below).toEqual({ swapped: 15, lookalike: 4, capped: 83, total: 102 });
    // With no real calls yet, sim mode shows the live seed's groups' recent calls, so the feed is never empty.
    const seeded = (await (await app.request("/v1/proofs")).json()) as { proofs: { call_id: string; group: string; side: string; created_at: string }[] };
    expect(seeded.proofs.length).toBeGreaterThan(0);
    expect(seeded.proofs.every((p) => p.call_id.startsWith("call_sim_seed_"))).toBe(true);
    expect(new Set(seeded.proofs.map((p) => p.side))).toEqual(new Set(["above", "below"]));
    expect(seeded.proofs[0]!.group).toBe("Mission Street hacker house");
    expect(Date.parse(seeded.proofs[0]!.created_at)).toBeLessThan(START);
    expect((await (await app.request("/v1/proofs?limit=2")).json()).proofs).toHaveLength(2);
  });
});

describe("member view data and refusal codes", () => {
  const holder = (() => {
    const secret = ed25519.utils.randomSecretKey();
    return { account: "member.testnet", secret, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
  })();
  const lookupKeys: NearKeyLookup = async (_n, accountId) => (accountId === holder.account ? [{ publicKey: holder.publicKey, fullAccess: true }] : []);
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  function setup() {
    nowMs = START;
    const clock = () => BigInt(nowMs) * 1_000_000n;
    const deps = bootstrap(":memory:", clock, { lookupKeys }, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "sim" }, chain: createChain("sim", toDateClock(clock), defaultSimSeed()) });
    const app = createApp(deps);
    const signed = async (body: Record<string, unknown>) => {
      const ch = (await (await app.request("/v1/pool/challenge", post({ account: holder.account, ...body }))).json()) as { message: string; nonce: string; recipient: string };
      const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), holder.secret, ch.recipient);
      return app.request("/v1/pool/submit", post({ nonce: ch.nonce, publicKey: holder.publicKey, signature }));
    };
    return { app, signed };
  }

  it("a position knows what the member put in, took out and when they joined", async () => {
    const { app, signed } = setup();
    expect((await signed({ action: "deposit", amount: W(30) })).status).toBe(200);
    const pos = (await (await app.request(`/v1/pool/positions/${holder.account}`)).json()) as { deposited: string; redeemed: string; joined_at: string };
    expect(pos).toMatchObject({ deposited: W(30), redeemed: "0" });
    expect(Date.parse(pos.joined_at)).toBe(START);
  });

  it("lists how an account voted, and refuses a bad account id", async () => {
    const { app, signed } = setup();
    await signed({ action: "deposit", amount: W(200) });
    const p = (await (await signed({ action: "propose", description: "Lower the Gold fee to 0.75%", proposal: { type: "set_fee_bps", tier: "gold", fee_bps: 75 } })).json()) as { proposal: { id: number } };
    await signed({ action: "vote", id: p.proposal.id, support: "for" });
    const votes = (await (await app.request(`/v1/mutual/votes/${holder.account}`)).json()) as { votes: { id: number; support: string; weight: string }[] };
    expect(votes.votes).toEqual([{ id: p.proposal.id, support: "for", weight: W(200) }]);
    expect((await app.request("/v1/mutual/votes/NOT%20AN%20ACCOUNT")).status).toBe(400);
  });

  it("refuses a deposit below 1 USDC before anyone signs, with BELOW_MINIMUM", async () => {
    const { app } = setup();
    const res = await app.request("/v1/pool/challenge", post({ account: holder.account, action: "deposit", amount: "999999" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "BELOW_MINIMUM", min: "1000000" });
    expect(((await (await app.request("/v1/mutual")).json()) as { min_deposit: string }).min_deposit).toBe("1000000");
  });

  it("answers COOLDOWN for an early redeem and VOTING_CLOSED for a late vote", async () => {
    const { signed } = setup();
    await signed({ action: "deposit", amount: W(10) });
    const lock = (await (await signed({ action: "withdraw", amount: W(5) })).json()) as { id: string };
    const early = await signed({ action: "redeem", id: lock.id });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: "COOLDOWN" });
    const p = (await (await signed({ action: "propose", description: "Raise coverage to 1.25x", proposal: { type: "set_coverage_multiplier", multiplier_bps: 12_500 } })).json()) as { proposal: { id: number } };
    nowMs = START + 4 * DAY;
    const late = await signed({ action: "vote", id: p.proposal.id, support: "for" });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "VOTING_CLOSED" });
  });

  it("answers 503 CHAIN_UNAVAILABLE when the chain RPC fails, and a plain 500 otherwise", async () => {
    nowMs = START;
    const chain = createChain("sim", now, defaultSimSeed());
    let fail: Error = new TypeError("fetch failed");
    chain.pool.getPool = async () => {
      throw fail;
    };
    const app = createApp(bootstrap(":memory:", () => BigInt(nowMs) * 1_000_000n, {}, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "sim" }, chain }));
    const down = await app.request("/v1/pool");
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ error: "CHAIN_UNAVAILABLE" });
    fail = new Error("secret internal detail");
    const other = await app.request("/v1/pool");
    expect(other.status).toBe(500);
    const body = await other.json();
    expect(body).toMatchObject({ error: "INTERNAL" });
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });
});
