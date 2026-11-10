import { afterEach, describe, expect, it, vi } from "vitest";
import { getActivity, getActivityStats } from "../src/data/activity";
import { getCommunities } from "../src/data/groups";
import { getPerson } from "../src/data/people";

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
      "/v1/activity/stats": {
        total_items: 24,
        pooled_usdc: "350000",
        ward_price: "1000000",
        fees_earned_usdc: "4800",
        claims_paid_usdc: "50000",
        paid_above_line: 18,
        kept_below_line: 6,
        below: { swapped: 2, lookalike: 2, capped: 2, total: 6 },
        price_series: [],
      },
    });

    const stats = await getActivityStats();
    expect(stats.total_items).toBe(24);
    expect(stats.ward_price).toBe("1000000");
    expect(stats.paid_above_line).toBe(18);
    expect(stats.kept_below_line).toBe(6);
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
});
