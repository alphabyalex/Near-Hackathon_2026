import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EvaluationReportSchema } from "@redline/schemas";
import { canonicalJson, sha256Bytes } from "./canonical.js";
import { SuiteCommitmentSchema, SuiteManifestSchema, buildSuiteManifest, commitSuite, saltFromHex, type SuiteManifest } from "./commitment.js";
import { DigestsSchema, findRunDirs, findSuiteDirs, loadRegistry, readJson, rel, reportDigest, runRecordDigest } from "./evidence.js";
import { loadSuite } from "./fixtures.js";
import { PATHS, repoRoot } from "./paths.js";

export type CheckStatus = "MATCH" | "MISMATCH" | "PENDING";
export interface Check {
  where: string;
  what: string;
  status: CheckStatus;
  detail: string;
}

/** Where to find the scenario files a manifest refers to, in order of preference. */
function fixtureDirsFor(split: SuiteManifest["split"]): Array<{ dir: string; private: boolean }> {
  if (split === "DEV") return [{ dir: PATHS.devFixtures(), private: false }];
  return [
    { dir: PATHS.releasedAssessment(), private: false },
    { dir: PATHS.assessmentFixtures(), private: true },
  ];
}

const hasJson = (dir: string): boolean => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".json"));

/**
 * Recomputes every digest from the files on disk and compares it with what was recorded.
 * PENDING means the inputs are not public yet (hidden suite before reveal), not a failure.
 */
export function verifyEvidence(root = PATHS.evidence()): Check[] {
  const checks: Check[] = [];
  const top = repoRoot();
  const add = (where: string, what: string, status: CheckStatus, detail = "") => checks.push({ where: rel(top, where), what, status, detail });

  const suiteDirs = findSuiteDirs(root);
  if (suiteDirs.length === 0) add(root, "evidence present", "PENDING", "no suite-commitment.json found");

  for (const sd of suiteDirs) {
    const rec = SuiteCommitmentSchema.parse(readJson(join(sd, "suite-commitment.json")));
    const registry = loadRegistry(sd);

    add(sd, "suite commitment registered", registry.suites.some((s) => s.commitment === rec.commitment) ? "MATCH" : "MISMATCH", rec.commitment);

    // Locate the manifest and salt: public copies first, then the local private store for the hidden set.
    const pubManifest = join(sd, "suite-manifest.json");
    const pubSalt = join(sd, "suite-salt.hex");
    const privManifest = join(PATHS.privateRoot(), "suite", "suite-manifest.json");
    const privSalt = join(PATHS.privateRoot(), "suite", "suite-salt.hex");
    let manifest: SuiteManifest | null = null;
    let saltHex: string | null = null;
    let source = "public";
    if (existsSync(pubManifest) && existsSync(pubSalt)) {
      manifest = SuiteManifestSchema.parse(readJson(pubManifest));
      saltHex = readFileSync(pubSalt, "utf8");
    } else if (rec.split === "ASSESSMENT" && existsSync(privManifest) && existsSync(privSalt)) {
      manifest = SuiteManifestSchema.parse(readJson(privManifest));
      saltHex = readFileSync(privSalt, "utf8");
      source = "private (local only, not reproducible by others until reveal)";
    }

    if (!manifest || saltHex === null) {
      add(sd, "suite commitment recomputed", "PENDING", "manifest and salt not revealed");
    } else {
      const recomputed = commitSuite(manifest, saltFromHex(saltHex));
      add(sd, `suite commitment recomputed from ${source} manifest and salt`, recomputed === rec.commitment ? "MATCH" : "MISMATCH", recomputed);
      const header = { split: manifest.split, rubric_version: manifest.rubric_version, harness_id: manifest.harness_id, counts: manifest.counts };
      const recHeader = { split: rec.split, rubric_version: rec.rubric_version, harness_id: rec.harness_id, counts: rec.counts };
      add(sd, "commitment record matches manifest header", canonicalJson(header) === canonicalJson(recHeader) ? "MATCH" : "MISMATCH");

      const target = fixtureDirsFor(manifest.split).find((f) => hasJson(f.dir));
      if (!target) add(sd, "scenario hashes recomputed", "PENDING", "scenario files not available");
      else {
        try {
          const now = buildSuiteManifest(loadSuite(target.dir), manifest.split);
          const want = new Map(manifest.scenario_hashes.map((h) => [h.scenario_id, h.digest]));
          const got = new Map(now.scenario_hashes.map((h) => [h.scenario_id, h.digest]));
          const bad = [...new Set([...want.keys(), ...got.keys()])].filter((id) => want.get(id) !== got.get(id));
          add(
            sd,
            `scenario hashes recomputed from ${rel(top, target.dir)}${target.private ? " (private)" : ""}`,
            bad.length === 0 ? "MATCH" : "MISMATCH",
            bad.length === 0 ? `${got.size} scenarios` : `differs: ${bad.join(", ")}`,
          );
        } catch (e) {
          add(sd, "scenario hashes recomputed", "MISMATCH", (e as Error).message.split("\n")[0] ?? "");
        }
      }
    }

    for (const rd of findRunDirs(sd)) {
      const d = DigestsSchema.parse(readJson(join(rd, "digests.json")));
      for (const [name, want] of Object.entries(d.files)) {
        const p = join(rd, name);
        if (!existsSync(p)) add(rd, `file ${name}`, "MISMATCH", "missing");
        else {
          const got = sha256Bytes(readFileSync(p));
          add(rd, `file ${name}`, got === want ? "MATCH" : "MISMATCH", got);
        }
      }
      const parsed = EvaluationReportSchema.safeParse(readJson(join(rd, "report.json")));
      if (!parsed.success) {
        add(rd, "report.json schema", "MISMATCH", parsed.error.issues[0]?.message ?? "");
        continue;
      }
      const report = parsed.data;
      const rdig = reportDigest(report);
      add(rd, "report digest recomputed", rdig === d.report_digest ? "MATCH" : "MISMATCH", rdig);
      add(rd, "report bound to this suite", report.suite_commitment === rec.commitment ? "MATCH" : "MISMATCH");
      const entry = registry.runs.find((r) => r.run_id === report.run_id);
      add(rd, "report digest registered", entry?.report_digest === rdig ? "MATCH" : "MISMATCH", entry ? "" : "no registry entry");
      if (entry) add(rd, "agent manifest digest registered", entry.manifest_digest === report.manifest_digest ? "MATCH" : "MISMATCH");
      const rr = join(rd, "run-record.json");
      const privRr = join(PATHS.privateRoot(), "runs", report.run_id, "run-record.json");
      const rrPath = existsSync(rr) ? rr : existsSync(privRr) ? privRr : null;
      if (!rrPath) add(rd, "run record digest", "PENDING", "run record is private until reveal");
      else add(rd, `run record digest${rrPath === privRr ? " (private)" : ""}`, runRecordDigest(readJson(rrPath)) === d.run_record_digest ? "MATCH" : "MISMATCH");
    }
  }
  return checks;
}
