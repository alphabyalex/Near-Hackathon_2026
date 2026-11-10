/**
 * pnpm testnet:audit: checks data/testnet/activity.jsonl against NEAR testnet and exits non-zero on any miss.
 *
 *   1. Every row: the RPC tx method knows its hash, signed by its signer, and it succeeded; the block
 *      of its first receipt has the row's height.
 *   2. Every account: each cast account setup created (data/testnet/setup.json, else cast.json) and
 *      each row's actor and signer exists (view_account).
 *   3. Totals: per budget, the log never claims more than get_reputation and get_budget record
 *      (proven, refused and capped calls, USDC spent), and logged deposits never exceed the pool.
 *
 * On a full pass it writes data/testnet/audit.json, pinning the rows it checked by their sha256. The API
 * serves only those rows, and in near mode refuses /v1/activity until a stamp exists.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activityPaths, isChainRow, logLines, makeRpc, prefixHash, type ActivityRow, type AuditStamp } from "../../services/api/src/activity/log.js";
import { DATA_DIR, REPO_ROOT, RPC_URL, RPC_URLS } from "./chain-log.js";

const rpc = makeRpc(RPC_URLS);

function decode(b64: string): unknown {
  if (!b64) return null;
  const text = Buffer.from(b64, "base64").toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The contract method each kind of row must be, and what its result must say. */
const EXPECT: Record<string, { method: string; check?: (value: unknown, row: ActivityRow) => string | null }> = {
  "call:paid": { method: "settle" },
  "call:refused": { method: "release" },
  "call:capped": {
    method: "reserve",
    check: (v, row) => {
      const r = v as { ok?: boolean; reason?: string } | null;
      return r?.ok === false && r.reason === row.reason ? null : `reserve returned ${JSON.stringify(v)}, not a refusal for ${row.reason}`;
    },
  },
  "deposit:paid": { method: "ft_transfer_call", check: (v, row) => (String(v) === row.amount ? null : `the pool kept ${String(v)}, the row says ${row.amount}`) },
  "vote:voted": { method: "vote" },
  "proposal:opened": { method: "propose" },
};
const short = (a: string) => a.replace(/\.wardline-labs\.testnet$/, "");
const usdc = (a: bigint | string) => (Number(a) / 1e6).toFixed(6);

async function view<T>(contract: string, method: string, args: object): Promise<T> {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result as number[]).toString("utf8")) as T;
}

function castAccounts(): string[] {
  const setupPath = join(DATA_DIR, "setup.json");
  if (existsSync(setupPath)) {
    const setup = JSON.parse(readFileSync(setupPath, "utf8")) as { accounts?: string[] };
    if (Array.isArray(setup.accounts)) return setup.accounts;
  }
  const cast = JSON.parse(readFileSync(join(REPO_ROOT, "scripts/testnet/cast.json"), "utf8")) as {
    communities: Array<{ dao_account: string; members: Array<{ account: string }> }>;
    individuals: Array<{ account: string }>;
    liquidity_providers: Array<{ account: string }>;
  };
  return [...cast.communities.flatMap((c) => [c.dao_account, ...c.members.map((m) => m.account)]), ...cast.individuals.map((i) => i.account), ...cast.liquidity_providers.map((l) => l.account)];
}

export async function runAudit(): Promise<boolean> {
  const repo = JSON.parse(readFileSync(join(REPO_ROOT, "repo.config.json"), "utf8")) as { near: { contracts: { meter: string; coverPool: string } } };
  const { meter, coverPool } = repo.near.contracts;
  const paths = activityPaths();
  const lines = existsSync(paths.log) ? logLines(readFileSync(paths.log, "utf8")) : [];
  const misses: string[] = [];
  const miss = (m: string) => {
    misses.push(m);
    console.log(`  MISS ${m}`);
  };

  console.log(`Wardline testnet audit against ${RPC_URL}`);
  console.log(`Log: ${lines.length} row(s) in data/testnet/activity.jsonl\n`);

  // 1. Every row is a transaction RPC knows.
  console.log("Transactions");
  const rows: ActivityRow[] = [];
  for (const [i, line] of lines.entries()) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      miss(`row ${i + 1}: not JSON`);
      continue;
    }
    if (!isChainRow(row)) {
      miss(`row ${i + 1}: not a chain row (tx ${JSON.stringify((row as { tx?: unknown }).tx)}, block ${JSON.stringify((row as { block_height?: unknown }).block_height)})`);
      continue;
    }
    rows.push(row);
    try {
      const tx = await rpc("tx", { tx_hash: row.tx, sender_account_id: row.signer, wait_until: "FINAL" });
      if (tx.transaction?.hash !== row.tx) throw new Error("hash mismatch");
      if (tx.transaction.signer_id !== row.signer) throw new Error(`signed by ${tx.transaction.signer_id}`);
      if (tx.transaction.receiver_id !== row.receiver) throw new Error(`sent to ${tx.transaction.receiver_id}`);
      if (!tx.status || !("SuccessValue" in tx.status)) throw new Error(`status ${JSON.stringify(tx.status).slice(0, 120)}`);
      // What the transaction did must match what the row says it did.
      const method = tx.transaction.actions?.[0]?.FunctionCall?.method_name as string | undefined;
      const value = decode(tx.status.SuccessValue as string);
      const want = EXPECT[`${row.kind}:${row.outcome}`];
      if (!want) throw new Error(`no rule for ${row.kind}:${row.outcome}`);
      if (method !== want.method) throw new Error(`calls ${method ?? "no method"}, a ${row.kind}:${row.outcome} row needs ${want.method}`);
      const bad = want.check?.(value, row);
      if (bad) throw new Error(bad);
      const block = await rpc("block", { block_id: tx.receipts_outcome[0].block_hash });
      if (block.header.height !== row.block_height) throw new Error(`receipt block ${block.header.height}, row says ${row.block_height}`);
      console.log(`  ok   ${String(i + 1).padStart(3)} ${row.kind}:${row.outcome}`.padEnd(32) + ` ${short(row.actor).padEnd(16)} block ${row.block_height}  ${row.tx}`);
    } catch (error) {
      miss(`row ${i + 1} ${row.tx}: ${(error as Error).message}`);
    }
  }

  // 2. Every account exists.
  console.log("\nAccounts");
  const accounts = [...new Set([...castAccounts(), ...rows.flatMap((r) => [r.actor, r.signer])])].filter((a) => a.endsWith(".testnet") || a.length === 64);
  let found = 0;
  for (const account of accounts) {
    try {
      await rpc("query", { request_type: "view_account", finality: "final", account_id: account });
      found++;
    } catch (error) {
      miss(`account ${account}: ${(error as Error).message}`);
    }
  }
  console.log(`  ${found} of ${accounts.length} accounts exist`);

  // 3. The log never claims more than the chain records.
  console.log("\nTotals against chain views");
  const pool = await view<{ tvl: string; ward_price: string; fees_earned: string; ward_supply: string }>(coverPool, "get_pool", {});
  console.log(`  get_pool: tvl ${usdc(pool.tvl)} USDC, fees earned ${usdc(pool.fees_earned)}, WARD price ${usdc(pool.ward_price)}`);
  const budgets = [...new Set(rows.filter((r) => r.kind === "call").map((r) => r.community))].sort();
  for (const id of budgets) {
    const mine = rows.filter((r) => r.community === id && r.kind === "call");
    const logged = {
      proven: mine.filter((r) => r.outcome === "paid").length,
      refused: mine.filter((r) => r.outcome === "refused").length,
      capped: mine.filter((r) => r.outcome === "capped").length,
      spent: mine.filter((r) => r.outcome === "paid").reduce((n, r) => n + BigInt(r.amount ?? "0"), 0n),
    };
    const rep = await view<{ proven_calls: number; refused_calls: number; capped_calls: number } | null>(meter, "get_reputation", { budget_id: id });
    const budget = await view<{ spent: string } | null>(meter, "get_budget", { budget_id: id });
    if (!rep || !budget) {
      miss(`${id}: no reputation or budget on the meter`);
      continue;
    }
    const line = `  ${id.padEnd(18)} proven ${logged.proven}/${rep.proven_calls}  refused ${logged.refused}/${rep.refused_calls}  capped ${logged.capped}/${rep.capped_calls}  spent ${usdc(logged.spent)}/${usdc(budget.spent)} (log/chain)`;
    console.log(line);
    if (logged.proven > rep.proven_calls) miss(`${id}: ${logged.proven} paid calls logged, ${rep.proven_calls} on chain`);
    if (logged.refused > rep.refused_calls) miss(`${id}: ${logged.refused} refusals logged, ${rep.refused_calls} on chain`);
    if (logged.capped > rep.capped_calls) miss(`${id}: ${logged.capped} capped calls logged, ${rep.capped_calls} on chain`);
    if (logged.spent > BigInt(budget.spent)) miss(`${id}: ${usdc(logged.spent)} USDC spent logged, ${usdc(budget.spent)} on chain`);
  }
  const deposited = rows.filter((r) => r.kind === "deposit").reduce((n, r) => n + BigInt(r.amount ?? "0"), 0n);
  console.log(`  deposits logged ${usdc(deposited)} USDC, pool tvl ${usdc(pool.tvl)} USDC`);
  if (deposited > BigInt(pool.tvl)) miss(`deposits logged ${usdc(deposited)} exceed pool tvl ${usdc(pool.tvl)}`);

  const passed = misses.length === 0;
  console.log(`\n${passed ? "PASS" : "FAIL"}: ${rows.length} of ${lines.length} rows are chain rows, ${misses.length} miss(es).`);
  if (passed) {
    const stamp: AuditStamp = { passed: true, at: new Date().toISOString(), rows: lines.length, sha256: prefixHash(lines, lines.length), rpc: RPC_URL };
    writeFileSync(paths.audit, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
    console.log(`Wrote data/testnet/audit.json: the API now serves these ${lines.length} row(s).`);
  }
  return passed;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/testnet/audit.ts")) {
  runAudit()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err: Error) => {
      console.error(`Audit could not finish: ${err.message}`);
      process.exit(1);
    });
}
