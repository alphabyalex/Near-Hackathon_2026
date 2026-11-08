import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadRepoEnv } from "@redline/agent";
import { DEFAULT_AGENTS, resolveAgents } from "./agents.js";
import { requireLlmIfConfigured } from "./llm-preflight.js";
import { canonicalJson } from "./canonical.js";
import {
  SuiteCommitmentSchema,
  SuiteManifestSchema,
  buildSuiteManifest,
  commitSuite,
  commitmentRecord,
  newSalt,
  saltFromHex,
  type SuiteManifest,
} from "./commitment.js";
import { findSuiteDirs, loadRegistry, readJson, saveRegistry, writeJson, writeRun } from "./evidence.js";
import { FixtureError, countByCategory, loadSuite, type LoadedScenario } from "./fixtures.js";
import { PATHS, fromRoot, repoRoot } from "./paths.js";
import { buildRun, renderComparison, renderMarkdown, type AgentRun } from "./report.js";
import { EXPECTED_COUNTS } from "./rubric.js";
import { runSuite } from "./runner.js";
import { verifyEvidence } from "./verify.js";

type Split = "dev" | "assessment";

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | true> } {
  const [cmd = "help", ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[a.slice(2)] = next;
      i++;
    } else flags[a.slice(2)] = true;
  }
  return { cmd, flags };
}

const str = (v: string | true | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const stampNow = (): string => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const show = (p: string): string => relative(repoRoot(), p) || ".";

function splitOf(flags: Record<string, string | true>): Split {
  const s = str(flags["split"]) ?? "dev";
  if (s !== "dev" && s !== "assessment") throw new Error(`--split must be dev or assessment, got ${s}`);
  return s;
}

const PRIVATE_SUITE = () => join(PATHS.privateRoot(), "suite");
const PUBLIC_ASSESSMENT = () => fromRoot("evidence", "assessment");

function loadSplit(split: Split): LoadedScenario[] {
  const dir = split === "dev" ? PATHS.devFixtures() : PATHS.assessmentFixtures();
  if (!existsSync(dir)) throw new Error(`${show(dir)} does not exist${split === "assessment" ? " (the hidden set is local only; see fixtures/README.md)" : ""}`);
  const suite = loadSuite(dir);
  const want = EXPECTED_COUNTS[split];
  const got = countByCategory(suite);
  const problems: string[] = [];
  for (const k of Object.keys(want) as Array<keyof typeof want>) if (got[k] !== want[k]) problems.push(`expected ${want[k]} ${k}, found ${got[k]}`);
  if (split === "dev" && suite.some((s) => s.scenario.split !== "DEV")) problems.push("dev fixtures must all have split DEV");
  if (split === "assessment") {
    if (suite.some((s) => s.scenario.split === "DEV")) problems.push("assessment fixtures must not have split DEV");
    const fin = countByCategory(suite.filter((s) => s.scenario.split === "FINAL"));
    if (fin.legitimate !== 5 || fin.adversarial !== 5 || fin.exception !== 2)
      problems.push(`final challenge must be 5/5/2, found ${fin.legitimate}/${fin.adversarial}/${fin.exception}`);
  }
  if (problems.length) throw new FixtureError(problems);
  return suite;
}

function cmdValidate(flags: Record<string, string | true>): void {
  const split = splitOf(flags);
  const suite = loadSplit(split);
  const c = countByCategory(suite);
  console.log(`OK: ${suite.length} ${split} scenarios valid (${c.legitimate} legitimate, ${c.adversarial} adversarial, ${c.exception} exception).`);
}

function cmdCommit(flags: Record<string, string | true>): void {
  if (splitOf(flags) !== "assessment") throw new Error("commit is only for the assessment split; dev runs commit automatically");
  const suite = loadSplit("assessment");
  const privDir = PRIVATE_SUITE();
  if (existsSync(join(privDir, "suite-manifest.json")) && flags["force"] !== true)
    throw new Error("a commitment already exists. Re-committing after publication breaks the evidence trail; pass --force only before anything was published");
  const manifest = buildSuiteManifest(suite, "ASSESSMENT");
  const salt = newSalt();
  const created = new Date().toISOString();
  writeJson(join(privDir, "suite-manifest.json"), manifest);
  writeFileSync(join(privDir, "suite-salt.hex"), salt.toString("hex") + "\n", { mode: 0o600 });
  const record = commitmentRecord(manifest, salt, created, false);
  const pub = PUBLIC_ASSESSMENT();
  writeJson(join(pub, "suite-commitment.json"), record);
  const reg = loadRegistry(pub);
  reg.suites.push({ commitment: record.commitment, split: "ASSESSMENT", registered_at: created });
  saveRegistry(pub, reg);
  console.log(`Committed ${suite.length} assessment scenarios.`);
  console.log(`  public:  ${show(join(pub, "suite-commitment.json"))}  ${record.commitment}`);
  console.log(`  private: ${show(privDir)}/suite-manifest.json and suite-salt.hex (gitignored)`);
  console.log("Back up fixtures/private/ outside the repo now. Without the salt the commitment can never be opened.");
}

/** For assessment runs: the files on disk must be exactly what was committed. */
function checkAgainstCommitment(suite: LoadedScenario[]): { commitment: string } {
  const privDir = PRIVATE_SUITE();
  const pubPath = join(PUBLIC_ASSESSMENT(), "suite-commitment.json");
  if (!existsSync(join(privDir, "suite-manifest.json")) || !existsSync(pubPath))
    throw new Error("no suite commitment yet. Run `pnpm --filter @redline/evaluator commit:assessment` first");
  const committed = SuiteManifestSchema.parse(readJson(join(privDir, "suite-manifest.json")));
  const salt = saltFromHex(readFileSync(join(privDir, "suite-salt.hex"), "utf8"));
  const record = SuiteCommitmentSchema.parse(readJson(pubPath));
  const current: SuiteManifest = buildSuiteManifest(suite, "ASSESSMENT");
  if (canonicalJson(current) !== canonicalJson(committed)) throw new Error("assessment fixtures, rubric or harness changed since the commitment. Refusing to run");
  if (commitSuite(committed, salt) !== record.commitment) throw new Error("private manifest and salt do not open the public commitment. Refusing to run");
  return { commitment: record.commitment };
}

async function cmdRun(flags: Record<string, string | true>): Promise<void> {
  const split = splitOf(flags);
  const suite = loadSplit(split);
  const stamp = stampNow();
  const names = (str(flags["agents"]) ?? DEFAULT_AGENTS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  loadRepoEnv();
  const { agents, unavailable } = await resolveAgents(names);
  await requireLlmIfConfigured(names, agents.map((a) => a.name), unavailable, str(flags["agents"]) !== undefined);
  if (unavailable.length) console.log(`Not available yet, skipped: ${unavailable.join(", ")}`);
  if (agents.length === 0) throw new Error("no runnable agents");

  let suiteDir: string;
  let commitment: string;
  const evidenceRoot = PATHS.evidence();
  if (split === "dev") {
    suiteDir = resolve(repoRoot(), str(flags["out"]) ?? join("evidence", "local", `dev-${stamp}`));
    if (!suiteDir.startsWith(evidenceRoot)) throw new Error("--out must be inside evidence/");
    rmSync(join(suiteDir, "runs"), { recursive: true, force: true });
    rmSync(join(suiteDir, "registry.stub.json"), { force: true });
    const manifest = buildSuiteManifest(suite, "DEV");
    const salt = newSalt();
    const publish = flags["publish-salt"] === true;
    const record = commitmentRecord(manifest, salt, new Date().toISOString(), publish);
    writeJson(join(suiteDir, "suite-manifest.json"), manifest);
    writeFileSync(join(suiteDir, "suite-salt.hex"), salt.toString("hex") + "\n");
    writeJson(join(suiteDir, "suite-commitment.json"), record);
    const reg = loadRegistry(suiteDir);
    reg.suites.push({ commitment: record.commitment, split: "DEV", registered_at: record.created_at });
    saveRegistry(suiteDir, reg);
    commitment = record.commitment;
  } else {
    if (flags["publish-salt"] === true) throw new Error("never publish the assessment salt from a run; reveal is a separate, deliberate step");
    commitment = checkAgainstCommitment(suite).commitment;
    suiteDir = PUBLIC_ASSESSMENT();
  }

  const runs: AgentRun[] = [];
  for (const agent of agents) {
    const runId = `run_${split}_${agent.name}_${stamp}`;
    const t0 = performance.now();
    const records = await runSuite(suite, agent);
    const run = buildRun({ runId, split, suite, suiteCommitment: commitment, agent, records, wallClockMs: performance.now() - t0, simIsStub: true });
    runs.push(run);
    const runDir = join(suiteDir, "runs", split === "dev" ? agent.name : `${agent.name}-${stamp}`);
    const runRecord = {
      schema: "redline-run-record-v1",
      run_id: runId,
      agent: { name: agent.name, label: agent.label, kind: agent.kind, stub: agent.stub, manifest: agent.manifest },
      suite_commitment: commitment,
      records,
      scored: run.scored.map(({ case: _c, ...rest }) => rest),
    };
    // Raw decisions can quote hidden invoice text, so assessment run records stay private.
    const runRecordPath = split === "dev" ? join(runDir, "run-record.json") : join(PATHS.privateRoot(), "runs", runId, "run-record.json");
    const digests = writeRun(runDir, { report: run.report, markdown: renderMarkdown(run), runRecord, runRecordPath });
    const reg = loadRegistry(suiteDir);
    reg.runs.push({ run_id: runId, suite_commitment: commitment, manifest_digest: run.report.manifest_digest, report_digest: digests.report_digest, registered_at: new Date().toISOString() });
    saveRegistry(suiteDir, reg);
  }
  writeFileSync(join(suiteDir, split === "dev" ? "comparison.md" : `comparison-${stamp}.md`), renderComparison(runs, unavailable, commitment));

  console.log(`\nSuite commitment ${commitment}`);
  for (const r of runs) {
    console.log(`\n${r.agent.label}  [${r.report.execution_status}, ${r.report.assessment_outcome}]`);
    for (const m of r.report.metrics) console.log(`  ${`${m.numerator}/${m.denominator}`.padStart(7)}  ${m.label}`);
  }
  console.log(`\nWrote ${show(suiteDir)}`);
}

function cmdVerify(): void {
  const checks = verifyEvidence();
  const mark = { MATCH: "ok     ", MISMATCH: "MISMATCH", PENDING: "pending" } as const;
  let where = "";
  for (const c of checks) {
    if (c.where !== where) console.log(`\n${(where = c.where)}`);
    console.log(`  ${mark[c.status]}  ${c.what}${c.detail ? `  (${c.detail})` : ""}`);
  }
  const bad = checks.filter((c) => c.status === "MISMATCH").length;
  const pending = checks.filter((c) => c.status === "PENDING").length;
  const suites = findSuiteDirs(PATHS.evidence()).length;
  console.log(`\n${checks.length - bad - pending} match, ${bad} mismatch, ${pending} pending across ${suites} evidence folder(s).`);
  if (bad > 0) process.exitCode = 1;
}

const HELP = `redline gym

  validate [--split dev|assessment]      validate fixtures against the schema and lint rules
  run --split dev [--agents a,b] [--out evidence/<dir>] [--publish-salt]
  run --split assessment [--agents a,b]  refuses to run unless the files match the commitment
  commit --split assessment [--force]    commit the hidden suite (salt stays in fixtures/private)
  verify                                 recompute every digest under evidence/

agents: ${DEFAULT_AGENTS.join(", ")}`;

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd === "validate") cmdValidate(flags);
  else if (cmd === "commit") cmdCommit(flags);
  else if (cmd === "run") await cmdRun(flags);
  else if (cmd === "verify") cmdVerify();
  else console.log(HELP);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
