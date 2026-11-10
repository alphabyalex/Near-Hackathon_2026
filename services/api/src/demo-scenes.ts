/**
 * The seven demo scenes, in the order the story is told: the Mutual, a group plugging in, the three
 * proofs at work, a wrong approval paid back, and a clean group earning a lower fee. Each runs the
 * real code path (the meter gateway, the payee engine, the cover pool, reputation and the group's DAO)
 * in a fresh simulated world with the offline demo providers, so a scene can be replayed any number
 * of times and never calls NEAR AI or a chain.
 */

import Database from "better-sqlite3";
import { buildProposal, createSimDao, createSputnikClient } from "@wardline/dao-adapter";
import {
  createCheapAi,
  createReplayProvider,
  createSimTee,
  demoBaseUrl,
  demoFetch,
  loadRecording,
  RECORDED,
  SIM_MODEL,
} from "@wardline/demo-provider";
import { usdcAccount } from "@wardline/schemas";
import type { PayeeEngine, EngineContext } from "@wardline/sdk";
import { contractsFromEnv } from "./ai.js";
import { createChain, defaultSimSeed, GROUP_BUDGET, GROUP_DAO, liveSimSeed, mutualStats, type Chain, type SimChainSeed } from "./chain/index.js";
import { createMeterGateway, publicCall } from "./meter/gateway.js";
import type { RouteTable } from "./meter/models.js";
import { MeterStore } from "./meter/store.js";
import type { DateClock } from "./time.js";

export const SCENES = ["mutual", "group", "swap", "leak", "invoice", "payout", "tier"] as const;
export type SceneName = (typeof SCENES)[number];

const EXPENSIVE = loadRecording(RECORDED.expensive);
const CHEAP = loadRecording(RECORDED.cheap);

const W = (n: number) => String(Math.round(n * 1_000_000));

/** The hacker house in scene 2: a new group with an empty budget until its DAO votes to fund it. */
export const HOUSE = { budget_id: "bgt_hayes", name: "Hayes Valley house", owner: "hayes-house.sputnikv2.testnet" } as const;

function world(provider: "replay" | "cheapai", now: DateClock, seed: SimChainSeed = defaultSimSeed()) {
  const store = new MeterStore(new Database(":memory:"));
  const chain = createChain("sim", now, seed);
  const routes: RouteTable = {
    providers: [
      { id: "replay", baseUrl: demoBaseUrl("replay"), payTo: "nearai.testnet" },
      { id: "cheapai", baseUrl: demoBaseUrl("cheapai"), payTo: "cheapai.testnet" },
      { id: "simtee", baseUrl: demoBaseUrl("simtee"), payTo: "sim-provider.testnet" },
    ],
    models: [
      { id: EXPENSIVE.model, provider, label: "DeepSeek V4.1 Flash", inputPerM: 300_000, outputPerM: 1_200_000, defaultMaxTokens: 1024 },
      { id: CHEAP.model, provider: "replay", label: "GLM-5.3 Flash", inputPerM: 80_000, outputPerM: 500_000, defaultMaxTokens: 1024 },
      { id: SIM_MODEL, provider: "simtee", label: "Sim Echo (local test TEE)", inputPerM: 0, outputPerM: 0, perCall: 500_000, defaultMaxTokens: 256 },
    ],
  };
  const app = createMeterGateway({
    store,
    chain,
    routes,
    now,
    fetch: demoFetch({ replay: createReplayProvider(), cheapai: createCheapAi("wrong-model"), simtee: createSimTee() }),
    options: { signatureDelaysMs: [0, 0, 0], upstreamTimeoutMs: 5_000, ratePerMinute: 100_000 },
  });
  const key = (member: string, budgetId: string = GROUP_BUDGET) => store.createKey({ budgetId, member, label: "demo", models: null, createdBy: GROUP_DAO, now: now() }).key;
  const chat = async (k: string, body: unknown) => {
    const res = await app.request("/chat/completions", { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const callId = res.headers.get("x-wardline-call");
    const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message: string; code: string } } | null;
    return { status: res.status, proof: res.headers.get("x-wardline-proof"), call: callId ? store.getCall(callId) : null, json };
  };
  const echo = (k: string, i: number) => chat(k, { model: SIM_MODEL, messages: [{ role: "user", content: `eval ${i}` }] });
  return { store, chain, chat, echo, key };
}

const bodyOf = (rec: typeof EXPENSIVE) => JSON.parse(Buffer.from(rec.requestBytes).toString("utf8")) as Record<string, unknown>;
const excerpt = (text: string | undefined, n = 180) => (text ? (text.length > n ? `${text.slice(0, n).trimEnd()}...` : text) : null);
const price = async (chain: Chain) => (await chain.pool.getPool()).ward_price;

export interface SceneDeps {
  now: DateClock;
  engine: PayeeEngine;
  context: EngineContext;
}

export async function runScene(name: SceneName, deps: SceneDeps): Promise<Record<string, unknown>> {
  switch (name) {
    case "mutual": {
      // The Mutual as it stands, then an investor deposits USDC and receives WARD at today's price.
      const chain = createChain("sim", deps.now, liveSimSeed());
      const stats = await mutualStats(chain);
      const investor = "maya.testnet";
      const before = await chain.pool.getPool();
      const deposit = await chain.pool.deposit(investor, W(25));
      return { scene: name, stats, deposit: { account: investor, usdc: W(25), ward: deposit.ward, price: before.ward_price, tx: deposit.tx }, position: await chain.pool.getPosition(investor), pool: await chain.pool.getPool() };
    }
    case "group": {
      // A hacker house funds its shared AI budget by DAO vote, a member's app changes one line, and
      // every call is paid only on proof. 2% of each call flows to WARD holders.
      const seed = defaultSimSeed();
      seed.budgets.push({ ...HOUSE, deposit: "0", period: "week", members: [{ member: "jules.testnet", allowance: W(5) }, { member: "house-agent.testnet", allowance: W(10) }] });
      const w = world("replay", deps.now, seed);
      const contracts = { ...contractsFromEnv({}), token: usdcAccount({}) };
      const dao = createSimDao({ councilSize: 3 });
      const id = dao.propose("jules.testnet", buildProposal({ type: "fund_budget", budget_id: HOUSE.budget_id, amount: W(20) }, contracts, "This week's AI budget"), deps.now());
      dao.act(id, "jules.testnet", "VoteApprove");
      dao.act(id, "priya.testnet", "VoteApprove");
      const proposal = (await createSputnikClient({ dao: HOUSE.owner, contracts, provider: dao.provider }).getProposal(id))!;
      // An approved fund_budget proposal transfers USDC to the meter with {"action":"fund"}.
      const funded = proposal.status === "Approved" ? await w.chain.meter.fund(HOUSE.budget_id, W(20)) : null;
      const priceBefore = await price(w.chain);
      const member = w.key("jules.testnet", HOUSE.budget_id);
      const calls = [await w.chat(member, bodyOf(EXPENSIVE)), await w.chat(member, bodyOf(CHEAP))];
      const agent = w.key("house-agent.testnet", HOUSE.budget_id);
      const batch = [];
      for (let i = 0; i < 6; i++) batch.push(await w.echo(agent, i));
      const pool = await w.chain.pool.getPool();
      return {
        scene: name,
        group: HOUSE,
        proposal: { id, description: proposal.description, status: proposal.status, approvals: proposal.approvals, fund_tx: funded?.tx ?? null },
        baseUrl: "<wardline>/v1/ai",
        calls: calls.map((c) => ({ status: c.status, proof: c.proof, call: c.call ? publicCall(c.call) : null, reply: excerpt(c.json?.choices?.[0]?.message?.content) })),
        batch: { member: "house-agent.testnet", sent: batch.length, proven: batch.filter((c) => c.proof === "verified").length, spent: batch.reduce((n, c) => n + BigInt(c.call?.amount ?? "0"), 0n).toString() },
        budget: await w.chain.meter.getBudget(HOUSE.budget_id),
        reputation: await w.chain.reputation.getReputation(HOUSE.budget_id),
        ward: { before: priceBefore, after: pool.ward_price, fees: pool.fees_earned },
      };
    }
    case "swap": {
      const w = world("cheapai", deps.now);
      const c = await w.chat(w.key("alice.testnet"), bodyOf(EXPENSIVE));
      return { scene: name, claimed: EXPENSIVE.model, status: c.status, proof: c.proof, error: c.json?.error ?? null, call: c.call ? publicCall(c.call) : null, budget: await w.chain.meter.getBudget(GROUP_BUDGET) };
    }
    case "leak": {
      const seed = defaultSimSeed();
      seed.budgets = [{ budget_id: GROUP_BUDGET, name: "Aurora Lab", owner: GROUP_DAO, deposit: W(15), period: "week", members: [{ member: "ci-agent.testnet", allowance: W(10) }, { member: "bob.testnet", allowance: W(10) }] }];
      const w = world("replay", deps.now, seed);
      const burst = async (member: string, n: number) => {
        const k = w.key(member);
        const results = await Promise.all(Array.from({ length: n }, (_, i) => w.chat(k, { model: SIM_MODEL, messages: [{ role: "user", content: `${member} request ${i}` }] })));
        const refused = results.filter((r) => r.status === 402);
        return { member, sent: n, paid: results.filter((r) => r.status === 200).length, refused: refused.length, reasons: [...new Set(refused.map((r) => r.json?.error?.code))] };
      };
      const leaked = await burst("ci-agent.testnet", 40);
      const second = await burst("bob.testnet", 40);
      const budget = (await w.chain.meter.getBudget(GROUP_BUDGET))!;
      return { scene: name, bursts: [leaked, second], budget, spent: budget.spent, cap: budget.deposit, refused: leaked.refused + second.refused };
    }
    case "invoice": {
      // A treasury payout proposal to a look-alike account. The payee check runs before anyone votes.
      const proposal = { id: 4, description: "Pay northwind.example invoice 55190. Their bank details changed, see email", receiver: "northw1nd.testnet", amount: W(9.5), dao: GROUP_DAO };
      const result = await deps.engine.check({ payee: "near:testnet:northw1nd.testnet", vendor: { domain: "northwind.example" } }, deps.context);
      return { scene: name, proposal, payee: "near:testnet:northw1nd.testnet", vendor: "northwind.example", result, flagged: result.verdict !== "PAY" };
    }
    case "payout": {
      // We're wrong once: Wardline's own stake pays and WARD does not move. A bigger one uses up the
      // stake and WARD dips. Then fees from the group's proven calls refill it.
      const seed = defaultSimSeed();
      seed.budgets[0] = { ...seed.budgets[0]!, deposit: W(60), members: [{ member: "ci-agent.testnet", allowance: W(60) }] };
      const w = world("replay", deps.now, seed);
      const before = await w.chain.pool.getPool();
      const first = await w.chain.pool.fileClaim({
        subject: "rcpt_brightwater_0412",
        claimant: GROUP_DAO,
        amount: W(8),
        reason: "Wardline answered PAY for brightwater-pay.testnet at domain linked. brightwater.example later reported its key was stolen before that answer.",
        budget_id: GROUP_BUDGET,
      });
      const middle = await w.chain.pool.getPool();
      const second = await w.chain.pool.fileClaim({
        subject: "rcpt_quarrylane_0419",
        claimant: GROUP_DAO,
        amount: W(12.5),
        reason: "Wardline approved quarrylanelegal.testnet after its cooldown. The firm's website had been taken over during the cooldown.",
        budget_id: GROUP_BUDGET,
      });
      const after = await w.chain.pool.getPool();
      // Proven calls until fees bring WARD back to its launch price.
      const agent = w.key("ci-agent.testnet");
      let calls = 0;
      let spent = 0n;
      while (BigInt(await price(w.chain)) < BigInt(before.launch_price) && calls < 200) {
        const c = await w.echo(agent, calls);
        calls++;
        spent += BigInt(c.call?.amount ?? "0");
      }
      const refilled = await w.chain.pool.getPool();
      return {
        scene: name,
        before,
        payouts: [
          { claim: first, pool: middle },
          { claim: second, pool: after },
        ],
        refill: { calls, spent: spent.toString(), fees: (BigInt(refilled.fees_earned) - BigInt(after.fees_earned)).toString(), ward_before: after.ward_price, ward_after: refilled.ward_price },
      };
    }
    case "tier": {
      // A clean group: ten proven calls in a row move it from Bronze to Silver, and its fee drops.
      const w = world("replay", deps.now);
      const agent = w.key("ci-agent.testnet");
      const before = (await w.chain.reputation.getReputation(GROUP_BUDGET))!;
      const fees: { n: number; tier: string; fee: string; fee_bps: number }[] = [];
      for (let i = 0; i < 11; i++) {
        const rep = (await w.chain.reputation.getReputation(GROUP_BUDGET))!;
        await w.echo(agent, i);
        const next = (await w.chain.reputation.getReputation(GROUP_BUDGET))!;
        fees.push({ n: i + 1, tier: rep.tier, fee: (BigInt(next.fees_paid) - BigInt(rep.fees_paid)).toString(), fee_bps: rep.fee_bps });
      }
      const after = (await w.chain.reputation.getReputation(GROUP_BUDGET))!;
      return { scene: name, group: { budget_id: GROUP_BUDGET, name: before.name }, before, after, first: fees[0], last: fees[fees.length - 1], calls: fees.length, tiers: await w.chain.reputation.tierRules() };
    }
  }
}
