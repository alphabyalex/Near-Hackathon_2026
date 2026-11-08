/**
 * The five demo scenes. Each runs the real code path (the meter gateway, the payee engine, the cover
 * pool) in a fresh simulated world with the offline demo providers, so a scene can be replayed any
 * number of times and never calls NEAR AI or a chain.
 */

import Database from "better-sqlite3";
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
import type { PayeeEngine, EngineContext } from "@wardline/sdk";
import { createChain, defaultSimSeed, GROUP_BUDGET, GROUP_DAO, type SimChainSeed } from "./chain/index.js";
import { createMeterGateway, publicCall } from "./meter/gateway.js";
import type { RouteTable } from "./meter/models.js";
import { MeterStore } from "./meter/store.js";
import type { DateClock } from "./time.js";

export const SCENES = ["plugin", "swap", "leak", "invoice", "mutual"] as const;
export type SceneName = (typeof SCENES)[number];

const EXPENSIVE = loadRecording(RECORDED.expensive);
const CHEAP = loadRecording(RECORDED.cheap);

const W = (n: number) => String(Math.round(n * 1_000_000));

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
    options: { signatureDelaysMs: [0, 0, 0], upstreamTimeoutMs: 5_000, ratePerMinute: 10_000 },
  });
  const key = (member: string) => store.createKey({ budgetId: GROUP_BUDGET, member, label: "demo", models: null, createdBy: GROUP_DAO, now: now() }).key;
  const chat = async (k: string, body: unknown) => {
    const res = await app.request("/chat/completions", { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const callId = res.headers.get("x-wardline-call");
    const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message: string; code: string } } | null;
    return { status: res.status, proof: res.headers.get("x-wardline-proof"), call: callId ? store.getCall(callId) : null, json };
  };
  return { store, chain, chat, key };
}

const bodyOf = (rec: typeof EXPENSIVE) => JSON.parse(Buffer.from(rec.requestBytes).toString("utf8")) as Record<string, unknown>;
const excerpt = (text: string | undefined, n = 180) => (text ? (text.length > n ? `${text.slice(0, n).trimEnd()}...` : text) : null);

export interface SceneDeps {
  now: DateClock;
  engine: PayeeEngine;
  context: EngineContext;
}

export async function runScene(name: SceneName, deps: SceneDeps): Promise<Record<string, unknown>> {
  switch (name) {
    case "plugin": {
      const w = world("replay", deps.now);
      const key = w.key("alice.testnet");
      const calls = [await w.chat(key, bodyOf(EXPENSIVE)), await w.chat(key, bodyOf(CHEAP))];
      return {
        scene: name,
        baseUrl: "<wardline>/v1/ai",
        calls: calls.map((c) => ({ status: c.status, proof: c.proof, call: c.call ? publicCall(c.call) : null, reply: excerpt(c.json?.choices?.[0]?.message?.content) })),
        budget: await w.chain.meter.getBudget(GROUP_BUDGET),
      };
    }
    case "swap": {
      const w = world("cheapai", deps.now);
      const c = await w.chat(w.key("alice.testnet"), bodyOf(EXPENSIVE));
      return { scene: name, claimed: EXPENSIVE.model, status: c.status, proof: c.proof, error: c.json?.error ?? null, call: c.call ? publicCall(c.call) : null, budget: await w.chain.meter.getBudget(GROUP_BUDGET) };
    }
    case "leak": {
      const seed = defaultSimSeed();
      seed.budgets = [{ budget_id: GROUP_BUDGET, name: "Aurora Lab shared AI budget", owner: GROUP_DAO, deposit: W(15), period: "week", members: [{ member: "ci-agent.testnet", allowance: W(10) }, { member: "bob.testnet", allowance: W(10) }] }];
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
      const result = await deps.engine.check({ payee: "near:testnet:northw1nd.testnet", vendor: { domain: "northwind.example" } }, deps.context);
      return { scene: name, payee: "near:testnet:northw1nd.testnet", vendor: "northwind.example", result };
    }
    case "mutual": {
      // Two wrong approvals. The first is absorbed by Wardline's own stake; WARD does not move. The
      // second uses up the rest of the stake, and WARD holders cover the remainder.
      const chain = createChain("sim", deps.now);
      const before = await chain.pool.getPool();
      const first = await chain.pool.fileClaim({
        subject: "rcpt_brightwater_0412",
        claimant: GROUP_DAO,
        amount: W(8),
        reason: "Wardline answered PAY for brightwater-pay.testnet at domain linked. brightwater.example later reported its key was stolen before that answer.",
      });
      const middle = await chain.pool.getPool();
      const second = await chain.pool.fileClaim({
        subject: "rcpt_quarrylane_0419",
        claimant: GROUP_DAO,
        amount: W(18),
        reason: "Wardline approved quarrylanelegal.testnet after its cooldown. The firm's website had been taken over during the cooldown.",
      });
      const after = await chain.pool.getPool();
      return { scene: name, before, payouts: [{ claim: first, pool: middle }, { claim: second, pool: after }] };
    }
  }
}
