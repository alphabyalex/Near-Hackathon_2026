import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  EvaluationReportSchema,
  type EvaluationReport,
  type EvidenceGateway,
  type ReportVerification,
} from "@redline/schemas";
import { z } from "zod";
import { DOMAIN, domainDigest, sha256Bytes } from "./canonical.js";

/**
 * Layout of one evidence folder (a "suite dir"):
 *   suite-commitment.json      public commitment record
 *   suite-manifest.json        only when revealed (always for dev)
 *   suite-salt.hex             only when revealed (always for dev)
 *   registry.stub.json         stand-in for the on-chain evidence contract
 *   comparison.md
 *   runs/<agent>/report.json, report.md, run-record.json (dev only), digests.json
 */

export const DigestsSchema = z
  .object({
    schema: z.literal("redline-evidence-digests-v1"),
    run_id: z.string(),
    report_digest: z.string(),
    run_record_digest: z.string(),
    files: z.record(z.string(), z.string()),
  })
  .strict();
export type Digests = z.infer<typeof DigestsSchema>;

/**
 * Local stand-in for Tharun's evidence contract. Holds exactly what we intend to write on chain:
 * suite commitments and per-run report digests. Replaced by the contract client once deployed.
 */
export const RegistrySchema = z
  .object({
    schema: z.literal("redline-evidence-registry-stub-v1"),
    note: z.string(),
    suites: z.array(z.object({ commitment: z.string(), split: z.string(), registered_at: z.string() })),
    runs: z.array(
      z.object({
        run_id: z.string(),
        suite_commitment: z.string(),
        manifest_digest: z.string(),
        report_digest: z.string(),
        registered_at: z.string(),
      }),
    ),
  })
  .strict();
export type Registry = z.infer<typeof RegistrySchema>;

export const REGISTRY_FILE = "registry.stub.json";
export const REGISTRY_NOTE =
  "Local stand-in for the evidence contract (contracts/evidence). Not on chain. Each entry is what will be registered once the contract is deployed.";

export const reportDigest = (r: EvaluationReport): string => domainDigest(DOMAIN.report, r);
export const runRecordDigest = (rec: unknown): string => domainDigest(DOMAIN.runRecord, rec);

export const writeJson = (path: string, v: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2) + "\n");
};
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export function loadRegistry(suiteDir: string): Registry {
  const p = join(suiteDir, REGISTRY_FILE);
  if (!existsSync(p)) return { schema: "redline-evidence-registry-stub-v1", note: REGISTRY_NOTE, suites: [], runs: [] };
  return RegistrySchema.parse(readJson(p));
}

export function saveRegistry(suiteDir: string, reg: Registry): void {
  writeJson(join(suiteDir, REGISTRY_FILE), reg);
}

export interface RunFiles {
  report: EvaluationReport;
  markdown: string;
  runRecord: unknown;
  /** Where the full run record goes. For assessment runs this is under fixtures/private. */
  runRecordPath: string;
}

/** Writes one agent's run and returns its digests. The run record may live outside runDir. */
export function writeRun(runDir: string, f: RunFiles): Digests {
  mkdirSync(runDir, { recursive: true });
  writeJson(join(runDir, "report.json"), f.report);
  writeFileSync(join(runDir, "report.md"), f.markdown);
  writeJson(f.runRecordPath, f.runRecord);
  const files: Record<string, string> = {};
  for (const name of ["report.json", "report.md"]) files[name] = sha256Bytes(readFileSync(join(runDir, name)));
  if (dirname(f.runRecordPath) === runDir) files["run-record.json"] = sha256Bytes(readFileSync(f.runRecordPath));
  const digests: Digests = {
    schema: "redline-evidence-digests-v1",
    run_id: f.report.run_id,
    report_digest: reportDigest(f.report),
    run_record_digest: runRecordDigest(f.runRecord),
    files,
  };
  writeJson(join(runDir, "digests.json"), digests);
  return digests;
}

/** Finds every folder under root that has a suite-commitment.json. */
export function findSuiteDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    if (existsSync(join(d, "suite-commitment.json"))) out.push(d);
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory() && e !== "runs") walk(p);
    }
  };
  walk(root);
  return out.sort();
}

export function findRunDirs(suiteDir: string): string[] {
  const runs = join(suiteDir, "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs)
    .map((e) => join(runs, e))
    .filter((p) => existsSync(join(p, "digests.json")))
    .sort();
}

/**
 * EvidenceGateway over the evidence folder plus the registry stub. on_chain_digest comes from
 * the registry stub until the evidence contract client replaces it.
 */
export class FileEvidenceGateway implements EvidenceGateway {
  constructor(private readonly root: string) {}

  private index(): Map<string, { runDir: string; suiteDir: string }> {
    const m = new Map<string, { runDir: string; suiteDir: string }>();
    for (const suiteDir of findSuiteDirs(this.root))
      for (const runDir of findRunDirs(suiteDir)) {
        const d = DigestsSchema.parse(readJson(join(runDir, "digests.json")));
        m.set(d.run_id, { runDir, suiteDir });
      }
    return m;
  }

  async getReports(): Promise<EvaluationReport[]> {
    return [...this.index().values()].map(({ runDir }) => EvaluationReportSchema.parse(readJson(join(runDir, "report.json"))));
  }

  async getReport(runId: string): Promise<EvaluationReport | null> {
    const hit = this.index().get(runId);
    return hit ? EvaluationReportSchema.parse(readJson(join(hit.runDir, "report.json"))) : null;
  }

  async verifyReport(runId: string): Promise<ReportVerification> {
    const hit = this.index().get(runId);
    if (!hit) throw new Error(`unknown run ${runId}`);
    const report = EvaluationReportSchema.parse(readJson(join(hit.runDir, "report.json")));
    const computed = reportDigest(report);
    const entry = loadRegistry(hit.suiteDir).runs.find((r) => r.run_id === runId);
    const onChain = entry?.report_digest ?? null;
    return {
      run_id: runId,
      matches: onChain !== null && onChain === computed,
      computed_digest: computed as ReportVerification["computed_digest"],
      on_chain_digest: onChain as ReportVerification["on_chain_digest"],
    };
  }
}

export const rel = (root: string, p: string): string => relative(root, p) || ".";
