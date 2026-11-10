import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { createChain, defaultSimSeed } from "../src/chain/index.js";
import { toDateClock } from "../src/time.js";
import { LOCAL_AUTH } from "./helpers.js";

const START = Date.parse("2026-11-09T12:00:00Z");
let nowMs = START;
const clock = () => BigInt(nowMs) * 1_000_000n;

function setup() {
  nowMs = START;
  const chain = createChain("sim", toDateClock(clock), defaultSimSeed());
  const deps = bootstrap(":memory:", clock, {}, LOCAL_AUTH, {
    env: { WARDLINE_CHAIN_MODE: "sim" },
    chain,
  });
  return { deps, app: createApp(deps) };
}

describe("activity routes", () => {
  it("GET /v1/activity returns paginated activity feed with total", async () => {
    const { app } = setup();
    const res = await app.request("/v1/activity?limit=10&offset=0");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { activity: any[]; total: number; limit: number; offset: number };
    expect(Array.isArray(data.activity)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(data.limit).toBe(10);
    expect(data.offset).toBe(0);

    if (data.activity.length > 0) {
      const first = data.activity[0];
      expect(first).toHaveProperty("at");
      expect(first).toHaveProperty("kind");
      expect(first).toHaveProperty("side");
      expect(first).toHaveProperty("text");
    }
  });

  it("GET /v1/activity/stats returns summary totals and price history", async () => {
    const { app } = setup();
    const res = await app.request("/v1/activity/stats");
    expect(res.status).toBe(200);

    const stats = (await res.json()) as any;
    expect(stats).toHaveProperty("total_pooled");
    expect(stats).toHaveProperty("ward_price");
    expect(stats).toHaveProperty("yield_earned");
    expect(stats).toHaveProperty("paid_above");
    expect(stats).toHaveProperty("kept_below");
    expect(stats.kept_below).toHaveProperty("swapped");
    expect(stats.kept_below).toHaveProperty("lookalike");
    expect(stats.kept_below).toHaveProperty("capped");
    expect(stats.kept_below).toHaveProperty("total");
    expect(Array.isArray(stats.price_history)).toBe(true);
  });

  it("GET /v1/communities lists communities with budgets and reputation", async () => {
    const { app } = setup();
    const res = await app.request("/v1/communities");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { communities: any[] };
    expect(Array.isArray(data.communities)).toBe(true);
    expect(data.communities.length).toBeGreaterThan(0);

    const first = data.communities[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("budget");
    expect(first).toHaveProperty("tier");
  });

  it("GET /v1/communities/:id returns community with recent activity", async () => {
    const { app } = setup();
    const listRes = await app.request("/v1/communities");
    const listData = (await listRes.json()) as { communities: any[] };
    const targetId = listData.communities[0].id;

    const res = await app.request(`/v1/communities/${targetId}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { community: any; recent_activity: any[] };
    expect(data.community.id).toBe(targetId);
    expect(Array.isArray(data.recent_activity)).toBe(true);

    const notFoundRes = await app.request("/v1/communities/nonexistent_community");
    expect(notFoundRes.status).toBe(404);
  });

  it("GET /v1/people/:account returns person position, votes and history", async () => {
    const { app } = setup();
    const res = await app.request("/v1/people/alice.testnet");
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.account).toBe("alice.testnet");
    expect(data).toHaveProperty("position");
    expect(data).toHaveProperty("mutual");
    expect(data).toHaveProperty("votes");
    expect(data).toHaveProperty("weights");
    expect(Array.isArray(data.history)).toBe(true);

    // Invalid account syntax check
    const badRes = await app.request("/v1/people/INVALID%20ACCOUNT!");
    expect(badRes.status).toBe(400);
  });
});
