import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fillProse } from "./fill.js";
import { chooseModel, nearAiProseClient, readLedger, worstCaseCallUsd, writeLedger } from "./llm.js";
import { generateCases, type CaseParams } from "./params.js";
import { PATHS } from "./paths.js";
import { cacheKey, ProseCache } from "./prose.js";
import { buildReport, renderMarkdown } from "./report.js";
import { chooseEngine, runCase } from "./runner.js";

export const DEFAULT_SEED = "redline-redteam-v1";
export const MAX_CASES = 200;
export const DRY_RUN_CASES = 5;

interface CasesFile {
  seed: string;
  count: number;
  /** The model whose cached prose the benchmark uses. Set by the prose step. */
  model: string | null;
  modelNote: string;
  cases: CaseParams[];
}

const readCases = (): CasesFile => {
  if (!existsSync(PATHS.cases)) throw new Error("No fixtures/redteam/cases.json yet. Run: pnpm --filter @redline/redteam generate");
  return JSON.parse(readFileSync(PATHS.cases, "utf8")) as CasesFile;
};
const writeCases = (file: CasesFile) => {
  mkdirSync(PATHS.fixtures, { recursive: true });
  writeFileSync(PATHS.cases, `${JSON.stringify(file, null, 2)}\n`);
};

function generate(flags: { count?: string; seed?: string }): void {
  const count = Number(flags.count ?? MAX_CASES);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CASES) throw new Error(`--count must be 1 to ${MAX_CASES}.`);
  const seed = flags.seed ?? DEFAULT_SEED;
  const previous = existsSync(PATHS.cases) ? readCases() : null;
  writeCases({ seed, count, model: previous?.model ?? null, modelNote: previous?.modelNote ?? "", cases: generateCases(seed, count) });
  console.log(`Wrote ${count} cases with seed ${seed} to fixtures/redteam/cases.json. No model calls.`);
}

async function prose(flags: { "dry-run"?: boolean; limit?: string; batch?: string; cap?: string }): Promise<void> {
  if (existsSync(PATHS.env)) process.loadEnvFile(PATHS.env);
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) throw new Error("NEAR_AI_API_KEY is not set in .env.");
  const file = readCases();
  const dryRun = flags["dry-run"] === true;
  const limit = dryRun ? DRY_RUN_CASES : Number(flags.limit ?? MAX_CASES);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CASES) throw new Error(`--limit must be 1 to ${MAX_CASES}.`);
  const capUsd = Math.min(Number(flags.cap ?? 1), 1);

  const model = await chooseModel();
  console.log(`Model: ${model.id}. ${model.note}`);
  console.log(`Price per million tokens: $${(model.price.input * 1e6).toFixed(2)} in, $${(model.price.output * 1e6).toFixed(2)} out. Worst case per call: $${worstCaseCallUsd(model.price).toFixed(5)}.`);

  const ledger = readLedger(PATHS.ledger);
  const before = { calls: ledger.calls, cost: ledger.costUsd };
  const result = await fillProse({
    cases: file.cases,
    limit,
    batchSize: Number(flags.batch ?? 10),
    capUsd,
    model,
    client: nearAiProseClient(model, apiKey),
    cache: new ProseCache(PATHS.prose),
    ledger,
    saveLedger: (l) => writeLedger(PATHS.ledger, l),
    log: (line) => console.log(line),
  });
  ledger.runs.push({ at: new Date().toISOString(), mode: dryRun ? "dry-run" : `limit ${limit}`, calls: ledger.calls - before.calls, costUsd: ledger.costUsd - before.cost });
  writeLedger(PATHS.ledger, ledger);
  writeCases({ ...file, model: model.id, modelNote: model.note });

  const written = result.generated + result.rejected;
  console.log("");
  console.log(`This run: ${result.calls} calls, ${result.promptTokens} prompt tokens, ${result.completionTokens} completion tokens, about $${result.costUsd.toFixed(5)}.`);
  console.log(`Cases: ${result.generated} written, ${result.rejected} rejected by validation, ${result.failed} failed, ${result.cached} already cached.`);
  if (written > 0) {
    const perCase = result.costUsd / written;
    console.log(`Average per case: ${Math.round((result.promptTokens + result.completionTokens) / written)} tokens, $${perCase.toFixed(5)}. ${MAX_CASES} cases would cost about $${(perCase * MAX_CASES).toFixed(4)}.`);
  }
  console.log(`All runs so far: ${ledger.calls} calls, $${ledger.costUsd.toFixed(5)}.`);
  if (dryRun) console.log(`\nDry run done. Check the prose in fixtures/redteam/prose, then run: pnpm --filter @redline/redteam prose --limit ${MAX_CASES}`);
}

async function bench(): Promise<void> {
  const file = readCases();
  const cache = new ProseCache(PATHS.prose);
  const engine = await chooseEngine();
  const results = [];
  let excluded = 0;
  // One untimed check per family first, so module loading and JIT warm-up do not land in the latency numbers.
  const firstOfEach = new Map(file.cases.map((c) => [c.family, c] as const));
  for (const params of firstOfEach.values()) await runCase(params, engine.engine);
  for (const params of file.cases) {
    const entry = file.model ? cache.get(cacheKey(params, file.model)) : null;
    if (!entry || entry.rejected) {
      excluded++;
      continue;
    }
    results.push(await runCase(params, engine.engine, entry.prose.body));
  }
  if (results.length === 0) throw new Error("No case has prose yet. Run the prose step first.");
  const report = buildReport({
    seed: file.seed,
    results,
    excluded,
    engine: { name: engine.name, note: engine.note },
    model: { id: file.model, note: file.modelNote },
    ledger: readLedger(PATHS.ledger),
  });
  mkdirSync(PATHS.evidence, { recursive: true });
  writeFileSync(PATHS.report, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(PATHS.doc, renderMarkdown(report));
  const h = report.headline;
  console.log(`Cases: ${report.cases.total} run, ${excluded} without usable prose left out.`);
  console.log(`Attacks stopped: ${(h.attackCatchRate * 100).toFixed(1)}%. Expected verdict and reason: ${(h.attackExactMatchRate * 100).toFixed(1)}%. Legit false positives: ${(h.legitFalsePositiveRate * 100).toFixed(1)}%. Unsafe PAY: ${h.unsafePays}.`);
  console.log(`Latency p50 ${h.latencyP50Ms} ms, p95 ${h.latencyP95Ms} ms. Engine: ${report.engine.name}.`);
  console.log("Wrote evidence/redteam/report.json and docs/REDTEAM.md.");
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { count: { type: "string" }, seed: { type: "string" }, "dry-run": { type: "boolean" }, limit: { type: "string" }, batch: { type: "string" }, cap: { type: "string" } },
});

const command = positionals[0];
const run = command === "generate" ? async () => generate(values) : command === "prose" ? () => prose(values) : command === "bench" ? bench : null;
if (!run) {
  console.error("Usage: tsx src/cli.ts generate [--count 200] [--seed s] | prose --dry-run | prose [--limit 200] | bench");
  process.exit(2);
}
run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
