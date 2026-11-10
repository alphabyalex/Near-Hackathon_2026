/**
 * One account's Wardline transactions, read from the chain: GET /v1/people/:account/transactions.
 *
 * 1. An indexer (the NearBlocks testnet API, no key) lists the account's transactions and fungible
 *    token moves.
 * 2. Only transactions that touch our contracts are kept: ft_transfer_call on USDC with the pool as
 *    receiver, and request_redeem (request_withdraw), redeem, vote, propose, execute and ft_transfer
 *    (WARD) on the pool.
 * 3. Each one is confirmed with the RPC tx method: the real hash, the signer and receiver the indexer
 *    named, the method and its arguments, and its outcome. A row that can't be confirmed is dropped.
 *    A failed transaction is kept, as Failed.
 * 4. Rows from the audited activity log (the scripts' rows) are merged in, de-duplicated by hash.
 *
 * Cached per account for 30 seconds. When the indexer is down, the last rows this server confirmed
 * are returned with complete: false, and the page says some history may be missing.
 */
import type { ActivityItem } from "./types.js";
import type { Rpc } from "./log.js";

export type TxType = "buy" | "sell_request" | "sell" | "vote" | "propose" | "execute" | "send" | "receive";

export interface WalletTx {
  hash: string;
  /** ISO time of the block. */
  at: string;
  type: TxType;
  status: "confirmed" | "failed";
  /** Atomic USDC (6 decimals), when the transaction moved USDC. */
  usdc: string | null;
  /** Atomic WARD (6 decimals), when the transaction moved WARD. */
  ward: string | null;
  /** USDC per WARD, 6 decimals, when both amounts are known. */
  price: string | null;
  proposal: number | null;
  support: "for" | "against" | null;
  /** Sell requested: when the WARD can be redeemed. */
  unlock_at: string | null;
  signer: string;
  explorer_url: string;
  source: "chain" | "log";
}

export interface TransactionsView {
  account: string;
  transactions: WalletTx[];
  /** False when the indexer could not be read: the list may be missing recent history. */
  complete: boolean;
  explorer_account_url: string;
}

/** One transaction as the indexer lists it. */
export interface IndexedTx {
  hash: string;
  signer: string;
  receiver: string;
  methods: string[];
  /** Block time in nanoseconds. */
  timestampNs: string;
}

export interface Indexer {
  /** Transactions that involve the account, newest first. Throws when the indexer can't be read. */
  list(account: string): Promise<IndexedTx[]>;
}

const EXPLORER = "https://testnet.nearblocks.io";
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const POOL_METHODS = new Set(["request_redeem", "request_withdraw", "redeem", "vote", "propose", "execute", "ft_transfer", "ft_transfer_call"]);

/** Step 2: only transactions that touch our contracts, by receiver and method. Arguments are checked in step 3. */
export function touchesWardline(t: IndexedTx, contracts: { pool: string; usdc: string }): boolean {
  if (!HASH.test(t.hash)) return false;
  if (t.receiver === contracts.usdc) return t.methods.includes("ft_transfer_call");
  if (t.receiver === contracts.pool) return t.methods.some((m) => POOL_METHODS.has(m));
  return false;
}

const b64json = (s: string | undefined): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  } catch {
    return null;
  }
};

/** The pool's own events ("EVENT_JSON:{standard:wardline,...}") in the transaction's receipts. */
function wardlineEvents(result: { receipts_outcome?: Array<{ outcome: { logs: string[] } }> }): Array<{ event: string; data: Array<Record<string, unknown>> }> {
  const out: Array<{ event: string; data: Array<Record<string, unknown>> }> = [];
  for (const r of result.receipts_outcome ?? []) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const e = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard?: string; event: string; data?: Array<Record<string, unknown>> };
        if (e.standard === "wardline" || e.standard === "nep141") out.push({ event: e.event, data: e.data ?? [] });
      } catch {
        // not an event
      }
    }
  }
  return out;
}

const nsToIso = (ns: unknown): string | null => {
  const s = String(ns ?? "").replace(/ns$/, "");
  return /^\d+$/.test(s) ? new Date(Number(BigInt(s) / 1_000_000n)).toISOString() : null;
};

const priceOf = (usdc: string | null, ward: string | null): string | null => (usdc && ward && BigInt(ward) > 0n ? ((BigInt(usdc) * 1_000_000n) / BigInt(ward)).toString() : null);

/**
 * Step 3: confirms one transaction with the RPC and reads what it did. Null when the RPC doesn't know
 * the hash, or the transaction isn't what the indexer said, or it isn't one of ours after all.
 */
export async function confirmTx(rpc: Rpc, t: IndexedTx, account: string, contracts: { pool: string; usdc: string }): Promise<WalletTx | null> {
  let result: any;
  try {
    result = await rpc("tx", { tx_hash: t.hash, sender_account_id: t.signer, wait_until: "FINAL" });
  } catch {
    return null;
  }
  const tx = result?.transaction;
  if (!tx || tx.hash !== t.hash || tx.signer_id !== t.signer || tx.receiver_id !== t.receiver) return null;
  const call = (tx.actions ?? []).map((a: any) => a?.FunctionCall).find((f: any) => f && (t.receiver === contracts.usdc ? f.method_name === "ft_transfer_call" : POOL_METHODS.has(f.method_name)));
  if (!call) return null;
  const args = (b64json(call.args) ?? {}) as Record<string, any>;
  const status = result.status ?? {};
  const failed = status.Failure !== undefined;
  const value = b64json(status.SuccessValue);
  const events = wardlineEvents(result);
  const base = {
    hash: t.hash,
    at: nsToIso(t.timestampNs) ?? new Date(0).toISOString(),
    status: failed ? ("failed" as const) : ("confirmed" as const),
    usdc: null as string | null,
    ward: null as string | null,
    proposal: null as number | null,
    support: null as "for" | "against" | null,
    unlock_at: null as string | null,
    signer: t.signer,
    explorer_url: `${EXPLORER}/txns/${t.hash}`,
    source: "chain" as const,
  };
  const row = (type: TxType, extra: Partial<typeof base> = {}): WalletTx => {
    const r = { ...base, ...extra };
    return { ...r, type, price: priceOf(r.usdc, r.ward) };
  };

  if (t.receiver === contracts.usdc) {
    // A deposit: USDC to the pool, signed by this account. Anything else on USDC isn't ours.
    if (args.receiver_id !== contracts.pool || t.signer !== account) return null;
    const minted = events.find((e) => e.event === "pool_deposited")?.data.find((d) => d.account === account);
    // ft_transfer_call returns the USDC the pool kept; "0" means it all came back.
    const kept = typeof value === "string" ? value : null;
    const refunded = kept === "0";
    return row("buy", { usdc: String(args.amount ?? kept ?? ""), ward: minted ? String(minted.shares ?? minted.ward ?? "") || null : null, status: failed || refunded ? "failed" : "confirmed" });
  }

  const method = call.method_name as string;
  const v = (value ?? {}) as Record<string, any>;
  if (method === "request_redeem" || method === "request_withdraw") {
    if (t.signer !== account) return null;
    return row("sell_request", { ward: String(args.amount ?? v.ward ?? "") || null, usdc: v.value != null ? String(v.value) : null, unlock_at: nsToIso(v.available_at) });
  }
  if (method === "redeem") {
    if (t.signer !== account && args.account !== account) return null;
    const ev = events.find((e) => /redeem/.test(e.event))?.data.find((d) => d.account === account);
    return row("sell", { usdc: v.usdc != null ? String(v.usdc) : ev?.usdc != null ? String(ev.usdc) : null, ward: v.ward != null ? String(v.ward) : ev?.ward != null ? String(ev.ward) : ev?.shares != null ? String(ev.shares) : null });
  }
  if (method === "vote") {
    if (t.signer !== account) return null;
    return row("vote", { proposal: Number(args.id), support: args.support === "against" ? "against" : "for" });
  }
  if (method === "propose") {
    if (t.signer !== account) return null;
    return row("propose", { proposal: typeof value === "number" ? value : null });
  }
  if (method === "execute") {
    if (t.signer !== account) return null;
    return row("execute", { proposal: Number(args.id) });
  }
  if (method === "ft_transfer" || method === "ft_transfer_call") {
    if (t.signer === account) return row("send", { ward: String(args.amount ?? "") || null });
    if (args.receiver_id === account) return row("receive", { ward: String(args.amount ?? "") || null });
    return null;
  }
  return null;
}

/** The scripts' audited rows, in the same shape. They were checked against the chain by the audit. */
export function fromLog(item: ActivityItem, account: string): WalletTx | null {
  if (!item.tx || !HASH.test(item.tx) || item.actor !== account) return null;
  const type: TxType | null =
    item.kind === "deposit" ? "buy" : item.kind === "redeem" ? (item.outcome === "paid" ? "sell" : "sell_request") : item.kind === "vote" ? "vote" : item.kind === "proposal" ? (item.outcome === "executed" ? "execute" : "propose") : null;
  if (!type) return null;
  const proposal = /proposal (\d+)|#(\d+)/i.exec(item.text);
  const usdc = type === "buy" || type === "sell" ? item.amount : null;
  const ward = type === "sell_request" ? item.amount : null;
  return {
    hash: item.tx,
    at: item.at,
    type,
    status: "confirmed",
    usdc,
    ward,
    price: null,
    proposal: proposal ? Number(proposal[1] ?? proposal[2]) : null,
    support: type === "vote" ? (/against/i.test(item.text) ? "against" : "for") : null,
    unlock_at: null,
    signer: account,
    explorer_url: `${EXPLORER}/txns/${item.tx}`,
    source: "log",
  };
}

/** Step 4: one row per hash, the chain's reading first; newest first. */
export function mergeRows(chain: WalletTx[], log: WalletTx[]): WalletTx[] {
  const byHash = new Map<string, WalletTx>();
  for (const r of [...chain, ...log]) if (!byHash.has(r.hash)) byHash.set(r.hash, r);
  return [...byHash.values()].sort((a, b) => b.at.localeCompare(a.at) || a.hash.localeCompare(b.hash));
}

/** Account totals from confirmed rows: what went in, what came out. */
export function totals(rows: WalletTx[]): { deposited: string; redeemed: string } {
  let deposited = 0n;
  let redeemed = 0n;
  for (const r of rows) {
    if (r.status !== "confirmed" || !r.usdc) continue;
    if (r.type === "buy") deposited += BigInt(r.usdc);
    if (r.type === "sell") redeemed += BigInt(r.usdc);
  }
  return { deposited: deposited.toString(), redeemed: redeemed.toString() };
}

/**
 * The NearBlocks testnet API (v3, no key). Lists the account's transactions and its fungible-token
 * moves (for WARD received from others). Calls are spaced at least `gapMs` apart for the free tier.
 */
export function nearblocksIndexer(opts: { base?: string; fetch?: typeof fetch; gapMs?: number; pool: string } ): Indexer {
  const base = opts.base ?? "https://api-testnet.nearblocks.io";
  const get = opts.fetch ?? fetch;
  const gap = opts.gapMs ?? 1_100;
  let next = 0;
  const call = async (path: string): Promise<any> => {
    const wait = next - Date.now();
    next = Math.max(Date.now(), next) + gap;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await get(`${base}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`NearBlocks answered HTTP ${res.status}`);
    return res.json();
  };
  return {
    async list(account) {
      const id = encodeURIComponent(account);
      const txns = (await call(`/v3/accounts/${id}/txns?per_page=50`)) as { data?: any[] };
      if (!Array.isArray(txns.data)) throw new Error("NearBlocks returned no transaction list");
      const out: IndexedTx[] = txns.data.map((t) => ({
        hash: String(t.transaction_hash),
        signer: String(t.signer_account_id),
        receiver: String(t.receiver_account_id),
        methods: (t.actions ?? []).map((a: any) => String(a.method ?? "")).filter(Boolean),
        timestampNs: String(t.block_timestamp ?? t.block?.block_timestamp ?? "0"),
      }));
      // WARD sent to this account by someone else: the indexer's token moves on the pool contract.
      const ft = (await call(`/v3/accounts/${id}/ft-txns?per_page=50`).catch(() => ({ data: [] }))) as { data?: any[] };
      for (const m of ft.data ?? []) {
        if (m.contract_account_id !== opts.pool || !(BigInt(String(m.delta_amount ?? "0")) > 0n) || !m.transaction_hash) continue;
        if (out.some((t) => t.hash === m.transaction_hash)) continue;
        out.push({ hash: String(m.transaction_hash), signer: String(m.involved_account_id ?? ""), receiver: opts.pool, methods: ["ft_transfer"], timestampNs: String(m.block_timestamp ?? "0") });
      }
      return out;
    },
  };
}

/** Steps 1 to 4 with a per-account cache, and the last confirmed rows kept for when the indexer is down. */
export class AccountTransactions {
  private readonly cache = new Map<string, { at: number; value: Promise<TransactionsView> }>();
  private readonly lastGood = new Map<string, WalletTx[]>();
  private readonly confirmed = new Map<string, WalletTx | null>();

  constructor(
    private readonly o: { indexer: Indexer; rpc: Rpc; contracts: { pool: string; usdc: string }; log: (account: string) => ActivityItem[]; ttlMs?: number; now?: () => number },
  ) {}

  /**
   * pending: hashes a page just sent. If the cached answer lacks one, it is read again, at most every
   * 4 seconds, so a new row turns confirmed without waiting out the 30-second cache.
   */
  async get(account: string, pending: string[] = []): Promise<TransactionsView> {
    const now = this.o.now?.() ?? Date.now();
    const hit = this.cache.get(account);
    if (hit && now - hit.at < (this.o.ttlMs ?? 30_000)) {
      if (pending.length === 0 || now - hit.at < 4_000) return hit.value;
      const known = new Set((await hit.value).transactions.map((r) => r.hash));
      if (pending.every((h) => known.has(h))) return hit.value;
    }
    const value = this.load(account);
    this.cache.set(account, { at: now, value });
    value.catch(() => this.cache.delete(account));
    return value;
  }

  private async load(account: string): Promise<TransactionsView> {
    const log = this.o.log(account).map((i) => fromLog(i, account)).filter((r): r is WalletTx => r !== null);
    let chain: WalletTx[];
    let complete = true;
    try {
      const listed = (await this.o.indexer.list(account)).filter((t) => touchesWardline(t, this.o.contracts));
      chain = [];
      for (const t of listed) {
        // A confirmed transaction never changes, so each hash is read from the RPC once.
        if (!this.confirmed.has(t.hash) || this.confirmed.get(t.hash) === null) this.confirmed.set(t.hash, await confirmTx(this.o.rpc, t, account, this.o.contracts));
        const row = this.confirmed.get(t.hash);
        if (row) chain.push(row);
      }
      this.lastGood.set(account, chain);
    } catch {
      chain = this.lastGood.get(account) ?? [];
      complete = false;
    }
    return { account, transactions: mergeRows(chain, log), complete, explorer_account_url: `${EXPLORER}/address/${account}` };
  }
}
