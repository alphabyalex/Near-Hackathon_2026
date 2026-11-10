/**
 * The only code that writes to data/testnet/. Rows are built by rowFromChain from what NEAR RPC returns
 * for a transaction hash (see services/api/src/activity/log.ts); a hash RPC does not know, a failed
 * transaction or a signer mismatch throws and writes nothing. Under --dry-run every write throws.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activityPaths, makeRpc, rowFromChain, type ActivityRow, type Rpc, type RowFields } from "../../services/api/src/activity/log.js";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = join(REPO_ROOT, "data/testnet");
// .env first, so the RPC choice below sees it (the scheduled task starts with a bare environment).
loadDotEnv();
export const RPC_URL = process.env.WARDLINE_NEAR_RPC_URL ?? process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
/** RPC_URL may list several endpoints, comma-separated; requests fail over between them. */
export const RPC_URLS = [...RPC_URL.split(",").map((u) => u.trim()).filter(Boolean), "https://rpc.testnet.near.org"];
export const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Reads the repo's .env into process.env without overriding what is already set. Never prints values.
 * WARDLINE_DOTENV points at another file: the scheduled clone reads the main checkout's .env, so no key is copied.
 */
export function loadDotEnv(path = process.env.WARDLINE_DOTENV ?? join(REPO_ROOT, ".env")): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    const value = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    if (value) process.env[m[1]!] = value;
  }
}

export class DryRunWrite extends Error {
  constructor(what: string) {
    super(`--dry-run: refusing to write ${what}. Nothing under data/testnet/ changes in a dry run.`);
  }
}

export class ActivityWriter {
  readonly path: string;
  constructor(
    private readonly opts: { dryRun: boolean; rpc?: Rpc; path?: string } = { dryRun: DRY_RUN },
  ) {
    this.path = opts.path ?? activityPaths().log;
  }

  /** Fetches the transaction from RPC, builds the row from it, appends it, and returns it. */
  async record(hash: string, signer: string, fields: RowFields): Promise<ActivityRow> {
    if (this.opts.dryRun) throw new DryRunWrite("an activity row");
    const row = await rowFromChain(this.opts.rpc ?? makeRpc(RPC_URLS), hash, signer, fields);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(row)}\n`, "utf8");
    return row;
  }
}

/** NEAR AI list prices for DeepSeek V4.1 Flash, USD per token (fixtures/nearai/models.json). */
export const PRICE_USD = { prompt: 0.3e-6, completion: 1.2e-6 } as const;

export interface KeySpend {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export interface SpendLedger {
  total_calls: number;
  hard_cap: number;
  current_key: "key_1" | "key_2";
  key_1_spend: KeySpend;
  key_2_spend: KeySpend;
  last_call_at: string | null;
}

export const HARD_CAP = 450;
const SPEND_PATH = join(DATA_DIR, "nearai-spend.json");

export function loadSpend(path = SPEND_PATH): SpendLedger {
  const zero = (): KeySpend => ({ calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 });
  if (!existsSync(path)) return { total_calls: 0, hard_cap: HARD_CAP, current_key: "key_1", key_1_spend: zero(), key_2_spend: zero(), last_call_at: null };
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SpendLedger>;
  return {
    // Keeps notes such as manual_checks (live calls made outside the batch, counted toward the cap).
    ...raw,
    total_calls: raw.total_calls ?? 0,
    hard_cap: HARD_CAP,
    current_key: raw.current_key === "key_2" ? "key_2" : "key_1",
    key_1_spend: { ...zero(), ...raw.key_1_spend },
    key_2_spend: { ...zero(), ...raw.key_2_spend },
    last_call_at: raw.last_call_at ?? null,
  };
}

/** Adds one live NEAR AI call, priced from the token counts NEAR AI returned in `usage`. */
export function addSpend(ledger: SpendLedger, key: "key_1" | "key_2", usage: { prompt_tokens: number; completion_tokens: number }, at: string): void {
  const s = key === "key_1" ? ledger.key_1_spend : ledger.key_2_spend;
  s.calls += 1;
  s.prompt_tokens += usage.prompt_tokens;
  s.completion_tokens += usage.completion_tokens;
  s.cost_usd = Number((s.prompt_tokens * PRICE_USD.prompt + s.completion_tokens * PRICE_USD.completion).toFixed(6));
  ledger.total_calls += 1;
  ledger.last_call_at = at;
}

export function saveSpend(ledger: SpendLedger, dryRun: boolean, path = SPEND_PATH): void {
  if (dryRun) throw new DryRunWrite("the NEAR AI spend ledger");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/**
 * One function call, waited to FINAL, with the same shape as the vault client's callFinal. Throws with
 * NEAR's own error (callFinal's error path cannot print an action that holds a bigint, which hides it).
 */
export async function sendCall(
  signer: { account: { signAndSendTransaction: (tx: never) => Promise<unknown> } },
  call: { contract_id: string; method: string; args: Record<string, unknown>; gas?: bigint; deposit?: bigint },
): Promise<{ tx_hash: string; value: unknown }> {
  const { actions } = await import("@wardline/vault-client");
  let out: { transaction: { hash: string }; status: { SuccessValue?: string; Failure?: unknown } };
  try {
    out = (await signer.account.signAndSendTransaction({ receiverId: call.contract_id, actions: [actions.functionCall(call.method, call.args, call.gas ?? 100_000_000_000_000n, call.deposit ?? 0n)], waitUntil: "FINAL" } as never)) as typeof out;
  } catch (error) {
    throw new Error(`${call.method} on ${call.contract_id}: ${(error as Error).message}`);
  }
  if (out.status.Failure !== undefined) throw new Error(`${call.method} on ${call.contract_id} failed: ${JSON.stringify(out.status.Failure).slice(0, 300)}`);
  const raw = out.status.SuccessValue ? Buffer.from(out.status.SuccessValue, "base64").toString("utf8") : "";
  let value: unknown = raw;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = raw;
  }
  return { tx_hash: out.transaction.hash, value };
}
