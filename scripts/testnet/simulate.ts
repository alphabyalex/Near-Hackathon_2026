/**
 * One batch of testnet activity. Each event either ends in a NEAR testnet transaction, whose row is
 * built from RPC by ActivityWriter, or it is skipped with a note and leaves no row.
 *
 *   pnpm testnet:batch --dry-run      prints the plan. No transactions, no NEAR AI calls, no files.
 *   pnpm testnet:batch                runs it (needs the keys listed by preflight below).
 *   pnpm testnet:batch --calls 30     sets the number of paid calls instead of the time-of-day size.
 *
 * Events:
 *   paid calls     live NEAR AI calls (DeepSeek V4.1 Flash, max_tokens 150) through the Wardline gateway,
 *                  run in-process in near mode: reserve, call, TEE proof check, settle on the meter.
 *   swapped model  a real reserve, the SDK's verifier on the recorded GLM-5.3 Flash response passed off
 *                  as DeepSeek (fixtures/nearai/glm53flash-cheap.json, no live call), a real release.
 *   leaked key     three reserves for a compromised member, each refused at the spend limit.
 *   LP deposits    ft_transfer_call of USDC to the pool from the LP's own account.
 *   WARD vote      a WARD holder votes on an open proposal from their own account.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { makeProvider, makeSigner, NearModelRegistryClient, viewCall, type SignerHandle } from "@wardline/vault-client";
import { verifyProviderProof, type ProviderSignature } from "@wardline/sdk";
import { CredentialStore, defaultSecretsDir } from "../contracts/src/lib.js";
import { ActivityWriter, addSpend, sendCall as callFinal, DRY_RUN, HARD_CAP, loadDotEnv, loadSpend, REPO_ROOT, RPC_URL, saveSpend, type SpendLedger } from "./chain-log.js";
import type { RowFields } from "../../services/api/src/activity/log.js";

const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const CHEAP_MODEL = "z-ai/glm-5.3-flash";
const MAX_TOKENS = 150;
const GAS = 100_000_000_000_000n;

const TASKS = [
  "Summarize this git commit in one line: fix null pointer in token transfer callback.",
  "Write a PostgreSQL query for users who joined in the last 7 days.",
  "Classify this support ticket in one word: 'Cannot connect my NEAR wallet'.",
  "Explain what an ERC-4337 paymaster does in two sentences.",
  "Write a TypeScript interface for a JSON-RPC 2.0 response.",
  "Format 2026-11-09T14:03:00Z as a readable UTC date.",
  "Write a regex that matches a NEAR testnet account id.",
  "Explain optimistic rollups versus ZK rollups in two sentences.",
  "Turn this error into a plain-English hint: ECONNRESET on POST /v1/ai.",
  "Write a Python function for a 7-day moving average.",
  "Suggest 3 test cases for an NEP-141 storage deposit.",
  "Write a CSS rule that clips one line of text with an ellipsis.",
  "Write a shell one-liner to list JSON files changed in the last day.",
  "Draft a two-line onboarding note for a new hacker house member.",
  "Write a SQL query for daily fees per budget.",
  "Summarize the invariants of a constant-product AMM in three bullets.",
  "Write a TypeScript function that parses a CAIP-10 account id.",
  "Write a unit test asserting an allowance cannot be exceeded.",
  "Explain NEP-413 message signing in two sentences.",
  "Draft a polite note declining an invoice from an unverified payee.",
];

/** Proposals the batch opens when none is open. Each is a real change the pool can execute. */
const PROPOSALS = [
  { description: "Lower the Silver fee to 1.25%", action: { type: "set_fee_bps", tier: "silver", fee_bps: 125 } },
  { description: "Raise coverage to 1.25x for every tier", action: { type: "set_coverage_multiplier", multiplier_bps: 12_500 } },
  { description: "Raise the Bronze fee to 2.50%", action: { type: "set_fee_bps", tier: "bronze", fee_bps: 250 } },
] as const;

interface Cast {
  contracts: { usdc: string; meter: string; pool: string; model_registry: string };
  communities: Array<{ id: string; name: string; members: Array<{ account: string; name: string; leaked_key?: boolean }> }>;
  individuals: Array<{ account: string; name: string; budget: string }>;
  liquidity_providers: Array<{ account: string; name: string; deposit_usdc: string }>;
}

interface Caller {
  account: string;
  name: string;
  budget: string;
  group: string;
  leaked: boolean;
}

const short = (account: string) => account.replace(/\.wardline-labs\.testnet$/, "");
const usdc = (atomic: string | bigint) => (Number(atomic) / 1e6).toFixed(2);

/** Paid calls per batch by UTC hour: busier in the US daytime, quiet overnight. */
export function sizeForHour(hourUtc: number, rand = Math.random): number {
  if (hourUtc >= 15 && hourUtc <= 23) return 8 + Math.floor(rand() * 5); // 8-12
  if (hourUtc >= 9 && hourUtc <= 14) return 5 + Math.floor(rand() * 3); // 5-7
  return 2 + Math.floor(rand() * 3); // 2-4
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function accountExists(provider: ReturnType<typeof makeProvider>, account: string): Promise<boolean> {
  try {
    await provider.query({ request_type: "view_account", account_id: account, finality: "final" } as never);
    return true;
  } catch {
    return false;
  }
}

export async function runBatch(opts: { dryRun?: boolean; calls?: number } = {}): Promise<void> {
  loadDotEnv();
  const dryRun = opts.dryRun ?? DRY_RUN;
  const cast = JSON.parse(readFileSync(join(REPO_ROOT, "scripts/testnet/cast.json"), "utf8")) as Cast;
  const provider = makeProvider(RPC_URL);
  const ledger = loadSpend();
  const requested = opts.calls ?? (argValue("--calls") ? Number(argValue("--calls")) : sizeForHour(new Date().getUTCHours()));
  const calls = Math.max(0, Math.min(requested, HARD_CAP - ledger.total_calls));

  console.log(`Wardline testnet batch (${dryRun ? "dry run: no transactions, no NEAR AI calls, no files" : "live"})`);
  console.log(`Live NEAR AI calls so far: ${ledger.total_calls} of ${HARD_CAP}. This batch: ${calls} paid call(s).`);

  // Only accounts that exist on chain take part. A cast member setup has not created is left out.
  const callers: Caller[] = [];
  for (const c of cast.communities) for (const m of c.members) callers.push({ account: m.account, name: m.name, budget: c.id, group: c.name, leaked: Boolean(m.leaked_key) });
  for (const i of cast.individuals) callers.push({ account: i.account, name: i.name, budget: i.budget, group: `${i.name} (solo)`, leaked: false });
  const live: Caller[] = [];
  for (const c of callers) if (await accountExists(provider, c.account)) live.push(c);
  const lps: Cast["liquidity_providers"] = [];
  for (const lp of cast.liquidity_providers) if (await accountExists(provider, lp.account)) lps.push(lp);
  const honest = live.filter((c) => !c.leaked);
  const leaked = live.filter((c) => c.leaked);
  console.log(`Cast on chain: ${live.length} of ${callers.length} members and individuals, ${lps.length} of ${cast.liquidity_providers.length} LPs.`);

  // Calls lean towards the tier story: Mission Street climbs to Gold (35 clean calls), Nightshade,
  // Hayes Valley and Aurora Lab to Silver (10). Each budget's members take turns within its share.
  const WEIGHT: Record<string, number> = { bgt_mission: 5, bgt_nightshade: 2, bgt_hayes: 2, bgt_aurora: 2, bgt_kelp: 1 };
  const byBudget = new Map<string, Caller[]>();
  for (const c of honest) byBudget.set(c.budget, [...(byBudget.get(c.budget) ?? []), c]);
  const rotation: Caller[] = [];
  const turns = new Map<string, number>();
  const pick = (budget: string) => {
    const list = byBudget.get(budget)!;
    const t = turns.get(budget) ?? 0;
    turns.set(budget, t + 1);
    return list[t % list.length]!;
  };
  const solos = [...byBudget.keys()].filter((b) => b.startsWith("bgt_ind_"));
  for (let round = 0; round < 4; round++) {
    for (const [budget, w] of Object.entries(WEIGHT)) if (byBudget.has(budget)) for (let k = 0; k < w; k++) rotation.push(pick(budget));
    if (solos.length) rotation.push(pick(solos[round % solos.length]!));
  }
  const plan = {
    paid: rotation.length ? Array.from({ length: calls }, (_, i) => ({ caller: rotation[(ledger.total_calls + i) % rotation.length]!, task: TASKS[(ledger.total_calls + i * 7) % TASKS.length]! })) : [],
    swapped: honest.length ? honest[(ledger.total_calls + 3) % honest.length]! : null,
    burst: leaked.length ? leaked[ledger.total_calls % leaked.length]! : null,
    deposits: lps.slice(0, 2).map((lp, i) => ({ lp, amount: BigInt(20_000 + 10_000 * ((ledger.total_calls + i) % 3)) })),
    vote: lps.length >= 2,
  };
  for (const p of plan.paid) console.log(`  paid call    ${short(p.caller.account)} on ${p.caller.budget}: "${p.task.slice(0, 48)}"`);
  console.log(plan.swapped ? `  swapped      ${short(plan.swapped.account)} on ${plan.swapped.budget}: GLM-5.3 Flash answer claimed as DeepSeek (recorded, no live call)` : "  swapped      skipped: no member on chain");
  console.log(plan.burst ? `  leaked key   ${short(plan.burst.account)} on ${plan.burst.budget}: 3 reserves against a spent allowance` : "  leaked key   skipped: no compromised member on chain");
  for (const d of plan.deposits) console.log(`  LP deposit   ${short(d.lp.account)}: ${usdc(d.amount)} USDC`);
  console.log(plan.vote ? "  WARD vote    an LP votes on an open proposal (one is opened if none is)" : "  WARD vote    skipped: fewer than two LPs on chain");
  if (dryRun) {
    console.log("\nDry run: nothing was sent and nothing under data/testnet/ changed.");
    return;
  }

  // Preflight: every key the live batch needs, before anything is sent. Values are never printed.
  const creds = new CredentialStore(join(defaultSecretsDir("testnet"), "credentials.json"));
  const gatewayAccount = process.env.WARDLINE_GATEWAY_ACCOUNT;
  const gatewayKey = process.env.WARDLINE_GATEWAY_KEY;
  const missing: string[] = [];
  if (!gatewayAccount || !gatewayKey) missing.push("WARDLINE_GATEWAY_ACCOUNT and WARDLINE_GATEWAY_KEY in .env");
  if (calls > 0 && !process.env.NEAR_AI_API_KEY) missing.push("NEAR_AI_API_KEY in .env");
  for (const d of plan.deposits) if (!creds.get(d.lp.account)) missing.push(`a key for ${d.lp.account} in the credential store`);
  if (missing.length) throw new Error(`Missing: ${missing.join("; ")}. Nothing was sent.`);
  const gateway = makeSigner(provider, gatewayAccount!, gatewayKey!);
  const writer = new ActivityWriter({ dryRun: false });
  let recorded = 0;
  const record = async (hash: string, signer: string, fields: RowFields) => {
    try {
      const row = await writer.record(hash, signer, fields);
      recorded++;
      console.log(`    recorded ${row.kind}:${row.outcome} at block ${row.block_height}  https://testnet.nearblocks.io/txns/${row.tx}`);
    } catch (error) {
      console.log(`    not recorded: ${(error as Error).message}`);
    }
  };

  await paidCalls(plan.paid, ledger, record);
  if (plan.swapped) await swappedModel(plan.swapped, cast, gateway, provider, record).catch((e: Error) => console.log(`    swapped model skipped: ${e.message}`));
  if (plan.burst) await leakedKeyBurst(plan.burst, cast, gateway, record).catch((e: Error) => console.log(`    leaked key skipped: ${e.message}`));
  for (const d of plan.deposits) await lpDeposit(d.lp, d.amount, cast, makeSigner(provider, d.lp.account, creds.get(d.lp.account)!), record).catch((e: Error) => console.log(`    deposit skipped: ${e.message}`));
  if (plan.vote) await wardVote(lps, cast, provider, creds, record).catch((e: Error) => console.log(`    vote skipped: ${e.message}`));

  console.log(`\nRecorded ${recorded} row(s). Live NEAR AI calls: ${ledger.total_calls} of ${HARD_CAP}.`);
  console.log(`  key 1: ${ledger.key_1_spend.calls} calls, ${ledger.key_1_spend.prompt_tokens}+${ledger.key_1_spend.completion_tokens} tokens, $${ledger.key_1_spend.cost_usd.toFixed(4)}`);
  console.log(`  key 2: ${ledger.key_2_spend.calls} calls, ${ledger.key_2_spend.prompt_tokens}+${ledger.key_2_spend.completion_tokens} tokens, $${ledger.key_2_spend.cost_usd.toFixed(4)}`);
  console.log("Run pnpm testnet:audit next. The API serves new rows only after it passes.");
}

type Record_ = (hash: string, signer: string, fields: RowFields) => Promise<void>;

/**
 * Key 1 until its remaining credit drops under 1 USD (NEAR_AI_KEY_1_CREDIT_USD, if set) or NEAR AI
 * refuses it for credit, then key 2. The switch is kept in the ledger.
 */
function activeKey(ledger: SpendLedger): "key_1" | "key_2" {
  const credit = Number(process.env.NEAR_AI_KEY_1_CREDIT_USD ?? "");
  if (ledger.current_key === "key_1" && Number.isFinite(credit) && credit > 0 && credit - ledger.key_1_spend.cost_usd < 1) ledger.current_key = "key_2";
  if (ledger.current_key === "key_2" && !process.env.NEAR_AI_API_KEY_2) throw new Error("Key 1 is spent and NEAR_AI_API_KEY_2 is not set.");
  return ledger.current_key;
}

async function paidCalls(plan: Array<{ caller: Caller; task: string }>, ledger: SpendLedger, record: Record_): Promise<void> {
  if (!plan.length) return;
  // The Wardline API itself, in near mode, in this process: the same gateway code a user's call takes.
  process.env.WARDLINE_CHAIN_MODE = "near";
  const { bootstrap } = await import("../../services/api/src/bootstrap.js");
  const { createApp } = await import("../../services/api/src/app.js");
  type CallUsage = { reserved: string; promptTokens: number | null; completionTokens: number | null } | null;
  const apps = new Map<string, { request: (path: string, init: RequestInit) => Promise<Response>; keyFor: (c: Caller) => string; call: (id: string) => CallUsage }>();
  const appFor = (key: "key_1" | "key_2") => {
    const cached = apps.get(key);
    if (cached) return cached;
    const env: Record<string, string | undefined> = { ...process.env, WARDLINE_CHAIN_MODE: "near", NEAR_AI_API_KEY: key === "key_1" ? process.env.NEAR_AI_API_KEY : process.env.NEAR_AI_API_KEY_2 };
    delete env.WARDLINE_DEMO_METER_KEY;
    delete env.WARDLINE_AI_PROVIDER_URL;
    const auth = { enabled: false, owners: new Set<string>(), approvers: new Set<string>(), sessionTtlMs: 30 * 60_000, secureCookie: false, network: "testnet" as const, keyCallsPerDay: 10_000 };
    const deps = bootstrap(":memory:", undefined, {}, auth, { env });
    const app = createApp(deps);
    const keys = new Map<string, string>();
    const made = {
      request: (path: string, init: RequestInit) => Promise.resolve(app.request(path, init)),
      call: (id: string) => deps.ai.meter.getCall(id),
      keyFor: (c: Caller) => {
        const id = `${c.budget}:${c.account}`;
        if (!keys.has(id)) keys.set(id, deps.ai.meter.createKey({ budgetId: c.budget, member: c.account, label: "testnet batch", models: [MODEL], createdBy: "testnet-batch", now: new Date() }).key);
        return keys.get(id)!;
      },
    };
    apps.set(key, made);
    return made;
  };

  for (const [i, p] of plan.entries()) {
    if (ledger.total_calls >= HARD_CAP) {
      console.log(`  hard cap of ${HARD_CAP} live calls reached; stopping.`);
      break;
    }
    const key = activeKey(ledger);
    const app = appFor(key);
    console.log(`  paid call ${i + 1}/${plan.length}: ${short(p.caller.account)} on ${p.caller.budget} (NEAR AI ${key.replace("_", " ")})`);
    const res = await app.request("/v1/ai/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${app.keyFor(p.caller)}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: p.task }], max_tokens: MAX_TOKENS, temperature: 0 }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    // A reserved call went to NEAR AI. Its cost is priced from the tokens NEAR AI reported, which the
    // gateway keeps on its call row even when the proof is refused.
    const row = app.call(res.headers.get("x-wardline-call") ?? "");
    if (row && row.reserved !== "0") {
      addSpend(ledger, key, { prompt_tokens: row.promptTokens ?? 0, completion_tokens: row.completionTokens ?? 0 }, new Date().toISOString());
      saveSpend(ledger, false);
    }
    if (/HTTP 40[12]/.test(body.error?.message ?? "") && key === "key_1") {
      console.log("    NEAR AI refused key 1; later calls use key 2.");
      ledger.current_key = "key_2";
      saveSpend(ledger, false);
    }
    const tx = res.headers.get("x-wardline-settlement");
    const proof = res.headers.get("x-wardline-proof");
    if (!tx) {
      console.log(`    HTTP ${res.status} ${body.error?.code ?? ""}: no transaction, no row. ${body.error?.message ?? ""}`.trimEnd());
      continue;
    }
    const amount = res.headers.get("x-wardline-amount") ?? "0";
    await record(tx, process.env.WARDLINE_GATEWAY_ACCOUNT!, proof === "verified"
      ? { actor: p.caller.account, community: p.caller.budget, kind: "call", amount, model: MODEL, outcome: "paid", side: "above", reason: null, text: `${p.caller.group}: proven and paid ${usdc(amount)} USDC` }
      : { actor: p.caller.account, community: p.caller.budget, kind: "call", amount: "0", model: MODEL, outcome: "refused", side: "below", reason: body.error?.code ?? null, text: `${p.caller.group}: refused (${body.error?.code ?? "no proof"}), hold released` });
  }
}

async function swappedModel(caller: Caller, cast: Cast, gateway: SignerHandle, provider: ReturnType<typeof makeProvider>, record: Record_): Promise<void> {
  console.log(`  swapped model: ${short(caller.account)} on ${caller.budget}`);
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/nearai/glm53flash-cheap.json"), "utf8")) as { request: { sha256: string }; response: { sha256: string }; signature: { status: number; body_b64: string } | null };
  if (!raw.signature || raw.signature.status !== 200) throw new Error("the GLM-5.3 Flash recording has no signature");
  const signature = JSON.parse(Buffer.from(raw.signature.body_b64, "base64").toString("utf8")) as ProviderSignature;
  const callId = `call_swap_${randomBytes(6).toString("hex")}`;
  const reserved = await callFinal(gateway, { contract_id: cast.contracts.meter, method: "reserve", args: { budget_id: caller.budget, member: caller.account, call_id: callId, model_id: MODEL, max_amount: "20000" }, gas: GAS });
  const r = reserved.value as { ok?: boolean; reason?: string };
  if (!r?.ok) throw new Error(`reserve refused (${r?.reason ?? "unknown"})`);
  const registry = new NearModelRegistryClient({ contractId: cast.contracts.model_registry, provider });
  const check = await verifyProviderProof({ model: MODEL, requestHash: raw.request.sha256, responseHash: raw.response.sha256, signature, isAttested: (m, s) => registry.isAttested(m, s) });
  if (check.ok) throw new Error("the verifier accepted the GLM answer as DeepSeek; refusing to log a refusal that did not happen");
  const released = await callFinal(gateway, { contract_id: cast.contracts.meter, method: "release", args: { call_id: callId, reason: check.problem }, gas: GAS });
  await record(released.tx_hash, gateway.account_id, { actor: caller.account, community: caller.budget, kind: "call", amount: "0", model: CHEAP_MODEL, outcome: "refused", side: "below", reason: check.problem, text: `${caller.group}: refused, claimed DeepSeek V4.1 Flash but signed by GLM-5.3 Flash's key; hold released` });
}

/**
 * A burst of reserves from a compromised member whose allowance setup left spent. Each refused reserve
 * is a real transaction returning ALLOWANCE_EXHAUSTED. A reserve the meter accepts is released at once
 * (the meter counts every release as a refusal, so the burst stops there).
 */
async function leakedKeyBurst(caller: Caller, cast: Cast, gateway: SignerHandle, record: Record_): Promise<void> {
  console.log(`  leaked key: ${short(caller.account)} on ${caller.budget}`);
  for (let i = 0; i < 3; i++) {
    const callId = `call_burst_${randomBytes(6).toString("hex")}`;
    const out = await callFinal(gateway, { contract_id: cast.contracts.meter, method: "reserve", args: { budget_id: caller.budget, member: caller.account, call_id: callId, model_id: MODEL, max_amount: "20000" }, gas: GAS });
    const v = out.value as { ok?: boolean; reason?: string };
    if (v?.ok) {
      await callFinal(gateway, { contract_id: cast.contracts.meter, method: "release", args: { call_id: callId, reason: "LEAKED_KEY_BURST" }, gas: GAS });
      console.log("    the allowance still had room, so the reserve was released. Spend it down with set_allowance; no row.");
      return;
    }
    if (v?.reason !== "ALLOWANCE_EXHAUSTED" && v?.reason !== "BUDGET_EXHAUSTED") throw new Error(`reserve refused for another reason (${v?.reason ?? "unknown"})`);
    await record(out.tx_hash, gateway.account_id, { actor: caller.account, community: caller.budget, kind: "call", amount: "0", model: MODEL, outcome: "capped", side: "below", reason: v.reason, text: `${caller.group}: leaked-key call ${i + 1} of 3 stopped at the spend limit; nothing reached a model` });
  }
}

async function lpDeposit(lp: Cast["liquidity_providers"][number], amount: bigint, cast: Cast, signer: SignerHandle, record: Record_): Promise<void> {
  console.log(`  LP deposit: ${short(lp.account)} ${usdc(amount)} USDC`);
  const out = await callFinal(signer, { contract_id: cast.contracts.usdc, method: "ft_transfer_call", args: { receiver_id: cast.contracts.pool, amount: amount.toString(), msg: "" }, gas: GAS, deposit: 1n });
  // ft_transfer_call returns the amount the pool kept. Anything less is a refund, not a deposit.
  if (String(out.value) !== amount.toString()) throw new Error(`the pool kept ${String(out.value)} of ${amount}`);
  await record(out.tx_hash, lp.account, { actor: lp.account, community: "mutual", kind: "deposit", amount: amount.toString(), model: null, outcome: "paid", side: "above", reason: null, text: `${lp.name} deposited ${usdc(amount)} USDC and received WARD` });
}

async function wardVote(lps: Cast["liquidity_providers"], cast: Cast, provider: ReturnType<typeof makeProvider>, creds: CredentialStore, record: Record_): Promise<void> {
  type P = { id: number; description: string; status: string; executed_at?: string | null };
  const proposals = await viewCall<P[]>(provider, cast.contracts.pool, "list_proposals", {});
  // Only proposals the batch opens (PROPOSALS); others, like the browser check's, are left to their voters.
  const ours = (p: P) => PROPOSALS.some((q) => q.description === p.description);
  let open = proposals.filter((p) => p.status === "open" && ours(p));
  if (!open.length) {
    const proposer = lps.find((l) => creds.get(l.account));
    if (!proposer) throw new Error("no LP key to open a proposal");
    const next = PROPOSALS.find((p) => !proposals.some((q) => q.description === p.description)) ?? PROPOSALS[proposals.length % PROPOSALS.length]!;
    console.log(`  WARD proposal: ${short(proposer.account)} opens "${next.description}"`);
    const out = await callFinal(makeSigner(provider, proposer.account, creds.get(proposer.account)!), { contract_id: cast.contracts.pool, method: "propose", args: { description: next.description, action: next.action }, gas: GAS });
    await record(out.tx_hash, proposer.account, { actor: proposer.account, community: "mutual", kind: "proposal", amount: null, model: null, outcome: "opened", side: "above", reason: null, text: `${proposer.name} opened a WARD vote: ${next.description}` });
    open = (await viewCall<P[]>(provider, cast.contracts.pool, "list_proposals", {})).filter((p) => p.status === "open" && ours(p));
  }
  const target = open[open.length - 1];
  if (!target) throw new Error("no open proposal");
  // Every LP with WARD that has not voted votes. Once votes for it pass half the snapshot, it executes.
  let voted = 0;
  for (const lp of lps) {
    const key = creds.get(lp.account);
    if (!key) continue;
    const weight = await viewCall<string>(provider, cast.contracts.pool, "weight_of", { id: target.id, voter: lp.account });
    if (BigInt(weight || "0") === 0n) continue;
    console.log(`  WARD vote: ${short(lp.account)} votes for #${target.id}`);
    try {
      const out = await callFinal(makeSigner(provider, lp.account, key), { contract_id: cast.contracts.pool, method: "vote", args: { id: target.id, support: "for" }, gas: GAS });
      await record(out.tx_hash, lp.account, { actor: lp.account, community: "mutual", kind: "vote", amount: weight, model: null, outcome: "voted", side: "above", reason: null, text: `${lp.name} voted for: ${target.description}` });
      voted++;
    } catch (error) {
      if (!/Already voted/.test((error as Error).message)) throw error;
    }
  }
  if (!voted) console.log("    every LP with WARD has voted on the open proposal.");
  const now = (await viewCall<P[]>(provider, cast.contracts.pool, "list_proposals", {})).find((p) => p.id === target.id);
  if (now?.status === "passed") {
    const executor = lps.find((l) => creds.get(l.account))!;
    console.log(`  WARD proposal #${target.id} passed; ${short(executor.account)} executes it`);
    const out = await callFinal(makeSigner(provider, executor.account, creds.get(executor.account)!), { contract_id: cast.contracts.pool, method: "execute", args: { id: target.id }, gas: GAS });
    await record(out.tx_hash, executor.account, { actor: executor.account, community: "mutual", kind: "proposal", amount: null, model: null, outcome: "executed", side: "above", reason: null, text: `Passed and executed: ${target.description}` });
  } else {
    console.log(`    proposal #${target.id} is ${now?.status ?? "unknown"}.`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/testnet/simulate.ts")) {
  runBatch().catch((err: Error) => {
    console.error(`Batch failed: ${err.message}`);
    process.exit(1);
  });
}
