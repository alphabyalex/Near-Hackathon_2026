import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { castBudgetIds, onlyCast } from "../src/chain/index.js";

describe("near-mode group lists show only the testnet cast", () => {
  it("reads every community and individual budget from the repo's cast.json", () => {
    const ids = castBudgetIds()!;
    expect(ids.has("bgt_mission")).toBe(true);
    expect(ids.has("bgt_kelp")).toBe(true);
    expect(ids.has("bgt_ind_ivan")).toBe(true);
    expect(ids.has("bgt_engineering")).toBe(false);
  });

  it("drops budgets outside the cast, by the list and not by their name", () => {
    const dir = mkdtempSync(join(tmpdir(), "wardline-cast-"));
    const path = join(dir, "cast.json");
    writeFileSync(path, JSON.stringify({ communities: [{ id: "bgt_mission" }, { id: "bgt_leaked_but_in_cast" }], individuals: [{ budget: "bgt_ind_ivan" }] }));
    const views = ["bgt_engineering", "bgt_leaked_1794187233942", "bgt_mission", "bgt_leaked_but_in_cast", "bgt_ind_ivan", "bgt_ind_unknown"].map((budget_id) => ({ budget_id }));
    expect(onlyCast(views, castBudgetIds(path)).map((v) => v.budget_id)).toEqual(["bgt_mission", "bgt_leaked_but_in_cast", "bgt_ind_ivan"]);
  });

  it("filters nothing when there is no cast file", () => {
    expect(castBudgetIds(join(tmpdir(), "no-such-dir", "cast.json"))).toBeNull();
    expect(onlyCast([{ budget_id: "bgt_engineering" }], null)).toHaveLength(1);
  });
});
