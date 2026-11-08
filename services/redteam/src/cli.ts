import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { AGENT_VARIANTS, AgentCache, agentCacheKey, compare, pickAgentCases, recordedDigest, runAgentDecisions, type AgentDecisionEntry, type AgentVariant, type Comparison, type ComparisonRow } from "./agent.js";
import { fillAdversarial, fillProse, type FillResult } from "./fill.js";
import { chooseModel, nearAiJsonClient, readLedger, worstCaseCallUsd, writeLedger, type Ledger, type ModelChoice } from "./llm.js";
import { generateAdversarialCases, generateCases, type CaseParams } from "./params.js";
import { PATHS } from "./paths.js";
import { adversarialCacheKey, cacheKey, ProseCache, withInventedAccount } from "./prose.js";
import { buildReport, renderMarkdown } from "./report.js";
import { chooseEngine, isAttack, runCase, type CaseResult } from "./runner.js";

export const DEFAULT_SEED = "redline-redteam-v1";
export const MAX_CASES = 200;
export const MAX_ADVERSARIAL = 50;
export const DRY_RUN_CASES = 5;
const CAP_USD = 1;

interface CasesFile {
  seed: string;
  count: number;
  /** The model whose cached prose the benchmark uses. Set by the prose step. */
  model: string | null;
  modelNote: string;
  cases: CaseParams[];
  adversarial?: CaseParams[];
  adversarialModel?: string | null;
}

const readCases = (): CasesFile => {
  if (!existsSync(PATHS.cases)) throw new Error("No fixtures/redteam/cases.json yet. Run: pnpm --filter @wardline/redteam generate");
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
  writeCases({
    seed,
    count,
    model: previous?.model ?? null,
    modelNote: previous?.modelNote ?? "",
    cases: generateCases(seed, count),
    adversarial: generateAdversarialCases(seed, MAX_ADVERSARIAL),
    adversarialModel: previous?.adversarialModel ?? null,
  });
  console.log(`Wrote ${count} cases and ${MAX_ADVERSARIAL} adversarial case shells with seed ${seed}. No model calls.`);
}

async function liveSetup(): Promise<{ apiKey: string; model: ModelChoice; ledger: Ledger }> {
  if (existsSync(PATHS.env)) process.loadEnvFile(PATHS.env);
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) throw new Error("NEAR_AI_API_KEY is not set in .env.");
  const model = await chooseModel();
  console.log(`Model: ${model.id}. ${model.note}`);
  console.log(`Price per million tokens: $${(model.price.input * 1e6).toFixed(2)} in, $${(model.price.output * 1e6).toFixed(2)} out. Worst case per call: $${worstCaseCallUsd(model.price).toFixed(5)}.`);
  return { apiKey, model, ledger: readLedger(PATHS.ledger) };
}

function summarize(result: FillResult, ledger: Ledger, mode: string, before: { calls: number; cost: number }, total: number): void {
  ledger.runs.push({ at: new Date().toISOString(), mode, calls: ledger.calls - before.calls, costUsd: ledger.costUsd - before.cost });
  writeLedger(PATHS.ledger, ledger);
  const written = result.generated + result.rejected;
  console.log("");
  console.log(`This run: ${result.calls} calls, ${result.promptTokens} prompt tokens, ${result.completionTokens} completion tokens, about $${result.costUsd.toFixed(5)}.`);
  console.log(`Cases: ${result.generated} written, ${result.rejected} rejected by validation, ${result.failed} failed, ${result.cached} already cached.`);
  if (written > 0) console.log(`Average per case: ${Math.round((result.promptTokens + result.completionTokens) / written)} tokens, $${(result.costUsd / written).toFixed(5)}. ${total} cases would cost about $${((result.costUsd / written) * total).toFixed(4)}.`);
  console.log(`All runs so far: ${ledger.calls} calls, $${ledger.costUsd.toFixed(5)} of the $${CAP_USD.toFixed(2)} cap.`);
}

async function prose(flags: { "dry-run"?: boolean; limit?: string; batch?: string }): Promise<void> {
  const { apiKey, model, ledger } = await liveSetup();
  const file = readCases();
  const dryRun = flags["dry-run"] === true;
  const limit = dryRun ? DRY_RUN_CASES : Number(flags.limit ?? MAX_CASES);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CASES) throw new Error(`--limit must be 1 to ${MAX_CASES}.`);
  const before = { calls: ledger.calls, cost: ledger.costUsd };
  const result = await fillProse({
    cases: file.cases,
    limit,
    batchSize: Number(flags.batch ?? 10),
    capUsd: CAP_USD,
    model,
    client: nearAiJsonClient(model, apiKey),
    cache: new ProseCache(PATHS.prose),
    ledger,
    saveLedger: (l) => writeLedger(PATHS.ledger, l),
    log: (line) => console.log(line),
  });
  writeCases({ ...file, model: model.id, modelNote: model.note });
  summarize(result, ledger, dryRun ? "dry-run" : `prose limit ${limit}`, before, MAX_CASES);
  if (dryRun) console.log(`\nDry run done. Check the prose in fixtures/redteam/prose, then run: pnpm --filter @wardline/redteam prose --limit ${MAX_CASES}`);
}

async function adversarial(flags: { limit?: string; batch?: string }): Promise<void> {
  const { apiKey, model, ledger } = await liveSetup();
  const file = readCases();
  const cases = file.adversarial ?? generateAdversarialCases(file.seed, MAX_ADVERSARIAL);
  const limit = Number(flags.limit ?? MAX_ADVERSARIAL);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADVERSARIAL) throw new Error(`--limit must be 1 to ${MAX_ADVERSARIAL}.`);
  const before = { calls: ledger.calls, cost: ledger.costUsd };
  const result = await fillAdversarial({
    cases,
    limit,
    batchSize: Number(flags.batch ?? 10),
    capUsd: CAP_USD,
    model,
    client: nearAiJsonClient(model, apiKey),
    cache: new ProseCache(PATHS.prose),
    ledger,
    saveLedger: (l) => writeLedger(PATHS.ledger, l),
    log: (line) => console.log(line),
  });
  writeCases({ ...file, adversarial: cases, adversarialModel: model.id });
  summarize(result, ledger, `adversarial limit ${limit}`, before, MAX_ADVERSARIAL);
}

interface Usable {
  params: CaseParams;
  prose: { subject: string; body: string };
  proseKey: string;
}

function usableCases(file: CasesFile): { usable: Usable[]; adversarial: (Usable & { strategy: string })[]; excluded: number } {
  const cache = new ProseCache(PATHS.prose);
  const usable: Usable[] = [];
  const adv: (Usable & { strategy: string })[] = [];
  let excluded = 0;
  for (const params of file.cases) {
    const proseKey = file.model ? cacheKey(params, file.model) : "";
    const entry = file.model ? cache.get(proseKey) : null;
    if (!entry || entry.rejected) excluded++;
    else usable.push({ params, prose: entry.prose, proseKey });
  }
  for (const shell of file.adversarial ?? []) {
    const proseKey = file.adversarialModel ? adversarialCacheKey(shell, file.adversarialModel) : "";
    const entry = file.adversarialModel ? cache.get(proseKey) : null;
    if (!entry || entry.rejected) {
      if (file.adversarialModel) excluded++;
      continue;
    }
    adv.push({ params: withInventedAccount(shell, entry), prose: entry.prose, proseKey, strategy: entry.strategy ?? "" });
  }
  return { usable, adversarial: adv, excluded };
}

async function agent(flags: { batch?: string; variant?: string }): Promise<void> {
  const variant = (flags.variant ?? "on-file").replace("-", "_") as AgentVariant;
  if (!AGENT_VARIANTS.includes(variant)) throw new Error("--variant must be on-file or first-contact.");
  if (existsSync(PATHS.env)) process.loadEnvFile(PATHS.env);
  if (!process.env.NEAR_AI_API_KEY) throw new Error("NEAR_AI_API_KEY is not set in .env.");
  const { createAgent, buildManifest, manifestDigest, LLM_SETTINGS, MODEL_ID } = await import("@wardline/agent");
  const listing = (await (await fetch("https://cloud-api.near.ai/v1/models", { signal: AbortSignal.timeout(20_000) })).json()) as { data?: { id: string; pricing?: { input?: number; output?: number } }[] };
  const pricing = listing.data?.find((m) => m.id === MODEL_ID)?.pricing;
  if (!pricing) throw new Error(`${MODEL_ID} is not listed, so its cost cannot be bounded.`);
  const worstPerCase = LLM_SETTINGS.max_attempts * (LLM_SETTINGS.max_tokens * ((pricing.output ?? 0) / 1e6) + 6_000 * ((pricing.input ?? 0) / 1e6));

  const file = readCases();
  const picked = pickAgentCases(usableCases(file).usable);
  const llm = createAgent("llm", { version: "A" });
  const ledger = readLedger(PATHS.ledger);
  const before = { calls: ledger.calls, cost: ledger.costUsd };
  console.log(`Agent: ${MODEL_ID}, ${picked.length} cases, variant ${variant}. Worst case per case: $${worstPerCase.toFixed(4)}.`);
  const result = await runAgentDecisions(picked, {
    batchSize: Number(flags.batch ?? 10),
    capUsd: CAP_USD,
    ledger,
    saveLedger: (l) => writeLedger(PATHS.ledger, l),
    log: (line) => console.log(line),
    decide: (intake, context) => llm.decideWithReport(intake, context) as never,
    cache: new AgentCache(PATHS.agent),
    manifestDigest: manifestDigest(buildManifest("A")),
    worstPerCase,
    variant,
  });
  ledger.runs.push({ at: new Date().toISOString(), mode: `agent comparison, ${variant}`, calls: ledger.calls - before.calls, costUsd: ledger.costUsd - before.cost });
  writeLedger(PATHS.ledger, ledger);
  console.log(`Decided ${result.decided}, ${result.cached} already cached. This run: ${ledger.calls - before.calls} calls, about $${(ledger.costUsd - before.cost).toFixed(5)}. All runs: $${ledger.costUsd.toFixed(5)} of $${CAP_USD.toFixed(2)}.`);
}

async function bench(flags: { engine?: string; "payee-check"?: string }): Promise<void> {
  const mode = flags.engine ?? "stub";
  if (mode !== "stub" && mode !== "live") throw new Error("--engine must be stub or live.");
  const engine = await chooseEngine(mode, flags["payee-check"]);
  const file = readCases();
  const { usable, adversarial: adv, excluded } = usableCases(file);
  if (usable.length === 0) throw new Error("No case has prose yet. Run the prose step first.");

  // One untimed check per family first, so module loading and JIT warm-up do not land in the latency numbers.
  const firstOfEach = new Map([...usable, ...adv].map((u) => [u.params.family, u.params] as const));
  for (const params of firstOfEach.values()) await runCase(params, engine.engine);

  const results: CaseResult[] = [];
  for (const u of [...usable, ...adv]) results.push(await runCase(u.params, engine.engine, u.prose.body));

  const byId = new Map(results.map((r) => [r.id, r]));
  const agentCache = new AgentCache(PATHS.agent);
  const comparisons: Comparison[] = [];
  if (existsSync(PATHS.agent)) {
    const { buildManifest, manifestDigest, MODEL_ID } = await import("@wardline/agent");
    const current = manifestDigest(buildManifest("A"));
    const digest = recordedDigest(current, agentCache.digests());
    for (const variant of AGENT_VARIANTS) {
      const rows: ComparisonRow[] = [];
      const entries: AgentDecisionEntry[] = [];
      for (const u of pickAgentCases(usable)) {
        const entry = agentCache.get(agentCacheKey(u.proseKey, digest, variant));
        const result = byId.get(u.params.id);
        if (!entry || !result) continue;
        entries.push(entry);
        const agentAlonePays = entry.decision === "PAY";
        rows.push({ id: u.params.id, family: u.params.family, agentDecision: entry.decision, wardlineVerdict: result.verdict, agentAlonePays, combinedPays: agentAlonePays && result.verdict === "PAY" });
      }
      if (rows.length) comparisons.push({ ...compare(rows, entries, MODEL_ID, isAttack, variant), manifestDigest: digest, currentManifest: digest === current });
    }
  }

  const report = buildReport({
    seed: file.seed,
    results,
    excluded,
    engine: { name: engine.name, note: engine.note },
    model: { id: file.model, note: file.modelNote },
    ledger: readLedger(PATHS.ledger),
    adversarialMeta: new Map(adv.map((a) => [a.params.id, { strategy: a.strategy, vendorName: a.params.vendor.name }])),
    agentComparisons: comparisons,
  });
  mkdirSync(PATHS.evidence, { recursive: true });
  writeFileSync(mode === "live" ? PATHS.reportLive : PATHS.report, `${JSON.stringify(report, null, 2)}\n`);
  if (mode === "stub") writeFileSync(PATHS.doc, renderMarkdown(report));
  const h = report.headline;
  console.log(`Engine: ${report.engine.name}. ${report.engine.note}`);
  console.log(`Cases: ${report.cases.written} written plus ${report.cases.adversarial} adversarial, ${excluded} without usable text left out.`);
  console.log(`Attacks stopped: ${(h.attackCatchRate * 100).toFixed(1)}%. Expected verdict and reason: ${(h.attackExactMatchRate * 100).toFixed(1)}%. Legit false positives: ${(h.legitFalsePositiveRate * 100).toFixed(1)}%. Unsafe PAY: ${h.unsafePays}.`);
  if (h.adversarialCatchRate !== null) console.log(`Attacks we didn't write, stopped: ${(h.adversarialCatchRate * 100).toFixed(1)}%.`);
  for (const a of report.agentComparisons) {
    console.log(`Agent (${a.variant}) alone let ${a.agentAlone.unsafePayees} of ${a.attacks} unsafe payees through; agent plus Wardline let ${a.agentWithWardline.unsafePayees}.`);
  }
  console.log(`Latency p50 ${h.latencyP50Ms} ms, p95 ${h.latencyP95Ms} ms.`);
  console.log(mode === "live" ? "Wrote evidence/redteam/report-live.json." : "Wrote evidence/redteam/report.json and docs/REDTEAM.md.");
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    count: { type: "string" },
    seed: { type: "string" },
    "dry-run": { type: "boolean" },
    limit: { type: "string" },
    batch: { type: "string" },
    engine: { type: "string" },
    "payee-check": { type: "string" },
    variant: { type: "string" },
  },
});

const commands: Record<string, () => Promise<void>> = {
  generate: async () => generate(values),
  prose: () => prose(values),
  adversarial: () => adversarial(values),
  agent: () => agent(values),
  bench: () => bench(values),
};
const run = commands[positionals[0] ?? ""];
if (!run) {
  console.error("Usage: tsx src/cli.ts generate | prose [--dry-run | --limit 200] | adversarial [--limit 50] | agent [--variant on-file|first-contact] | bench [--engine stub|live] [--payee-check path]");
  process.exit(2);
}
run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
