import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AgentContext, type Decision, DecisionSchema, DigestSchema, type Digest, type Intake } from "@redline/schemas";
import { z } from "zod";
import { DEFAULT_REPLAY_DIR } from "./agent-config.js";
import { digestOf } from "./canonical.js";
import { scopeContext } from "./checks.js";
import { makeDecision } from "./decisions.js";
import { type DecisionWithReport, NO_USAGE, type ReportingAgent } from "./report.js";

export const REPLAY_LABEL = "[REPLAY]";

/**
 * Hash of what makes two invoices the same: the vault and the text. intake_ref and
 * received_at_ns are left out because the API assigns new ones on every submission,
 * which would otherwise make every replay in a live demo miss.
 */
export const intakeHash = (intake: Intake): Digest =>
  digestOf({ vault_id: intake.vault_id, source_text: intake.source_text, attachments_note: intake.attachments_note });

const ReplayRecordSchema = z.object({
  schema: z.literal("redline-replay-record-v1"),
  manifest_digest: DigestSchema,
  intake_hash: DigestSchema,
  context_digest: DigestSchema,
  recorded_at: z.iso.datetime(),
  model_id: z.string().nullable(),
  decision: DecisionSchema,
  raw_output: z.string().nullable(),
});
export type ReplayRecord = z.infer<typeof ReplayRecordSchema>;

/** One JSON file per recording: <dir>/<manifest hex>/<intake hex>.json. */
export class ReplayStore {
  constructor(readonly dir: string = DEFAULT_REPLAY_DIR) {}

  private path(manifest: Digest, intake: Digest): string {
    return join(this.dir, manifest.replace("sha256:", ""), `${intake.replace("sha256:", "")}.json`);
  }

  put(record: ReplayRecord): void {
    const file = this.path(record.manifest_digest, record.intake_hash);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(ReplayRecordSchema.parse(record), null, 2)}\n`);
  }

  /** A missing or corrupt recording is a miss. */
  get(manifest: Digest, intake: Digest): ReplayRecord | null {
    const file = this.path(manifest, intake);
    if (!existsSync(file)) return null;
    try {
      const parsed = ReplayRecordSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

/** Runs a live agent and saves what it decided. Fallbacks are not saved: they are not model output. */
export class RecordingAgent implements ReportingAgent {
  constructor(
    private readonly inner: ReportingAgent,
    private readonly store: ReplayStore,
  ) {}

  async decide(intake: Intake, ctx: AgentContext): Promise<Decision> {
    return (await this.decideWithReport(intake, ctx)).decision;
  }

  async decideWithReport(intake: Intake, ctx: AgentContext): Promise<DecisionWithReport> {
    const result = await this.inner.decideWithReport(intake, ctx);
    const { manifest_digest: manifest, fallback, model_id: modelId } = result.report;
    if (manifest !== null && fallback === null) {
      this.store.put({
        schema: "redline-replay-record-v1",
        manifest_digest: manifest,
        intake_hash: intakeHash(intake),
        context_digest: digestOf(scopeContext(ctx, intake.vault_id)),
        recorded_at: new Date().toISOString(),
        model_id: modelId,
        decision: result.decision,
        raw_output: result.raw_output ?? null,
      });
    }
    return result;
  }
}

/**
 * Plays recordings back offline, for demo resilience only. Every decision says it is a replay
 * in its summary, because Decision has no provenance field yet. A recording only plays against
 * the records it was made with: otherwise a saved PAY could replay after the bill was paid.
 * A miss is a labeled REVIEW, never a guess.
 */
export class ReplayAgent implements ReportingAgent {
  constructor(
    private readonly store: ReplayStore,
    private readonly manifestDigest: Digest,
  ) {}

  async decide(intake: Intake, ctx: AgentContext): Promise<Decision> {
    return (await this.decideWithReport(intake, ctx)).decision;
  }

  async decideWithReport(intake: Intake, ctx: AgentContext): Promise<DecisionWithReport> {
    const started = performance.now();
    const record = this.store.get(this.manifestDigest, intakeHash(intake));
    const matches = record !== null && record.context_digest === digestOf(scopeContext(ctx, intake.vault_id));

    let decision: Decision;
    let note: string;
    if (record === null) {
      note = "No recording exists for this manifest and invoice.";
      decision = makeDecision(intake, "REVIEW", ["OTHER"], `${REPLAY_LABEL} ${note} Sent to a human.`);
    } else if (!matches) {
      note = "A recording exists, but the records have changed since it was made.";
      decision = makeDecision(intake, "REVIEW", ["OTHER"], `${REPLAY_LABEL} ${note} Sent to a human.`);
    } else {
      note = `Recorded at ${record.recorded_at}.`;
      decision = DecisionSchema.parse({ ...record.decision, intake_ref: intake.intake_ref, summary: `${REPLAY_LABEL} ${record.decision.summary}` });
    }

    return {
      decision,
      report: {
        agent: "replay",
        source: "replay",
        manifest_digest: this.manifestDigest,
        model_id: record?.model_id ?? null,
        latency_ms: Math.round(performance.now() - started),
        attempts: 0,
        usage: NO_USAGE,
        cost_usd: null,
        fallback: null,
        guard: [],
        replay: { hit: matches, note },
      },
    };
  }
}
