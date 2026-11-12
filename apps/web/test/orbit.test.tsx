/** The Groups orbit: depth scaling, turning to the front, solo detection and filter counts. */
import { describe, expect, it } from "vitest";
import type { GroupSummary } from "../src/api/ai";
import { depthOf, filterCounts, filterEntries, hitBody, isSolo, ORBIT_MOTION, orbitAngle, orbitBodies, orbitFrame, shortestDelta, toEntries, type OrbitState } from "../src/v2/GroupsOrbit";

const group = (budget_id: string, name: string, proven_calls: number, members: number, tier: "bronze" | "silver" | "gold" = "bronze"): GroupSummary => ({
  budget_id,
  name,
  owner: `${budget_id}.testnet`,
  tier,
  proven_calls,
  refused_calls: 0,
  capped_calls: 0,
  blocked_payees: 0,
  claims: 0,
  clean_calls: proven_calls,
  next_tier_at: tier === "gold" ? null : 10,
  fee_bps: 200,
  coverage_cap: "0",
  spent: "0",
  fees_paid: "0",
  deposit: "0",
  members,
  period: "week",
});

const GROUPS = [
  group("bgt_kelp", "Kelp Collective", 12, 2, "silver"),
  group("bgt_mission", "Mission Street hacker house", 66, 3, "gold"),
  group("bgt_ind_ivan", "Ivan (solo)", 3, 1),
  group("bgt_hayes", "Hayes Valley house", 26, 2, "silver"),
  group("bgt_ind_lucas", "Lucas (solo)", 0, 1),
];

const at = (pos: number, sel: number, extra: Partial<OrbitState> = {}): OrbitState => ({ pos, sel, leaving: -1, turn: 1, arrive: 1, ...extra });

describe("the orbit's entries", () => {
  it("ranks by proven calls and tells solo builders from groups", () => {
    const e = toEntries(GROUPS);
    expect(e.map((x) => x.id)).toEqual(["bgt_mission", "bgt_hayes", "bgt_kelp", "bgt_ind_ivan", "bgt_ind_lucas"]);
    expect(e.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(e.filter((x) => x.solo).map((x) => x.name)).toEqual(["Ivan", "Lucas"]);
    expect(isSolo({ members: 1, budget_id: "bgt_x", name: "X" })).toBe(true);
    expect(isSolo({ members: 2, budget_id: "bgt_ind_y", name: "Y" })).toBe(true);
    expect(isSolo({ members: 2, budget_id: "bgt_z", name: "Z" })).toBe(false);
  });

  it("filters and counts all, groups and solo builders, keeping network ranks", () => {
    const e = toEntries(GROUPS);
    expect(filterCounts(e)).toEqual({ all: 5, groups: 3, solo: 2 });
    expect(filterEntries(e, "all")).toHaveLength(5);
    expect(filterEntries(e, "groups").map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(filterEntries(e, "solo").map((x) => x.rank)).toEqual([4, 5]);
    expect(filterCounts([])).toEqual({ all: 0, groups: 0, solo: 0 });
  });
});

describe("turning the orbit", () => {
  it("takes the shortest way round", () => {
    expect(shortestDelta(0, 1, 10)).toBe(1);
    expect(shortestDelta(0, 9, 10)).toBe(-1);
    expect(shortestDelta(8, 1, 10)).toBe(3);
    expect(shortestDelta(2, 2, 10)).toBe(0);
    expect(Math.abs(shortestDelta(0, 5, 10))).toBe(5);
  });

  it("puts body k at the front when the position is k, with the next body to its right", () => {
    const n = 10;
    expect(depthOf(orbitAngle(3, 3, n))).toBeCloseTo(1);
    expect(depthOf(orbitAngle(3, 3 + n, n))).toBeCloseTo(1);
    expect(depthOf(orbitAngle(8, 3, n))).toBeCloseTo(0);
    expect(Math.cos(orbitAngle(4, 3, n))).toBeGreaterThan(0);
    expect(Math.cos(orbitAngle(2, 3, n))).toBeLessThan(0);
  });

  it("scales back bodies by depth and draws the front one at its true size, lifted off the orbit", () => {
    const e = toEntries(GROUPS);
    const frame = orbitFrame(1440, 900);
    const front = orbitBodies(e, frame, at(0, 0));
    const turned = orbitBodies(e, frame, at(2, 2));
    // Mission at the front, then turned to the back: smaller and fainter.
    expect(front[0]!.front).toBe(true);
    expect(front[0]!.alpha).toBe(1);
    expect(turned[0]!.R).toBeLessThan(front[0]!.R * 0.6);
    expect(turned[0]!.alpha).toBeLessThan(1);
    // Among back bodies, nearer is bigger.
    const back = turned.filter((b) => !b.front).sort((a, b) => a.depth - b.depth);
    const mission = back.find((b) => b.entry.id === "bgt_mission")!;
    expect(mission.R).toBeCloseTo(((ORBIT_MOTION.backMin + ORBIT_MOTION.backRange * mission.depth) * front[0]!.R) / ORBIT_MOTION.frontScale, 5);
    // The front body sits above its point on the orbit.
    expect(front[0]!.y).toBeLessThan(frame.cy + frame.ry * Math.cos((ORBIT_MOTION.tiltDeg * Math.PI) / 180));
    // More proven calls, a bigger true size; the filter never inflates a small record.
    const kelp = orbitBodies(e, frame, at(2, 2))[2]!;
    expect(kelp.front).toBe(true);
    expect(kelp.R).toBeLessThan(front[0]!.R);
    const solo = filterEntries(e, "solo");
    const alone = orbitBodies(solo, frame, at(0, 0), 66)[0]!;
    expect(alone.R).toBeLessThan(kelp.R);
  });

  it("grows the front body as it assembles and shrinks the one leaving", () => {
    const e = toEntries(GROUPS);
    const frame = orbitFrame(1440, 900);
    const start = orbitBodies(e, frame, at(0.2, 1, { leaving: 0, turn: 0, arrive: 0 }));
    const end = orbitBodies(e, frame, at(1, 1, { leaving: 0, turn: 1, arrive: 1 }));
    expect(start[1]!.R).toBeCloseTo(end[1]!.R * ORBIT_MOTION.arriveFrom, 5);
    expect(start[0]!.R).toBeGreaterThan(end[0]!.R);
    expect(start[0]!.alpha).toBe(1);
  });

  it("picks the front-most body under a tap", () => {
    const bodies = orbitBodies(toEntries(GROUPS), orbitFrame(1440, 900), at(0, 0));
    const f = bodies[0]!;
    expect(hitBody(bodies, f.x, f.y)?.entry.id).toBe("bgt_mission");
    expect(hitBody(bodies, -500, -500)).toBeNull();
  });

  it("uses a smaller orbit on phones", () => {
    const phone = orbitFrame(390, 320);
    const desk = orbitFrame(1440, 900);
    expect(phone.phone).toBe(true);
    expect(phone.scale).toBeLessThan(desk.scale);
    expect(phone.cx + phone.rx).toBeLessThanOrEqual(390);
  });
});
