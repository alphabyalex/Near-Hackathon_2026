import type { ParsedAccount } from "../caip.js";
import { PAYEE_CHECK_CONFIG } from "../config.js";
import type { ChainSignals, SignalsProvider } from "../types.js";
import { LruCache, type SignalsCache } from "./cache.js";
import { NearRpcClient, RpcFailure, type NearRpcOptions } from "./near-rpc.js";

const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const NS_PER_DAY = 86_400_000_000_000n;

export const UNSUPPORTED_SIGNALS: ChainSignals = {
  supported: false,
  accountExists: null,
  createdAtBlock: null,
  ageDays: null,
  fullAccessKeysAddedLast7d: null,
  codeChangedLast7d: null,
  hasContract: null,
};

export const UNAVAILABLE_SIGNALS: ChainSignals = { ...UNSUPPORTED_SIGNALS, supported: true };

/** Signals for chains we do not read: registry and look-alike checks only. */
export const unsupportedSignalsProvider: SignalsProvider = {
  async getSignals() {
    return UNSUPPORTED_SIGNALS;
  },
};

interface AccountState {
  exists: boolean;
  code_hash: string | null;
}
interface Window {
  headHeight: number;
  headTsNs: string;
  pastHeight: number;
  /** Measured seconds per block over the window. */
  secondsPerBlock: number;
}
interface Creation {
  height: number;
  tsNs: string;
}

export interface NearSignalsOptions {
  /** Network this provider reads: accounts on other NEAR networks get SIGNALS_UNAVAILABLE. */
  network: string;
  rpc: NearRpcClient | NearRpcOptions;
  cache?: SignalsCache;
}

/**
 * NEAR on-chain signals over JSON-RPC.
 * Uncached cost per account: 2 calls for current state, 2 for the 7-day window (shared by all
 * accounts for 10 minutes), 1 to 2 for the state a week ago, and about 20 to 28 for the creation
 * search (cached forever). Any failure leaves the affected fields null. Never throws.
 */
export class NearSignalsProvider implements SignalsProvider {
  readonly rpc: NearRpcClient;
  private readonly cache: SignalsCache;
  private readonly cfg = PAYEE_CHECK_CONFIG;

  constructor(private readonly opts: NearSignalsOptions) {
    this.rpc = opts.rpc instanceof NearRpcClient ? opts.rpc : new NearRpcClient(opts.rpc);
    this.cache = opts.cache ?? new LruCache(this.cfg.cache.lruMaxEntries);
  }

  async getSignals(account: ParsedAccount): Promise<ChainSignals> {
    if (account.namespace !== "near") return UNSUPPORTED_SIGNALS;
    if (account.reference !== this.opts.network) return UNAVAILABLE_SIGNALS;
    try {
      return await this.compute(account.address);
    } catch {
      return UNAVAILABLE_SIGNALS;
    }
  }

  private key(...parts: Array<string | number>): string {
    return ["near", this.opts.network, ...parts].join(":");
  }

  private async cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get(key);
    if (hit !== undefined && hit !== null) return hit as T;
    const v = await fn();
    await this.cache.set(key, v, ttlMs);
    return v;
  }

  private async compute(id: string): Promise<ChainSignals> {
    const recent = this.cfg.cache.recentTtlMs;
    const now = await this.cached(this.key("account", id), recent, () => this.viewAccount(id, null));
    if (!now.exists) return { ...UNAVAILABLE_SIGNALS, accountExists: false };
    const out: ChainSignals = { ...UNAVAILABLE_SIGNALS, accountExists: true, hasContract: now.code_hash !== EMPTY_CODE_HASH };

    let window: Window | null = null;
    try {
      window = await this.cached(this.key("window"), recent, () => this.findWindow());
    } catch {
      return out;
    }

    let existedWeekAgo: boolean | null = null;
    try {
      const w = window;
      const past = await this.cached(this.key("past", id, w.pastHeight), recent, () => this.viewAccount(id, w.pastHeight));
      existedWeekAgo = past.exists;
      out.codeChangedLast7d = past.exists ? past.code_hash !== now.code_hash : out.hasContract;
      const keysNow = await this.cached(this.key("keys", id), recent, () => this.fullAccessKeys(id, null));
      const keysThen = past.exists ? await this.cached(this.key("keys", id, w.pastHeight), recent, () => this.fullAccessKeys(id, w.pastHeight)) : [];
      const before = new Set(keysThen);
      out.fullAccessKeysAddedLast7d = keysNow.filter((k) => !before.has(k)).length;
    } catch {
      // keys and code stay null
    }

    try {
      const w = window;
      const created = await this.cached(this.key("created", id), this.cfg.cache.creationTtlMs, () => this.findCreation(id, w, existedWeekAgo));
      out.createdAtBlock = created.height;
      const ageNs = BigInt(w.headTsNs) - BigInt(created.tsNs);
      out.ageDays = Math.round((Number((ageNs * 1000n) / NS_PER_DAY) / 1000) * 100) / 100;
    } catch {
      // creation stays null
    }
    return out;
  }

  private async viewAccount(id: string, height: number | null): Promise<AccountState> {
    const at = height === null ? { finality: "final" } : { block_id: height };
    const r = await this.rpc.call<{ code_hash: string }>("query", { request_type: "view_account", account_id: id, ...at }, height !== null);
    if (r.ok) return { exists: true, code_hash: r.result.code_hash };
    if (r.kind === "UNKNOWN_ACCOUNT") return { exists: false, code_hash: null };
    throw new RpcFailure(`view_account ${id}: ${r.message}`);
  }

  private async fullAccessKeys(id: string, height: number | null): Promise<string[]> {
    const at = height === null ? { finality: "final" } : { block_id: height };
    const r = await this.rpc.call<{ keys: Array<{ public_key: string; access_key: { permission: unknown } }> }>(
      "query",
      { request_type: "view_access_key_list", account_id: id, ...at },
      height !== null,
    );
    if (!r.ok) throw new RpcFailure(`view_access_key_list ${id}: ${r.message}`);
    return r.result.keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
  }

  private async block(height: number | null): Promise<{ height: number; tsNs: string } | "MISSING"> {
    const r = await this.rpc.call<{ header: { height: number; timestamp_nanosec: string } }>("block", height === null ? { finality: "final" } : { block_id: height }, height !== null);
    if (r.ok) return { height: r.result.header.height, tsNs: r.result.header.timestamp_nanosec };
    if (r.kind === "UNKNOWN_BLOCK") return "MISSING";
    throw new RpcFailure(`block ${height ?? "final"}: ${r.message}`);
  }

  /** Nearest existing block at or above height (heights can be skipped). */
  private async blockNear(height: number): Promise<{ height: number; tsNs: string }> {
    for (let i = 0; i <= this.cfg.rpc.skippedHeightProbes; i++) {
      const b = await this.block(height + i);
      if (b !== "MISSING") return b;
    }
    throw new RpcFailure(`no block near height ${height}`);
  }

  /** Head and the height about recentWindowDays ago, calibrated on real timestamps (2 calls). */
  private async findWindow(): Promise<Window> {
    const head = await this.block(null);
    if (head === "MISSING") throw new RpcFailure("no final block");
    const windowSec = this.cfg.recentWindowDays * 86_400;
    const guess = await this.blockNear(head.height - Math.round(windowSec / this.cfg.rpc.nearBlockTimeSecondsGuess));
    const spb = Number(BigInt(head.tsNs) - BigInt(guess.tsNs)) / 1e9 / (head.height - guess.height);
    if (!(spb > 0.05 && spb < 30)) throw new RpcFailure(`implausible block time ${spb}`);
    return { headHeight: head.height, headTsNs: head.tsNs, pastHeight: head.height - Math.round(windowSec / spb), secondsPerBlock: spb };
  }

  /** Account exists at height h? Steps over skipped heights, staying below `limit`. */
  private async existsAt(id: string, h: number, limit: number): Promise<boolean> {
    for (let i = 0; i <= this.cfg.rpc.skippedHeightProbes && h + i < limit; i++) {
      const r = await this.rpc.call<unknown>("query", { request_type: "view_account", account_id: id, block_id: h + i }, true);
      if (r.ok) return true;
      if (r.kind === "UNKNOWN_ACCOUNT") return false;
      if (r.kind === "FAILED") throw new RpcFailure(r.message);
    }
    throw new RpcFailure(`no queryable block near ${h}`);
  }

  /**
   * Binary search for the first height where the account exists. Bounds use what we already know:
   * absent a week ago means search only the last week; present a week ago, probe 30 days back first.
   * Assumes the account was not deleted and recreated in between.
   */
  private async findCreation(id: string, w: Window, existedWeekAgo: boolean | null): Promise<Creation> {
    const genesis = this.cfg.rpc.genesisHeight[this.opts.network] ?? 0;
    let lo: number;
    let hi: number;
    if (existedWeekAgo === false) {
      lo = w.pastHeight;
      hi = w.headHeight;
    } else {
      const h30 = w.headHeight - Math.round((this.cfg.newAccountDays * 86_400) / w.secondsPerBlock);
      hi = existedWeekAgo === true ? w.pastHeight : w.headHeight;
      if (h30 > genesis && !(await this.existsAt(id, h30, hi))) lo = h30;
      else {
        if (h30 > genesis) hi = h30;
        lo = genesis - 1;
      }
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (await this.existsAt(id, mid, hi)) hi = mid;
      else lo = mid;
    }
    const b = await this.blockNear(hi);
    return { height: hi, tsNs: b.tsNs };
  }
}
