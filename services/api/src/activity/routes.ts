import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../service.js";
import { ActivityNotAudited, ActivityStore } from "./store.js";

const AccountSchema = z.string().min(2).max(64).regex(/^[a-z0-9._-]+$/, "Not a valid NEAR account id.");

/** 503 when near mode would serve an unaudited log; anything else is a 500 with its message. */
function failed(c: Context, what: string, err: unknown): Response {
  if (err instanceof ActivityNotAudited) {
    return c.json({ error: err.code, message: `${err.message} Run pnpm testnet:audit.` }, 503);
  }
  return c.json({ error: `Failed to ${what}`, detail: err instanceof Error ? err.message : String(err) }, 500);
}

export function registerActivityRoutes(app: Hono, deps: Deps, env: Record<string, string | undefined> = process.env): void {
  const store = new ActivityStore(deps, env);

  /**
   * GET /v1/activity
   * Audited testnet activity, newest first, with optional filters by community, person/actor, kind,
   * outcome and side. Every row is a transaction on NEAR testnet, with an explorer link.
   */
  app.get("/v1/activity", (c) => {
    const query = c.req.query();
    const limit = Math.min(Math.max(parseInt(query.limit || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);

    let items;
    try {
      items = store.readLog();
    } catch (err) {
      return failed(c, "read activity", err);
    }
    const eq = (a: string | undefined, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();
    if (query.community) items = items.filter((i) => eq(i.community, query.community!));
    const target = query.person || query.actor;
    if (target) items = items.filter((i) => eq(i.actor, target));
    if (query.kind) items = items.filter((i) => eq(i.kind, query.kind!));
    if (query.outcome) items = items.filter((i) => eq(i.outcome, query.outcome!));
    if (query.side) items = items.filter((i) => eq(i.side, query.side!));

    return c.json({ activity: items.slice(offset, offset + limit), total: items.length, limit, offset });
  });

  /** GET /v1/activity/stats: totals from chain views (pool, claims, reputations). */
  app.get("/v1/activity/stats", async (c) => {
    try {
      return c.json(await store.getStats());
    } catch (err) {
      return failed(c, "compute activity stats", err);
    }
  });

  /** GET /v1/communities: every budget's reputation and treasury, from the meter. */
  app.get("/v1/communities", async (c) => {
    try {
      return c.json({ communities: await store.getCommunities() });
    } catch (err) {
      return failed(c, "list communities", err);
    }
  });

  /** GET /v1/communities/:id: one community with its recent audited activity. */
  app.get("/v1/communities/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const res = await store.getCommunity(id);
      if (!res.community) return c.json({ error: "Community not found", id }, 404);
      return c.json(res);
    } catch (err) {
      return failed(c, "get community", err);
    }
  });

  /** GET /v1/people/:account: the pool's record of one account, its WARD votes and audited history. */
  app.get("/v1/people/:account", async (c) => {
    const parsed = AccountSchema.safeParse(c.req.param("account"));
    if (!parsed.success) return c.json({ error: "Invalid NEAR account id", detail: parsed.error.issues[0]?.message }, 400);
    try {
      return c.json(await store.getPerson(parsed.data));
    } catch (err) {
      return failed(c, "get person profile", err);
    }
  });
}
