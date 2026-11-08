/**
 * Cache behind an interface so the API can plug in sqlite. Values are JSON-serializable.
 * Methods may be sync or async.
 */
export interface SignalsCache {
  get(key: string): unknown | Promise<unknown>;
  /** ttlMs may be Infinity. */
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
}

/** Default in-memory LRU with per-entry expiry. Browser and Node safe. */
export class LruCache implements SignalsCache {
  private readonly map = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 2_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): unknown {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
