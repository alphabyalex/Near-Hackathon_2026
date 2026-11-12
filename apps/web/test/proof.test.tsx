/** The proof engine page: the latest proofs feed opens one row at a time, and the stats read from the red-team report. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProofRow } from "../src/data/proofs";

const row = (over: Partial<ProofRow>): ProofRow => ({
  call_id: "call_0",
  budget_id: "bgt_mission",
  group: "Mission Street",
  side: "above",
  status: "verified",
  reason: null,
  model_claimed: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  model_proven: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  amount: "200",
  refund: "0",
  created_at: "2026-11-11T15:05:24.138Z",
  tx: "DrQgBC816TKF8aU9oB9mLzEPGJYTAYrHUxZ6LDU3YL1b",
  ...over,
});

const ROWS: ProofRow[] = [
  row({ call_id: "call_paid" }),
  row({ call_id: "call_swap", budget_id: "bgt_kelp", group: "Kelp", side: "below", status: "refused", reason: "MODEL_MISMATCH", model_proven: null, amount: "0", tx: "5CRtG3nczjeW4Rd69BexGdx7huvSWhGzSL2kJis5Gi8M" }),
  row({ call_id: "call_cap", side: "below", status: "refused", reason: "ALLOWANCE_EXHAUSTED", model_proven: null, amount: "0", tx: null }),
];

// No network in tests: the feed and the group fees come from these mocks.
vi.mock("../src/data/proofs", () => ({ getProofs: vi.fn(async () => ({ mode: "near", proofs: ROWS })) }));
vi.mock("../src/data/groups", () => ({
  getGroups: vi.fn(async () => ({ mode: "near", tiers: {}, groups: [{ budget_id: "bgt_mission", name: "Mission Street", fee_bps: 200 }, { budget_id: "bgt_kelp", name: "Kelp", fee_bps: 125 }] })),
}));

afterEach(cleanup);

describe("proof helpers", () => {
  it("shows real precision in the explanation and <0.01 in the feed", async () => {
    const { exactUsdc, proofAmount, feePercent } = await import("../src/views/site/Proof");
    expect(exactUsdc("200")).toBe("0.0002");
    expect(exactUsdc("194")).toBe("0.000194");
    expect(exactUsdc("2000000")).toBe("2.00");
    expect(exactUsdc("1500000")).toBe("1.50");
    expect(proofAmount("200")).toBe("<0.01");
    expect(feePercent(200)).toBe("2%");
    expect(feePercent(125)).toBe("1.25%");
  });

  it("names the verdict for each side and reason", async () => {
    const { verdictOf } = await import("../src/views/site/Proof");
    expect(verdictOf({ side: "above", reason: null })).toBe("paid");
    expect(verdictOf({ side: "below", reason: "MODEL_MISMATCH" })).toBe("refunded");
    expect(verdictOf({ side: "below", reason: "ALLOWANCE_EXHAUSTED" })).toBe("capped");
    expect(verdictOf({ side: "below", reason: "BUDGET_EXHAUSTED" })).toBe("capped");
    expect(verdictOf({ side: "below", reason: "UNKNOWN_MEMBER" })).toBe("blocked");
  });

  it("builds each explanation from the row's data", async () => {
    const { explainProof } = await import("../src/views/site/Proof");
    const one = (r: ProofRow) => ({ row: r, count: 1, total: r.amount });
    expect(explainProof(one(ROWS[0]!), 200)).toBe(
      "Mission Street's agent paid for a DeepSeek V4.1 Flash answer. NEAR's AI service signed it, the signature matched, so 0.0002 USDC went to the provider and 2% to the pool.",
    );
    expect(explainProof(one(ROWS[0]!), null)).not.toMatch(/pool/);
    expect(explainProof(one(ROWS[1]!), 125)).toBe(
      "Kelp's agent was charged for DeepSeek V4.1 Flash but the receipt shows a different model wrote it. Refused, and the money stayed in the budget.",
    );
    expect(explainProof(one(ROWS[2]!), 200)).toBe("A Mission Street member hit their spending limit, so the call was stopped before it reached the AI. Nothing was sent.");
    expect(explainProof({ row: ROWS[0]!, count: 3, total: "600" }, 200)).toMatch(/3 times in a row, 0\.0006 USDC in all\.$/);
    expect(explainProof(one({ ...ROWS[0]!, group: "Hassan (solo)" }), 200)).toMatch(/^Hassan's agent/);
  });

  it("derives the attack count, and says 250+ only from 250", async () => {
    const { attackCount, attackCountText, scamCatchRate, formatMs } = await import("../src/views/site/Proof");
    expect(attackCount({ attacks: 159, adversarial: 48 })).toBe(207);
    expect(attackCountText(207)).toBe("207");
    expect(attackCountText(250)).toBe("250+");
    expect(attackCountText(312)).toBe("250+");
    expect(scamCatchRate({ cases: { written: 0, attacks: 100, legit: 0, adversarial: 100 }, headline: { attackCatchRate: 1, adversarialCatchRate: 0.5, legitFalsePositiveRate: 0, unsafePays: 0, latencyP50Ms: 0, latencyP95Ms: 0 } })).toBe(0.75);
    expect(formatMs(0.027)).toBe("0.027 ms");
    expect(formatMs(12.34)).toBe("12.3 ms");
  });

  it("PROOF copy has no em dashes", async () => {
    const { PROOF } = await import("../src/brand");
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (typeof v === "function") strings.push(String((v as (...a: string[]) => string)("a", "b", "c", "d")));
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(PROOF);
    expect(strings.filter((s) => s.includes(String.fromCharCode(0x2014)))).toEqual([]);
  });
});

describe("the proof engine page", () => {
  it("each row is a button that opens its explanation, one at a time", async () => {
    const { Proof } = await import("../src/views/site/Proof");
    render(<Proof />);
    const feed = await screen.findByTestId("proofs");
    const buttons = within(feed).getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    expect(within(feed).getByText("Paid").className).toMatch(/is-paid/);
    expect(within(feed).getByText("Refunded").className).toMatch(/is-below/);
    expect(within(feed).getByText("Capped").className).toMatch(/is-below/);

    fireEvent.click(buttons[0]!);
    expect(buttons[0]!.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(buttons[0]!.getAttribute("aria-controls")!)!;
    expect(panel).not.toBeNull();
    expect(panel.hasAttribute("inert")).toBe(false);
    await waitFor(() => expect(panel.textContent).toContain("0.0002 USDC went to the provider and 2% to the pool."));
    expect(panel.textContent).toContain("This pattern is drawn from the call's signed receipt, so every answer gets its own.");
    // The transaction link sits in the opened region, never inside the row's button.
    expect(panel.querySelector("a.tx-link")).not.toBeNull();
    expect(feed.querySelector("button a")).toBeNull();

    fireEvent.click(buttons[1]!);
    expect(buttons.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "true", "false"]);
    expect(panel.hasAttribute("inert")).toBe(true);

    fireEvent.click(buttons[1]!);
    expect(buttons.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
  });

  it("stats: the time the check adds above the line, scams held below it, and a verify section wired to #/verify", async () => {
    const { Proof, attackCount, attackCountText } = await import("../src/views/site/Proof");
    const { REDTEAM } = await import("../src/redteam");
    render(<Proof />);
    const stats = screen.getByTestId("proof-stats");
    expect(stats.querySelector(".ls-good .ls-num")!.textContent).toBe(`${REDTEAM.headline.latencyP50Ms} ms`);
    expect(stats.querySelector(".ls-bad .ls-sub")!.textContent).toBe(`in our test of ${attackCountText(attackCount())} attacks`);
    const verify = screen.getByTestId("verify-business");
    expect(within(verify).getAllByRole("listitem")).toHaveLength(7);
    const cta = within(verify).getByRole("link", { name: "Verify your business" });
    expect(cta.getAttribute("href")).toBe("#/verify");
    expect(cta.className).toBe("btn");
  });
});
