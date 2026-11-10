import { afterEach, describe, expect, it, vi } from "vitest";
import { getActivity, getActivityStats } from "../src/data/activity";
import { getCommunities, getGroups } from "../src/data/groups";
import { getPerson } from "../src/data/people";
import { getProofs } from "../src/data/proofs";

function stubFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.replace(/^http:\/\/[^/]+/, "").replace(/^\/api/, "");
    if (path in routes) {
      return new Response(JSON.stringify(routes[path]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Match query-string prefix
    const basePath = path.split("?")[0]!;
    if (basePath in routes) {
      return new Response(JSON.stringify(routes[basePath]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "NOT_FOUND", message: `Not found: ${path}` }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("data layer (sim and testnet parity)", () => {
  it("getActivity returns sorted items in sim mode", async () => {
    stubFetch({
      "/v1/proofs": {
        mode: "sim",
        proofs: [
          {
            call_id: "c1",
            budget_id: "bgt_aurora",
            group: "Aurora Lab",
            side: "above",
            status: "verified",
            reason: null,
            model_claimed: "deepseek",
            model_proven: "deepseek",
            amount: "15000",
            refund: "0",
            created_at: "2026-11-10T02:00:00Z",
          },
        ],
      },
      "/v1/mutual": {
        pool: {
          tvl: "350000",
          junior: "250000",
          senior: "100000",
          ward_supply: "100000",
          ward_price: "1000000",
          launch_price: "1000000",
          fees_earned: "0",
          claims_paid: "0",
          price_history: [],
        },
        claims: [
          {
            id: 0,
            subject: "test incident",
            claimant: "aurora.dao",
            amount: "50000",
            filed_at: "2026-11-10T01:00:00Z",
            status: "paid",
            tx: "tx_claim_0",
          },
        ],
        governance: { proposals: [] },
      },
    });

    const items = await getActivity(10);
    expect(items.length).toBe(2);
    expect(items[0]?.kind).toBe("call");
    expect(items[0]?.side).toBe("above");
    expect(items[1]?.kind).toBe("payout");
    expect(items[1]?.side).toBe("below");
  });

  it("getActivityStats reads from /v1/activity/stats", async () => {
    stubFetch({
      // The shape services/api/src/activity/store.ts returns: every number from chain views.
      "/v1/activity/stats": {
        total_pooled: "900104",
        ward_price: "1000262",
        launch_price: "1000000",
        yield_earned: "104",
        groups_covered: 10,
        proven_payments: 36,
        payouts: 1,
        price_history: [],
        below: { swapped: 1, lookalike: 0, capped: 3, total: 4 },
        paid_above: 36,
        fees_earned: "104",
        claims: { count: 1, total: "50000" },
      },
    });

    const stats = await getActivityStats();
    expect(stats.total_pooled).toBe("900104");
    expect(stats.ward_price).toBe("1000262");
    expect(stats.paid_above).toBe(36);
    expect(stats.below.total).toBe(4);
  });

  it("getCommunities reads list of communities from /v1/communities", async () => {
    stubFetch({
      "/v1/communities": {
        communities: [
          {
            id: "bgt_mission",
            budget_id: "bgt_mission",
            name: "Mission Street hacker house",
            owner: "mission-dao.wardline-labs.testnet",
            members: ["dana.testnet", "eli.testnet"],
            tier: "gold",
            fee_bps: 100,
            coverage_cap: "100000000",
            deposit: "40000000",
            spent: "45000",
            proven_calls: 10,
            clean_calls: 10,
            refused_calls: 0,
            capped_calls: 0,
            blocked_payees: 0,
            fees_paid: "450",
            budget: { deposit: "40000000", spent: "45000", reserved: "0", period: "week" },
          },
        ],
      },
    });

    const list = await getCommunities();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe("bgt_mission");
    expect(list[0]?.tier).toBe("gold");
    expect(list[0]?.fee_bps).toBe(100);
  });

  it("getPerson retrieves position and votes for account", async () => {
    stubFetch({
      "/v1/mutual": {
        pool: {
          tvl: "350000",
          junior: "250000",
          senior: "100000",
          ward_supply: "100000",
          ward_price: "1000000",
          launch_price: "1000000",
          fees_earned: "0",
          claims_paid: "0",
          price_history: [],
        },
        claims: [],
        governance: {
          proposals: [
            {
              id: 0,
              proposer: "admin",
              description: "Test proposal",
              status: "open",
              votes_for: "0",
              votes_against: "0",
            },
          ],
        },
      },
      "/v1/pool/positions/alice.testnet": {
        account: "alice.testnet",
        ward: "25000000",
        ward_locked: "0",
        value: "25000000",
        pending_withdrawals: [],
        deposited: "25000000",
        redeemed: "0",
        joined_at: "2026-11-10T00:00:00Z",
      },
      "/v1/mutual/votes/alice.testnet": {
        account: "alice.testnet",
        votes: [{ id: 0, support: "for", weight: "25000000" }],
      },
      "/v1/mutual/proposals/0/weight/alice.testnet": {
        weight: "25000000",
      },
    });

    const person = await getPerson("alice.testnet");
    expect(person.account).toBe("alice.testnet");
    expect(person.position.ward).toBe("25000000");
    expect(person.votes.length).toBe(1);
    expect(person.votes[0]?.support).toBe("for");
    expect(person.weights[0]).toBe("25000000");
  });

  it("getGroups retrieves group list and tier rules", async () => {
    stubFetch({
      "/v1/groups": {
        mode: "sim",
        groups: [
          {
            budget_id: "bgt_aurora",
            name: "Aurora Lab",
            owner: "aurora.dao",
            tier: "bronze",
            deposit: "25000000",
            members: 3,
            period: "week",
            proven_calls: 12,
            clean_calls: 12,
            refused_calls: 0,
            capped_calls: 0,
            blocked_payees: 0,
            claims: 0,
            next_tier_at: 20,
            fee_bps: 200,
            coverage_cap: "25000000",
            spent: "50000",
            fees_paid: "1000",
          },
        ],
        tiers: {
          coverage_multiplier_bps: 10000,
          rules: [
            { tier: "bronze", fee_bps: 200, coverage: "25000000", promote_after: 10 },
            { tier: "silver", fee_bps: 150, coverage: "50000000", promote_after: 25 },
            { tier: "gold", fee_bps: 100, coverage: "100000000", promote_after: null },
          ],
        },
      },
    });

    const res = await getGroups();
    expect(res.groups.length).toBe(1);
    expect(res.groups[0]?.name).toBe("Aurora Lab");
    expect(res.groups[0]?.tier).toBe("bronze");
    expect(res.tiers.rules.length).toBe(3);
  });

  it("getProofs retrieves metered calls and handles tx link", async () => {
    stubFetch({
      "/v1/proofs": {
        mode: "sim",
        proofs: [
          {
            call_id: "call_abc123",
            budget_id: "bgt_mission",
            group: "Mission House",
            side: "above",
            status: "verified",
            reason: null,
            model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            amount: "15000",
            refund: "0",
            created_at: "2026-11-10T04:00:00Z",
            tx: "8fQG9z7N2dK283j8H1V5bE8J34f78kH283j8H1V5bE8J",
          },
        ],
      },
    });

    const res = await getProofs(5);
    expect(res.proofs.length).toBe(1);
    expect(res.proofs[0]?.call_id).toBe("call_abc123");
    expect(res.proofs[0]?.side).toBe("above");
    expect(res.proofs[0]?.tx).toBe("8fQG9z7N2dK283j8H1V5bE8J34f78kH283j8H1V5bE8J");
  });
});
