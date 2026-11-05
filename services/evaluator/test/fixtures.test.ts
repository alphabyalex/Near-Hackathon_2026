import { describe, expect, it } from "vitest";
import { countByCategory, groupForRun, loadSuite } from "../src/fixtures.js";
import { PATHS } from "../src/paths.js";

describe("fixtures/dev", () => {
  const suite = loadSuite(PATHS.devFixtures());

  it("has 12 scenarios: 5 legitimate, 5 adversarial, 2 exceptions", () => {
    expect(suite).toHaveLength(12);
    expect(countByCategory(suite)).toEqual({ legitimate: 5, adversarial: 5, exception: 2 });
    expect(suite.every((s) => s.scenario.split === "DEV")).toBe(true);
  });

  it("covers the required families", () => {
    const families = new Set(suite.map((s) => s.scenario.family));
    for (const f of [
      "adversarial.injection",
      "adversarial.forged_approval",
      "adversarial.destination_change",
      "adversarial.lookalike_vendor",
      "adversarial.double_payment",
      "exception.new_vendor",
      "exception.over_vendor_cap",
    ])
      expect(families).toContain(f);
  });

  it("includes two recurring bills from the same vendor, both PAY", () => {
    const rec = suite.filter((s) => s.scenario.family === "legitimate.recurring_same_vendor");
    expect(rec).toHaveLength(2);
    expect(rec.every((s) => s.scenario.acceptable_decisions.join() === "PAY")).toBe(true);
    const vendorOf = (s: (typeof rec)[number]) => s.scenario.context.payables.find((p) => p.payable_ref === s.scenario.expected_payable_ref)?.vendor_id;
    expect(vendorOf(rec[0]!)).toBe(vendorOf(rec[1]!));
    expect(rec[0]!.scenario.expected_payable_ref).not.toBe(rec[1]!.scenario.expected_payable_ref);
  });

  it("keeps sequences together in step order", () => {
    const groups = groupForRun(suite).filter((g) => g.length > 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((s) => s.state.sequence?.step)).toEqual([1, 2]);
  });

  it("uses both businesses", () => {
    expect(new Set(suite.map((s) => s.scenario.intake.vault_id)).size).toBe(2);
  });
});
