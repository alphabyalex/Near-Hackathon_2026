/**
 * A leaked member key, hammered in parallel. The meter must stop it at the member's allowance, and a
 * second leaked key at the budget's hard cap (its deposit).
 *
 *   pnpm demo:leaked-key                    offline: in-process gateway, sim chain, local test TEE
 *   WARDLINE_API_URL=http://127.0.0.1:8787 WARDLINE_METER_KEY=wk_... pnpm demo:leaked-key
 *                                           against a running API (one key, sim-echo model)
 * Never calls NEAR AI.
 */

import { createSimTee, demoBaseUrl, demoFetch, SIM_MODEL } from "@wardline/demo-provider";
import { readEnv } from "@wardline/sdk";
import { createApp } from "../services/api/src/app.js";
import { bootstrap } from "../services/api/src/bootstrap.js";
import { createChain, defaultSimSeed, GROUP_BUDGET, GROUP_DAO } from "../services/api/src/chain/index.js";
import { systemClock, toDateClock } from "../services/api/src/time.js";

const PARALLEL = Number(process.env.LEAK_PARALLEL ?? 40);
const usdc = (atomic: string | bigint) => (Number(BigInt(atomic)) / 1e6).toFixed(2);

type Send = (key: string, i: number) => Promise<{ status: number; code: string | null; amount: string }>;

async function burst(label: string, key: string, send: Send) {
  const results = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => send(key, i)));
  const paid = results.filter((r) => r.status === 200);
  const refused = results.filter((r) => r.status === 402);
  const spent = paid.reduce((n, r) => n + BigInt(r.amount), 0n);
  const codes = [...new Set(refused.map((r) => r.code))].join(", ") || "none";
  console.log(`${label}: ${PARALLEL} parallel requests, ${paid.length} paid, ${refused.length} refused with 402 (${codes}), spent ${usdc(spent)} USDC`);
  return { spent, refused: refused.length };
}

async function remote(apiUrl: string, key: string) {
  const send: Send = async (k, i) => {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/ai/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, body: JSON.stringify({ model: SIM_MODEL, messages: [{ role: "user", content: `leaked ${i}` }] }) });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    return { status: res.status, code: body.error?.code ?? null, amount: res.headers.get("x-wardline-amount") ?? "0" };
  };
  const r = await burst("Leaked key", key, send);
  console.log(`spent ${usdc(r.spent)} USDC, ${r.refused} requests refused`);
}

async function offline() {
  const seed = defaultSimSeed();
  seed.budgets = [{ budget_id: GROUP_BUDGET, name: "Aurora Lab shared AI budget", owner: GROUP_DAO, deposit: "15000000", period: "week", members: [{ member: "ci-agent.testnet", allowance: "10000000" }, { member: "bob.testnet", allowance: "10000000" }] }];
  const deps = bootstrap(":memory:", systemClock, {}, undefined, {
    env: { WARDLINE_CHAIN_MODE: "sim" },
    chain: createChain("sim", toDateClock(systemClock), seed),
    routes: { providers: [{ id: "simtee", baseUrl: demoBaseUrl("simtee"), payTo: "sim-provider.testnet" }], models: [{ id: SIM_MODEL, provider: "simtee", label: "Sim Echo", inputPerM: 0, outputPerM: 0, perCall: 500_000, defaultMaxTokens: 256 }] },
    fetch: demoFetch({ simtee: createSimTee() }),
    gateway: { signatureDelaysMs: [0], ratePerMinute: 10_000 },
  });
  const app = createApp(deps);
  const send: Send = async (key, i) => {
    const res = await app.request("/v1/ai/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: SIM_MODEL, messages: [{ role: "user", content: `leaked ${i}` }] }) });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    return { status: res.status, code: body.error?.code ?? null, amount: res.headers.get("x-wardline-amount") ?? "0" };
  };
  const key = (member: string) => deps.ai.meter.createKey({ budgetId: GROUP_BUDGET, member, label: "leaked", models: null, createdBy: GROUP_DAO, now: new Date() }).key;
  console.log(`Budget: ${usdc(seed.budgets[0]!.deposit)} USDC deposit (the hard cap). Each member: ${usdc("10000000")} USDC allowance. Each call: ${usdc("500000")} USDC.\n`);
  const a = await burst("Leaked key 1 (ci-agent.testnet)", key("ci-agent.testnet"), send);
  const b = await burst("Leaked key 2 (bob.testnet)     ", key("bob.testnet"), send);
  const budget = (await deps.ai.chain.meter.getBudget(GROUP_BUDGET))!;
  console.log(`\nspent ${usdc(budget.spent)} of ${usdc(budget.deposit)} USDC, ${a.refused + b.refused} requests refused`);
  if (budget.spent !== budget.deposit || BigInt(budget.spent) > BigInt(budget.deposit)) process.exitCode = 1;
}

const apiUrl = readEnv("WARDLINE_API_URL");
const meterKey = readEnv("WARDLINE_METER_KEY");
if (apiUrl && meterKey) await remote(apiUrl, meterKey);
else await offline();
