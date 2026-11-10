import type { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../service.js";
import { ActivityStore } from "./store.js";

const AccountSchema = z.string().min(2).max(64).regex(/^[a-z0-9._-]+$/, "Not a valid NEAR account id.");

export function registerActivityRoutes(app: Hono, deps: Deps): void {
  const store = new ActivityStore(deps);

  /**
   * GET /v1/activity
   * Paginated feed with optional filters by community, person/actor, kind, outcome and side.
   */
  app.get("/v1/activity", async (c) => {
    const query = c.req.query();
    const limit = Math.min(Math.max(parseInt(query.limit || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);

    let items = store.readLog();

    if (query.community) {
      const qComm = query.community.toLowerCase();
      items = items.filter((i) => (i.community || "").toLowerCase() === qComm);
    }
    const target = query.person || query.actor;
    if (target) {
      const qActor = target.toLowerCase();
      items = items.filter((i) => (i.actor || "").toLowerCase() === qActor);
    }
    if (query.kind) {
      const qKind = query.kind.toLowerCase();
      items = items.filter((i) => (i.kind || "").toLowerCase() === qKind);
    }
    if (query.outcome) {
      const qOutcome = query.outcome.toLowerCase();
      items = items.filter((i) => (i.outcome || "").toLowerCase() === qOutcome);
    }
    if (query.side) {
      const qSide = query.side.toLowerCase();
      items = items.filter((i) => (i.side || "").toLowerCase() === qSide);
    }

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);

    return c.json({
      activity: paginated,
      total,
      limit,
      offset,
    });
  });

  /**
   * GET /v1/activity/stats
   * Summary totals, WARD price series, paid above the line, kept below by reason, fees and claims.
   */
  app.get("/v1/activity/stats", async (c) => {
    try {
      const stats = await store.getStats();
      return c.json(stats);
    } catch (err: any) {
      return c.json({ error: "Failed to compute activity stats", detail: err.message }, 500);
    }
  });

  /**
   * GET /v1/communities
   * All communities with members, budgets, reputation tiers, call history and fees.
   */
  app.get("/v1/communities", async (c) => {
    try {
      const communities = await store.getCommunities();
      return c.json({ communities });
    } catch (err: any) {
      return c.json({ error: "Failed to list communities", detail: err.message }, 500);
    }
  });

  /**
   * GET /v1/communities/:id
   * Single community view with recent activity.
   */
  app.get("/v1/communities/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const res = await store.getCommunity(id);
      if (!res.community) {
        return c.json({ error: "Community not found", id }, 404);
      }
      return c.json(res);
    } catch (err: any) {
      return c.json({ error: "Failed to get community", detail: err.message }, 500);
    }
  });

  /**
   * GET /v1/people/:account
   * An individual's or member's history, position and WARD governance.
   */
  app.get("/v1/people/:account", async (c) => {
    const accountParam = c.req.param("account");
    const parsed = AccountSchema.safeParse(accountParam);
    if (!parsed.success) {
      return c.json({ error: "Invalid NEAR account id", detail: parsed.error.issues[0]?.message }, 400);
    }

    try {
      const person = await store.getPerson(parsed.data);
      return c.json(person);
    } catch (err: any) {
      return c.json({ error: "Failed to get person profile", detail: err.message }, 500);
    }
  });
}
