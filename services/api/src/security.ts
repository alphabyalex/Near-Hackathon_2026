/**
 * Cross-cutting protections for the public API: security headers, body size limits and per-IP rate
 * limits. Verification and settlement logic is untouched; these only refuse requests earlier.
 *
 *   WARDLINE_HSTS=true          send Strict-Transport-Security (set it when served over HTTPS)
 *   WARDLINE_TRUST_PROXY=true   take the client IP from cf-connecting-ip or x-forwarded-for
 *   WARDLINE_RATE_LIMIT=off     turn the per-IP limits off (load tests only)
 */
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

type Env = Record<string, string | undefined>;

/** The caller's IP: the socket address, or the proxy's header when WARDLINE_TRUST_PROXY=true. */
export function clientIp(c: Context, env: Env): string {
  if (env.WARDLINE_TRUST_PROXY === "true") {
    const forwarded = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "local";
}

/** API responses are JSON: nothing may load, frame or sniff them. */
export function securityHeaders(env: Env): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (env.WARDLINE_HSTS === "true") c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  };
}

/** Request bodies: 1 MB for model calls through /v1/ai, 64 KB for anything else. Checked before parsing. */
export const BODY_LIMITS = { ai: 1_048_576, other: 65_536 } as const;

export function bodyLimits(): MiddlewareHandler {
  const tooLarge = (max: number) => (c: Context) => c.json({ error: "PAYLOAD_TOO_LARGE", message: `Request bodies are limited to ${max} bytes.` }, 413);
  // hono/body-limit counts streamed bytes too, so a chunked body without a length header is capped as it arrives.
  const ai = bodyLimit({ maxSize: BODY_LIMITS.ai, onError: tooLarge(BODY_LIMITS.ai) });
  const other = bodyLimit({ maxSize: BODY_LIMITS.other, onError: tooLarge(BODY_LIMITS.other) });
  return (c, next) => (c.req.path.startsWith("/v1/ai/") ? ai(c, next) : other(c, next));
}

class Buckets {
  private readonly map = new Map<string, { tokens: number; at: number }>();
  take(key: string, perMinute: number, now: number): number {
    const b = this.map.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
    b.at = now;
    let wait = 0;
    if (b.tokens >= 1) b.tokens -= 1;
    else wait = Math.ceil(((1 - b.tokens) / perMinute) * 60);
    this.map.set(key, b);
    if (this.map.size > 50_000) this.map.clear(); // a flood of new IPs cannot grow this without bound
    return wait;
  }
}

/** Per-IP limits per minute for the public routes. Model calls are limited per meter key in the gateway. */
export const RATE_LIMITS: { name: string; method?: string; match: RegExp; perMinute: number }[] = [
  { name: "demo", method: "POST", match: /^\/v1\/demo\//, perMinute: 12 },
  { name: "mutual-write", method: "POST", match: /^\/v1\/(pool\/(challenge|submit)|mutual\/proposals\/[^/]+\/execute)$/, perMinute: 30 },
  { name: "read", method: "GET", match: /^\/(v1\/(pool|mutual|groups|reputation|proofs|ai-registry)|overview|usage|evaluations)/, perMinute: 240 },
];

export function rateLimits(env: Env, now: () => number = Date.now): MiddlewareHandler {
  const buckets = new Buckets();
  return async (c, next) => {
    if (env.WARDLINE_RATE_LIMIT === "off") return next();
    const rule = RATE_LIMITS.find((r) => (!r.method || r.method === c.req.method) && r.match.test(c.req.path));
    if (!rule) return next();
    const wait = buckets.take(`${rule.name}:${clientIp(c, env)}`, rule.perMinute, now());
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return c.json({ error: "RATE_LIMITED", message: `Too many requests. Try again in ${wait} seconds.` }, 429);
    }
    return next();
  };
}
