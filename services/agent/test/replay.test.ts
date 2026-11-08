import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionSchema } from "@wardline/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmAgent } from "../src/llm-agent.js";
import { buildManifest, manifestDigest } from "../src/manifest.js";
import { intakeHash, RecordingAgent, REPLAY_LABEL, ReplayAgent, ReplayStore } from "../src/replay.js";
import { FakeChatClient, payReply, scratchContext, scratchIntake } from "./helpers.js";

const digestA = manifestDigest(buildManifest("A"));
const digestB = manifestDigest(buildManifest("B"));

describe("replay", () => {
  let dir: string;
  let store: ReplayStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wardline-replay-"));
    store = new ReplayStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const record = async () => {
    const client = new FakeChatClient([payReply("pay_1001", { summary: "Matches.", evidence_refs: ["PO-1001", "GR-1001"] })]);
    const recorder = new RecordingAgent(new LlmAgent({ client }), store);
    return recorder.decide(scratchIntake("clean-match"), scratchContext());
  };

  it("round trips a recorded decision offline, and labels it", async () => {
    const live = await record();
    const { decision, report } = await new ReplayAgent(store, digestA).decideWithReport(scratchIntake("clean-match"), scratchContext());

    expect(DecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision).toEqual({ ...live, summary: `${REPLAY_LABEL} ${live.summary}` });
    expect(decision.summary.startsWith(REPLAY_LABEL)).toBe(true);
    expect(report).toMatchObject({ agent: "replay", source: "replay", manifest_digest: digestA, replay: { hit: true }, usage: { total_tokens: 0 } });
  });

  it("keeps the raw model output with the recording", async () => {
    await record();
    expect(store.get(digestA, intakeHash(scratchIntake("clean-match")))?.raw_output).toContain("MATCHED_APPROVED_PAYABLE");
  });

  it("still hits when the API gives the same invoice a new ref and time, and uses the new ref", async () => {
    await record();
    const resubmitted = { ...scratchIntake("clean-match"), intake_ref: "int_new", received_at_ns: "1793664000000000999" };
    const { decision, report } = await new ReplayAgent(store, digestA).decideWithReport(resubmitted, scratchContext());
    expect(report.replay?.hit).toBe(true);
    expect(decision).toMatchObject({ decision: "PAY", intake_ref: "int_new" });
  });

  it("misses safely under another manifest", async () => {
    await record();
    const { decision, report } = await new ReplayAgent(store, digestB).decideWithReport(scratchIntake("clean-match"), scratchContext());
    expect(decision).toMatchObject({ decision: "REVIEW", reason_codes: ["OTHER"], matched_payable_ref: null });
    expect(decision.summary.startsWith(REPLAY_LABEL)).toBe(true);
    expect(report.replay?.hit).toBe(false);
  });

  it("misses safely on different invoice text", async () => {
    await record();
    const other = { ...scratchIntake("clean-match"), source_text: "Something else." };
    const { decision, report } = await new ReplayAgent(store, digestA).decideWithReport(other, scratchContext());
    expect(decision.decision).toBe("REVIEW");
    expect(report.replay?.hit).toBe(false);
  });

  it("will not replay a PAY after the bill has been paid", async () => {
    await record();
    const paid = scratchContext();
    paid.payables[0]!.status = "SETTLED";
    const { decision, report } = await new ReplayAgent(store, digestA).decideWithReport(scratchIntake("clean-match"), paid);
    expect(decision.decision).toBe("REVIEW");
    expect(report.replay).toMatchObject({ hit: false });
    expect(decision.summary).toContain("records have changed");
  });

  it("treats a corrupt recording as a miss", async () => {
    const intake = scratchIntake("clean-match");
    const folder = join(dir, digestA.replace("sha256:", ""));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${intakeHash(intake).replace("sha256:", "")}.json`), "{ not json");
    const { decision } = await new ReplayAgent(store, digestA).decideWithReport(intake, scratchContext());
    expect(decision.decision).toBe("REVIEW");
  });

  it("does not record a fallback as if the model said it", async () => {
    const client = new FakeChatClient(["bad", "bad again"]);
    const recorder = new RecordingAgent(new LlmAgent({ client }), store);
    await recorder.decide(scratchIntake("clean-match"), scratchContext());
    expect(store.get(digestA, intakeHash(scratchIntake("clean-match")))).toBeNull();
  });
});
