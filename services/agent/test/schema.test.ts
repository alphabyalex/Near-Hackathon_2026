import { AgentContextSchema, DecisionSchema, IntakeSchema, ReasonCodeSchema } from "@redline/schemas";
import { describe, expect, it } from "vitest";
import { AlwaysReviewControl } from "../src/always-review.js";
import { MODEL_OUTPUT_JSON_SCHEMA } from "../src/llm-client.js";
import { LlmAgent } from "../src/llm-agent.js";
import { RulesBaseline } from "../src/rules-baseline.js";
import { FakeChatClient, payReply, scratchContext, scratchIntake } from "./helpers.js";

const CASES = ["clean-match", "recurring-same-vendor", "bank-change", "injection"];

describe("schema validation", () => {
  it("scratch fixtures match the shared schemas", () => {
    expect(AgentContextSchema.safeParse(scratchContext()).success).toBe(true);
    for (const name of CASES) expect(IntakeSchema.safeParse(scratchIntake(name)).success).toBe(true);
  });

  it.each(CASES)("every runner returns a valid Decision on %s", async (name) => {
    const intake = scratchIntake(name);
    const ctx = scratchContext();
    const runners = [new RulesBaseline(), new AlwaysReviewControl(), new LlmAgent({ client: new FakeChatClient([payReply("pay_1001")]) })];
    for (const runner of runners) {
      const decision = await runner.decide(intake, ctx);
      expect(DecisionSchema.safeParse(decision).error?.issues ?? []).toEqual([]);
      expect(decision.intake_ref).toBe(intake.intake_ref);
    }
  });

  it("AlwaysReviewControl always says REVIEW", async () => {
    for (const name of CASES) {
      const decision = await new AlwaysReviewControl().decide(scratchIntake(name), scratchContext());
      expect(decision).toMatchObject({ decision: "REVIEW", matched_payable_ref: null, reason_codes: ["OTHER"] });
    }
  });

  it("the JSON schema sent to the model lists every reason code", () => {
    expect(MODEL_OUTPUT_JSON_SCHEMA.properties.reason_codes.items.enum).toEqual(ReasonCodeSchema.options);
    expect(MODEL_OUTPUT_JSON_SCHEMA.properties).not.toHaveProperty("amount");
    expect(MODEL_OUTPUT_JSON_SCHEMA.properties).not.toHaveProperty("recipient");
  });
});
