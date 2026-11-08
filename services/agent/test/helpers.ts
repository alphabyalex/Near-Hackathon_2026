import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentContext, AgentContextSchema, type Intake, IntakeSchema } from "@wardline/schemas";
import { SCRATCH_FIXTURES_DIR } from "../src/agent-config.js";
import type { ChatClient, ChatResult } from "../src/llm-client.js";
import type { ChatMessage } from "../src/render.js";

export const scratchContext = (): AgentContext =>
  AgentContextSchema.parse(JSON.parse(readFileSync(join(SCRATCH_FIXTURES_DIR, "context.json"), "utf8")));

export const scratchIntake = (name: string): Intake =>
  IntakeSchema.parse(JSON.parse(readFileSync(join(SCRATCH_FIXTURES_DIR, `${name}.intake.json`), "utf8")));

export const intakeWith = (source_text: string, overrides: Partial<Intake> = {}): Intake => ({
  intake_ref: "int_test",
  vault_id: "vault-a.wardline.testnet",
  received_at_ns: "1793664000000000000",
  source_text,
  attachments_note: null,
  ...overrides,
});

/** Answers from a script, and remembers every message list it was sent. */
export class FakeChatClient implements ChatClient {
  readonly calls: ChatMessage[][] = [];

  constructor(private readonly replies: (string | Error)[]) {}

  async complete(messages: ChatMessage[]): Promise<ChatResult> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const reply = this.replies[this.calls.length - 1];
    if (reply === undefined) throw new Error("the fake client ran out of replies");
    if (reply instanceof Error) throw reply;
    return { content: reply, usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, latency_ms: 5, completion_id: `chat_${this.calls.length}` };
  }
}

export const modelReply = (fields: Record<string, unknown>): string =>
  JSON.stringify({ decision: "REVIEW", matched_payable_ref: null, reason_codes: ["OTHER"], evidence_refs: [], summary: "A test reply.", ...fields });

export const payReply = (payableRef: string, extra: Record<string, unknown> = {}): string =>
  modelReply({ decision: "PAY", matched_payable_ref: payableRef, reason_codes: ["MATCHED_APPROVED_PAYABLE"], ...extra });
