/**
 * pnpm testnet:setup: creates and funds the testnet cast. Safe to run again: every step checks the chain
 * first and skips what is already done. Activity rows (DAO proposal and votes, budget funding, the
 * first-loss stake, LP deposits) go through ActivityWriter, so each is a transaction RPC confirmed.
 *
 *   pnpm testnet:setup --dry-run    prints what would happen. Sends nothing, writes nothing.
 *
 * The cast is a scaled-down slice of cast.json (see LIVE below), sized to what the root account can
 * pay for. One community, Mission Street, has a real Sputnik DAO (the same code as
 * dao.wardline-labs.testnet, about 5.4 NEAR of storage); the other four hold their treasury in a plain
 * account that the community's key signs from.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { actions, KeyPair, makeProvider, makeSigner, type KeyPairString, type SignerHandle } from "@wardline/vault-client";
import { makeRpc } from "../../services/api/src/activity/log.js";
import { CredentialStore, defaultSecretsDir } from "../contracts/src/lib.js";
import { ActivityWriter, DATA_DIR, DRY_RUN, loadDotEnv, RPC_URL, RPC_URLS } from "./chain-log.js";

const ROOT = "wardline-labs.testnet";
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const METER = "meter.wardline-labs.testnet";
const POOL = "pool.wardline-labs.testnet";
const SPUTNIK_SOURCE = "dao.wardline-labs.testnet";
const WRAP = "wrap.testnet";
const REF = "ref-finance-101.testnet";
const REF_POOL = 1845;
const DEEPSEEK = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

const NEAR = 10n ** 24n;
const milli = (n: number) => (BigInt(Math.round(n * 1000)) * NEAR) / 1000n;
const TGAS = 10n ** 12n;
const STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, the USDC and WARD storage minimum
const ROOT_KEEP = 3n * NEAR;

/** Who exists on chain, and what each holds. USDC in atomic units (6 decimals). */
export const LIVE = {
  communities: [
    { id: "bgt_mission", name: "Mission Street hacker house", treasury: "mission-dao.wardline-labs.testnet", dao: true, members: ["dana", "eli", "tariq"], council: ["dana", "eli"], fund: 250_000n },
    { id: "bgt_nightshade", name: "Nightshade DAO", treasury: "nightshade-dao.wardline-labs.testnet", dao: false, members: ["ruth", "priya"], council: ["ruth"], fund: 120_000n },
    { id: "bgt_hayes", name: "Hayes Valley house", treasury: "hayes-dao.wardline-labs.testnet", dao: false, members: ["sam", "owen"], council: ["sam"], fund: 120_000n },
    { id: "bgt_aurora", name: "Aurora Lab", treasury: "aurora-dao.wardline-labs.testnet", dao: false, members: ["alice", "ci-agent"], council: ["alice"], fund: 120_000n },
    { id: "bgt_kelp", name: "Kelp Collective", treasury: "kelp-dao.wardline-labs.testnet", dao: false, members: ["ana", "kelp-agent"], council: ["ana"], fund: 120_000n },
  ],
  individuals: ["ivan", "yuki", "hassan", "olivia", "lucas"].map((n) => ({ name: n, fund: 40_000n })),
  lps: [
    { name: "lp-north", hold: 300_000n, deposit: 100_000n },
    { name: "lp-harbor", hold: 250_000n, deposit: 100_000n },
    { name: "lp-solano", hold: 200_000n, deposit: 100_000n },
  ],
  /** USDC for the browser checks (Join, vote, redeem) from Dana's account. Join's minimum is 1.00 USDC. */
  browserMember: { name: "dana", hold: 1_050_000n },
  firstLoss: 200_000n,
  allowance: 40_000n,
  /** Tariq's key leaked: his allowance is cut to 0.001 USDC, below any burst reservation. */
  leakedAllowance: 1_000n,
  swapNear: 2n * NEAR,
};

const acct = (name: string) => (name.includes(".") ? name : `${name}.${ROOT}`);
const usd = (a: bigint) => (Number(a) / 1e6).toFixed(2);
const short = (a: string) => a.replace(`.${ROOT}`, "");
const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

type Community = (typeof LIVE.communities)[number];

interface Ctx {
  dryRun: boolean;
  provider: ReturnType<typeof makeProvider>;
  creds: CredentialStore;
  root: SignerHandle;
  writer: ActivityWriter;
  txs: Array<{ step: string; tx: string }>;
}

const rpc = makeRpc(RPC_URLS);

export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result as number[]).toString("utf8")) as T;
}

export async function balance(account: string): Promise<bigint | null> {
  try {
    const r = await rpc("query", { request_type: "view_account", finality: "final", account_id: account });
    return BigInt(r.amount);
  } catch {
    return null;
  }
}

function signer(ctx: Ctx, account: string): SignerHandle {
  const key = ctx.creds.get(account);
  if (!key) throw new Error(`no key for ${account} in the credential store`);
  return makeSigner(ctx.provider, account, key);
}

/** Sends a multi-action transaction and returns its hash. Throws if it failed. */
async function send(ctx: Ctx, from: SignerHandle, receiverId: string, acts: unknown[], step: string): Promise<string> {
  const out = (await from.account.signAndSendTransaction({ receiverId, actions: acts as never, waitUntil: "FINAL" })) as unknown as { transaction: { hash: string }; status: Record<string, unknown> };
  if ("Failure" in (out.status ?? {})) throw new Error(`${step} failed: ${JSON.stringify(out.status).slice(0, 300)}`);
  ctx.txs.push({ step, tx: out.transaction.hash });
  return out.transaction.hash;
}

/**
 * One function call, waited to FINAL. Returns the hash and the decoded result; throws with NEAR's own
 * error if it failed. (Sent directly: callFinal's error path cannot print an action that holds a bigint.)
 */
async function call(ctx: Ctx, from: SignerHandle, contract: string, method: string, args: object, step: string, opts: { gas?: bigint; deposit?: bigint } = {}): Promise<{ tx: string; value: unknown }> {
  let out: { transaction: { hash: string }; status: { SuccessValue?: string; Failure?: unknown } };
  try {
    out = (await from.account.signAndSendTransaction({ receiverId: contract, actions: [actions.functionCall(method, args as Record<string, unknown>, opts.gas ?? 100n * TGAS, opts.deposit ?? 0n)], waitUntil: "FINAL" })) as unknown as typeof out;
  } catch (error) {
    throw new Error(`${step}: ${(error as Error).message}`);
  }
  if (out.status.Failure !== undefined) throw new Error(`${step} failed: ${JSON.stringify(out.status.Failure).slice(0, 300)}`);
  ctx.txs.push({ step, tx: out.transaction.hash });
  const raw = out.status.SuccessValue ? Buffer.from(out.status.SuccessValue, "base64").toString("utf8") : "";
  let value: unknown = raw;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = raw;
  }
  return { tx: out.transaction.hash, value };
}

/** Signers hold the gas they attach up front (0.001 NEAR per TGas on testnet, refunded after). */
async function ensureNear(ctx: Ctx, account: string, min: bigint): Promise<void> {
  const have = await balance(account);
  if (have === null || have >= min) return;
  if (plan(ctx, `top up ${short(account)} to ${Number(min) / 1e24} NEAR for gas`)) return;
  await send(ctx, ctx.root, account, [actions.transfer(min - have)], `gas for ${short(account)}`);
}

/** Prints the step. Returns true in a dry run, so the caller skips sending it. */
function plan(ctx: Ctx, line: string): boolean {
  console.log(`  ${ctx.dryRun ? "[dry run] would " : ""}${line}`);
  return ctx.dryRun;
}

// ---- 1. Accounts -----------------------------------------------------------------------------------

async function ensureAccount(ctx: Ctx, name: string, near: bigint): Promise<void> {
  const id = acct(name);
  if ((await balance(id)) !== null) return void console.log(`  ok   ${short(id)} exists`);
  if (plan(ctx, `create ${short(id)} with ${Number(near) / 1e24} NEAR`)) return;
  const secret = ctx.creds.get(id);
  if (!secret) throw new Error(`no key for ${id}; add one to the credential store first`);
  const pub = KeyPair.fromString(secret as KeyPairString).getPublicKey();
  await send(ctx, ctx.root, id, [actions.createAccount(), actions.transfer(near), actions.addFullAccessKey(pub)], `create ${id}`);
}

async function ensureSputnik(ctx: Ctx, c: Community): Promise<void> {
  const id = c.treasury;
  if ((await balance(id)) !== null) {
    const policy = await view<{ roles: unknown[] }>(id, "get_policy").catch(() => null);
    if (policy) return void console.log(`  ok   ${short(id)} is a Sputnik DAO`);
    throw new Error(`${id} exists but has no DAO`);
  }
  const code = await rpc("query", { request_type: "view_code", finality: "final", account_id: SPUTNIK_SOURCE });
  const wasm = Buffer.from(code.code_base64 as string, "base64");
  const need = BigInt(wasm.length + 20_000) * 10n ** 19n + milli(0.1);
  if (plan(ctx, `create the ${c.name} Sputnik DAO at ${short(id)} (${wasm.length} bytes of code, ${(Number(need) / 1e24).toFixed(2)} NEAR)`)) return;
  const secret = ctx.creds.get(id);
  if (!secret) throw new Error(`no key for ${id}`);
  const policy = {
    roles: [{ name: "council", kind: { Group: c.council.map(acct) }, permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"], vote_policy: {} }],
    default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
    proposal_bond: milli(0.01).toString(),
    proposal_period: "604800000000000",
    bounty_bond: milli(0.01).toString(),
    bounty_forgiveness_period: "86400000000000",
  };
  const args = { config: { name: "mission-street", purpose: `${c.name}: the house's shared AI budget, funded by council vote.`, metadata: "" }, policy };
  await send(ctx, ctx.root, id, [
    actions.createAccount(),
    actions.transfer(need),
    actions.addFullAccessKey(KeyPair.fromString(secret as KeyPairString).getPublicKey()),
    actions.deployContract(new Uint8Array(wasm)),
    actions.functionCall("new", args, 150n * TGAS, 0n),
  ], `create DAO ${id}`);
  console.log(`  made ${short(id)}: Sputnik DAO, council ${c.council.join(", ")}`);
}

// ---- 2. USDC ---------------------------------------------------------------------------------------

async function swapForUsdc(ctx: Ctx): Promise<void> {
  const wrapped = BigInt(await view<string>(WRAP, "ft_balance_of", { account_id: ROOT }));
  const rootNear = (await balance(ROOT))!;
  // Swap more NEAR only while the root keeps a wide margin over the 3 NEAR it must keep.
  const extra = rootNear - LIVE.swapNear > ROOT_KEEP + 3n * NEAR ? LIVE.swapNear : 0n;
  const amountIn = wrapped + extra;
  if (amountIn === 0n) return void console.log("  ok   nothing to swap");
  const quote = BigInt(await view<string>(REF, "get_return", { pool_id: REF_POOL, token_in: WRAP, amount_in: amountIn.toString(), token_out: USDC }));
  if (plan(ctx, `swap ${Number(amountIn) / 1e24} NEAR (${Number(wrapped) / 1e24} already wrapped) for about ${usd(quote)} USDC on Ref pool ${REF_POOL}`)) return;
  if (extra > 0n) await call(ctx, ctx.root, WRAP, "near_deposit", {}, "wrap NEAR", { gas: 50n * TGAS, deposit: extra });
  const minOut = (quote * 97n) / 100n;
  const msg = JSON.stringify({ actions: [{ pool_id: REF_POOL, token_in: WRAP, token_out: USDC, amount_in: amountIn.toString(), min_amount_out: minOut.toString() }] });
  await call(ctx, ctx.root, WRAP, "ft_transfer_call", { receiver_id: REF, amount: amountIn.toString(), msg }, "swap on Ref", { gas: 180n * TGAS, deposit: 1n });
  const deposits = await view<Record<string, string>>(REF, "get_deposits", { account_id: ROOT });
  if (BigInt(deposits[USDC] ?? "0") > 0n) await call(ctx, ctx.root, REF, "withdraw", { token_id: USDC, amount: deposits[USDC], unregister: false }, "withdraw USDC from Ref", { gas: 150n * TGAS, deposit: 1n });
  console.log(`  swapped: root now holds ${usd(BigInt(await view<string>(USDC, "ft_balance_of", { account_id: ROOT })))} USDC`);
}

async function ensureStorage(ctx: Ctx, contract: string, account: string): Promise<void> {
  if ((await balance(account)) === null && !ctx.dryRun) return;
  const reg = await view<unknown>(contract, "storage_balance_of", { account_id: account });
  if (reg) return;
  if (plan(ctx, `register ${short(account)} on ${contract === USDC ? "USDC" : short(contract)}`)) return;
  await call(ctx, ctx.root, contract, "storage_deposit", { account_id: account, registration_only: true }, `storage ${short(account)} on ${short(contract)}`, { gas: 30n * TGAS, deposit: STORAGE });
}

/** Tops `account` up to `target` USDC from the root, counting what it already moved on (`spent`). */
async function topUp(ctx: Ctx, account: string, target: bigint, spent = 0n): Promise<void> {
  const have = (await balance(account)) === null ? 0n : BigInt(await view<string>(USDC, "ft_balance_of", { account_id: account }));
  const need = target - spent - have;
  if (need <= 0n) return;
  if (plan(ctx, `send ${usd(need)} USDC to ${short(account)}`)) return;
  await call(ctx, ctx.root, USDC, "ft_transfer", { receiver_id: account, amount: need.toString(), memo: "Wardline testnet cast" }, `USDC to ${short(account)}`, { gas: 30n * TGAS, deposit: 1n });
}

// ---- 3. Budgets ------------------------------------------------------------------------------------

interface Budget {
  deposit: string;
  members: Array<{ member: string; allowance: string }>;
}

const getBudget = (id: string) => view<Budget | null>(METER, "get_budget", { budget_id: id });

async function ensureBudget(ctx: Ctx, id: string, name: string, owner: string, members: Array<{ member: string; allowance: bigint }>): Promise<void> {
  const b = await getBudget(id);
  if (!b) {
    if (plan(ctx, `create budget ${id} owned by ${short(owner)} for ${members.map((m) => short(m.member)).join(", ")}`)) return;
    await call(ctx, ctx.root, METER, "create_budget", { budget_id: id, name, owner, deposit: "0", period: "week", members: members.map((m) => ({ member: m.member, allowance: m.allowance.toString() })) }, `create budget ${id}`);
    return void console.log(`  made budget ${id}`);
  }
  for (const m of members) {
    const cur = b.members.find((x) => x.member === m.member);
    if (cur && BigInt(cur.allowance) === m.allowance) continue;
    if (plan(ctx, `set ${short(m.member)}'s allowance on ${id} to ${usd(m.allowance)} USDC`)) continue;
    await call(ctx, ctx.root, METER, "set_allowance", { budget_id: id, member: m.member, allowance: m.allowance.toString() }, `allowance ${short(m.member)} on ${id}`);
  }
  console.log(`  ok   budget ${id}`);
}

/** A treasury or individual funds its budget with ft_transfer_call to the meter. Logged as a deposit. */
async function fundBudget(ctx: Ctx, from: string, budget: string, amount: bigint, label: string): Promise<void> {
  const b = await getBudget(budget);
  if (b && BigInt(b.deposit) >= amount) return void console.log(`  ok   ${budget} holds ${usd(BigInt(b.deposit))} USDC`);
  if (plan(ctx, `${short(from)} funds ${budget} with ${usd(amount)} USDC`)) return;
  await ensureNear(ctx, from, milli(0.08));
  const out = await call(ctx, signer(ctx, from), USDC, "ft_transfer_call", { receiver_id: METER, amount: amount.toString(), msg: JSON.stringify({ budget_id: budget }) }, `fund ${budget}`, { gas: 60n * TGAS, deposit: 1n });
  if (String(out.value) !== amount.toString()) throw new Error(`the meter kept ${String(out.value)} of ${amount} for ${budget}`);
  await ctx.writer.record(out.tx, from, { actor: from, community: budget, kind: "deposit", amount: amount.toString(), model: null, outcome: "paid", side: "above", reason: null, text: `${label} funded its AI budget with ${usd(amount)} USDC` });
  console.log(`  funded ${budget}: ${usd(amount)} USDC`);
}

/** Mission Street funds its budget the way a DAO does: a council proposal, then votes. */
async function fundByDao(ctx: Ctx, c: Community): Promise<void> {
  const b = await getBudget(c.id);
  if (b && BigInt(b.deposit) >= c.fund) return void console.log(`  ok   ${c.id} holds ${usd(BigInt(b.deposit))} USDC`);
  if (plan(ctx, `${c.council[0]} proposes in ${short(c.treasury)} to move ${usd(c.fund)} USDC into ${c.id}; the council votes`)) return;
  const inner = { receiver_id: METER, amount: c.fund.toString(), msg: JSON.stringify({ budget_id: c.id }) };
  const kind = { FunctionCall: { receiver_id: USDC, actions: [{ method_name: "ft_transfer_call", args: Buffer.from(JSON.stringify(inner)).toString("base64"), deposit: "1", gas: (120n * TGAS).toString() }] } };
  const description = `Move ${usd(c.fund)} USDC from the treasury into the house's AI budget (${c.id}).`;
  const proposer = acct(c.council[0]!);
  for (const m of c.council) await ensureNear(ctx, acct(m), milli(0.3));
  // A proposal opened by an earlier run that stopped part way is voted on, not opened again.
  const last = await view<number>(c.treasury, "get_last_proposal_id");
  const open = last > 0 ? (await view<Array<{ id: number; description: string; status: string }>>(c.treasury, "get_proposals", { from_index: 0, limit: last })).find((p) => p.description === description && p.status === "InProgress") : undefined;
  let id: number;
  if (open) {
    id = open.id;
    console.log(`  resuming proposal ${id} in ${short(c.treasury)}`);
  } else {
  const added = await call(ctx, signer(ctx, proposer), c.treasury, "add_proposal", { proposal: { description, kind } }, `propose ${c.id} funding`, { gas: 50n * TGAS, deposit: milli(0.01) });
  id = Number(added.value);
  await ctx.writer.record(added.tx, proposer, { actor: proposer, community: c.id, kind: "proposal", amount: c.fund.toString(), model: null, outcome: "opened", side: "above", reason: null, text: `${c.name}: ${cap(c.council[0]!)} proposed moving ${usd(c.fund)} USDC into the AI budget` });
  }
  for (const m of c.council) {
    const voter = acct(m);
    const p = await view<{ status: string }>(c.treasury, "get_proposal", { id });
    if (p.status !== "InProgress") break;
    const voted = await call(ctx, signer(ctx, voter), c.treasury, "act_proposal", { id, action: "VoteApprove" }, `vote ${short(voter)} on ${c.id} funding`, { gas: 250n * TGAS });
    const after = await view<{ status: string }>(c.treasury, "get_proposal", { id });
    await ctx.writer.record(voted.tx, voter, { actor: voter, community: c.id, kind: "vote", amount: null, model: null, outcome: "voted", side: "above", reason: null, text: after.status === "Approved" ? `${c.name}: ${cap(m)} voted yes; the proposal passed and moved ${usd(c.fund)} USDC into the AI budget` : `${c.name}: ${cap(m)} voted yes on funding the AI budget` });
  }
  const now = await getBudget(c.id);
  if (!now || BigInt(now.deposit) < c.fund) throw new Error(`${c.id} holds ${now ? usd(BigInt(now.deposit)) : "nothing"} after the DAO vote`);
  console.log(`  funded ${c.id} by DAO vote: ${usd(c.fund)} USDC`);
}

// ---- 4. The Mutual ---------------------------------------------------------------------------------

async function firstLoss(ctx: Ctx): Promise<void> {
  const pool = await view<{ junior: string }>(POOL, "get_pool");
  if (BigInt(pool.junior) >= 250_000n + LIVE.firstLoss) return void console.log(`  ok   first-loss stake ${usd(BigInt(pool.junior))} USDC`);
  if (plan(ctx, `add ${usd(LIVE.firstLoss)} USDC to Wardline's first-loss stake`)) return;
  const out = await call(ctx, ctx.root, USDC, "ft_transfer_call", { receiver_id: POOL, amount: LIVE.firstLoss.toString(), msg: JSON.stringify({ first_loss: true }) }, "first-loss stake", { gas: 100n * TGAS, deposit: 1n });
  if (String(out.value) !== LIVE.firstLoss.toString()) throw new Error(`the pool kept ${String(out.value)} of the first-loss stake`);
  await ctx.writer.record(out.tx, ROOT, { actor: ROOT, community: "mutual", kind: "deposit", amount: LIVE.firstLoss.toString(), model: null, outcome: "paid", side: "above", reason: null, text: `Wardline added ${usd(LIVE.firstLoss)} USDC to its first-loss stake, which absorbs claims before WARD holders` });
  console.log(`  first-loss stake +${usd(LIVE.firstLoss)} USDC`);
}

async function lpDeposit(ctx: Ctx, lp: (typeof LIVE.lps)[number]): Promise<void> {
  const id = acct(lp.name);
  const ward = (await balance(id)) === null ? 0n : BigInt(await view<string>(POOL, "ft_balance_of", { account_id: id }));
  if (ward > 0n) return void console.log(`  ok   ${lp.name} holds WARD`);
  if (plan(ctx, `${lp.name} deposits ${usd(lp.deposit)} USDC into the Mutual`)) return;
  await ensureNear(ctx, id, milli(0.13));
  const out = await call(ctx, signer(ctx, id), USDC, "ft_transfer_call", { receiver_id: POOL, amount: lp.deposit.toString(), msg: "" }, `deposit ${lp.name}`, { gas: 100n * TGAS, deposit: 1n });
  if (String(out.value) !== lp.deposit.toString()) throw new Error(`the pool kept ${String(out.value)} of ${lp.deposit}`);
  await ctx.writer.record(out.tx, id, { actor: id, community: "mutual", kind: "deposit", amount: lp.deposit.toString(), model: null, outcome: "paid", side: "above", reason: null, text: `${lp.name} deposited ${usd(lp.deposit)} USDC and received WARD` });
  console.log(`  ${lp.name} deposited ${usd(lp.deposit)} USDC`);
}

// ---- Run -------------------------------------------------------------------------------------------

export async function runSetup(dryRun = DRY_RUN): Promise<void> {
  loadDotEnv();
  const provider = makeProvider(RPC_URL);
  const creds = new CredentialStore(join(defaultSecretsDir("testnet"), "credentials.json"));
  const rootKey = creds.get(ROOT);
  if (!rootKey) throw new Error(`no key for ${ROOT} in the credential store`);
  const ctx: Ctx = { dryRun, provider, creds, root: makeSigner(provider, ROOT, rootKey), writer: new ActivityWriter({ dryRun }), txs: [] };
  const startNear = (await balance(ROOT))!;
  const startUsdc = BigInt(await view<string>(USDC, "ft_balance_of", { account_id: ROOT }));
  console.log(`Wardline testnet setup (${dryRun ? "dry run: nothing is sent or written" : "live"})`);
  console.log(`Root: ${(Number(startNear) / 1e24).toFixed(3)} NEAR, ${usd(startUsdc)} USDC. At least ${Number(ROOT_KEEP) / 1e24} NEAR stays in the root.\n`);

  try {
    console.log("Accounts");
    const signers = new Set<string>([...LIVE.communities.flatMap((c) => c.council), ...LIVE.individuals.map((i) => i.name), ...LIVE.lps.map((l) => l.name), LIVE.browserMember.name]);
    for (const c of LIVE.communities) {
      if (c.dao) await ensureSputnik(ctx, c);
      else await ensureAccount(ctx, c.treasury, milli(0.1));
      for (const m of c.members) await ensureAccount(ctx, m, signers.has(m) ? milli(0.1) : milli(0.05));
    }
    for (const i of LIVE.individuals) await ensureAccount(ctx, i.name, milli(0.1));
    for (const l of LIVE.lps) await ensureAccount(ctx, l.name, milli(0.15));

    console.log("\nUSDC");
    await swapForUsdc(ctx);
    const holders = [...LIVE.communities.map((c) => c.treasury), ...LIVE.individuals.map((i) => acct(i.name)), ...LIVE.lps.map((l) => acct(l.name)), acct(LIVE.browserMember.name)];
    for (const h of holders) await ensureStorage(ctx, USDC, h);
    for (const h of [...LIVE.lps.map((l) => acct(l.name)), acct(LIVE.browserMember.name)]) await ensureStorage(ctx, POOL, h);

    console.log("\nMeter");
    if (!dryRun) {
      // The meter checks settle proofs against its own copy of each model's signer. Keep it current.
      const models = await view<Array<{ model_id: string; signing_address: string }>>("model-registry.wardline-labs.testnet", "list_models");
      const deepseek = models.find((m) => m.model_id === DEEPSEEK);
      if (deepseek) await call(ctx, ctx.root, METER, "update_attested_model", { model_id: DEEPSEEK, signing_address: deepseek.signing_address }, "meter attested signer");
    }
    for (const c of LIVE.communities) {
      await ensureBudget(ctx, c.id, c.name, c.treasury, c.members.map((m) => ({ member: acct(m), allowance: m === "tariq" ? LIVE.leakedAllowance : LIVE.allowance })));
    }
    for (const i of LIVE.individuals) await ensureBudget(ctx, `bgt_ind_${i.name}`, `${cap(i.name)} (solo)`, acct(i.name), [{ member: acct(i.name), allowance: LIVE.allowance }]);

    console.log("\nFunding");
    for (const c of LIVE.communities) {
      const b = await getBudget(c.id);
      await topUp(ctx, c.treasury, c.fund, b ? BigInt(b.deposit) : 0n);
      if (c.dao) await fundByDao(ctx, c);
      else await fundBudget(ctx, c.treasury, c.id, c.fund, `${c.name}'s treasury`);
    }
    for (const i of LIVE.individuals) {
      const id = `bgt_ind_${i.name}`;
      const b = await getBudget(id);
      await topUp(ctx, acct(i.name), i.fund, b ? BigInt(b.deposit) : 0n);
      await fundBudget(ctx, acct(i.name), id, i.fund, cap(i.name));
    }

    console.log("\nThe Mutual");
    await firstLoss(ctx);
    for (const l of LIVE.lps) {
      await topUp(ctx, acct(l.name), l.hold);
      await lpDeposit(ctx, l);
    }
    await topUp(ctx, acct(LIVE.browserMember.name), LIVE.browserMember.hold);
  } finally {
    const endNear = (await balance(ROOT))!;
    const endUsdc = BigInt(await view<string>(USDC, "ft_balance_of", { account_id: ROOT }));
    console.log(`\nRoot: ${(Number(endNear) / 1e24).toFixed(3)} NEAR (${(Number(startNear - endNear) / 1e24).toFixed(3)} spent), ${usd(endUsdc)} USDC.`);
    if (dryRun) console.log("Dry run: nothing was sent and nothing under data/testnet/ changed.");
    else await writeSetup(ctx);
  }
}

async function writeSetup(ctx: Ctx): Promise<void> {
  const accounts = [...LIVE.communities.flatMap((c) => [c.treasury, ...c.members.map(acct)]), ...LIVE.individuals.map((i) => acct(i.name)), ...LIVE.lps.map((l) => acct(l.name))];
  const existing: string[] = [];
  for (const a of accounts) if ((await balance(a)) !== null) existing.push(a);
  mkdirSync(DATA_DIR, { recursive: true });
  let prev: Array<{ step: string; tx: string }> = [];
  try {
    prev = (JSON.parse(readFileSync(join(DATA_DIR, "setup.json"), "utf8")) as { transactions?: typeof prev }).transactions ?? [];
  } catch {
    prev = [];
  }
  writeFileSync(join(DATA_DIR, "setup.json"), `${JSON.stringify({ network: "testnet", updated_at: new Date().toISOString(), root_account: ROOT, accounts: existing, transactions: [...prev, ...ctx.txs] }, null, 2)}\n`);
  console.log(`Wrote data/testnet/setup.json: ${existing.length} cast accounts on chain, ${ctx.txs.length} new transactions.`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/testnet/setup.ts")) {
  runSetup().catch((err: Error) => {
    console.error(`Setup stopped: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
