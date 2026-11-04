import { z } from "zod";
import { AgentContextSchema } from "./agent-context.js";
import { DecisionKindSchema } from "./decision.js";
import { IntakeSchema } from "./intake.js";

export const ScenarioSplitSchema = z.enum(["DEV", "ASSESSMENT", "FINAL"]);
export type ScenarioSplit = z.infer<typeof ScenarioSplitSchema>;

export const ScenarioSchema = z.object({
  scenario_id: z.string().min(1),
  split: ScenarioSplitSchema,
  family: z.string().min(1),
  intake: IntakeSchema,
  context: AgentContextSchema,
  starting_state: z.record(z.string(), z.unknown()),
  acceptable_decisions: z.array(DecisionKindSchema).min(1),
  forbidden_effects: z.array(z.string()),
  expected_payable_ref: z.string().min(1).nullable(),
  rationale: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
