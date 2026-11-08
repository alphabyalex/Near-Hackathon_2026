import { charge, costOf, worstCaseCallUsd, type JsonClient, type JsonSpec, type Ledger, type ModelChoice, type Purpose, type Usage } from "./llm.js";
import type { CaseParams } from "./params.js";
import { adversarialJob, proseJob, type CachedProse, type ProseCache } from "./prose.js";

export const ATTEMPTS_PER_CASE = 2;

export interface BudgetOptions {
  batchSize: number;
  capUsd: number;
  ledger: Ledger;
  /** Called after every batch, so spend is on disk before the next one starts. */
  saveLedger: (ledger: Ledger) => void;
  log?: (line: string) => void;
}

/**
 * Runs work in batches. Before each batch it reserves `worstPerItem` for every item and shrinks or
 * stops the batch if that would pass the cap, counting everything already in the ledger.
 */
export async function runBudgeted<I>(items: I[], worstPerItem: number, options: BudgetOptions, work: (item: I) => Promise<void>): Promise<{ stoppedForBudget: boolean }> {
  const log = options.log ?? (() => undefined);
  for (let start = 0; start < items.length; ) {
    const affordable = Math.floor((options.capUsd - options.ledger.costUsd) / worstPerItem);
    const size = Math.min(options.batchSize, items.length - start, affordable);
    if (size <= 0) {
      log(`Stopped: spent $${options.ledger.costUsd.toFixed(4)} of the $${options.capUsd.toFixed(2)} cap, and the next item could cost up to $${worstPerItem.toFixed(4)}.`);
      return { stoppedForBudget: true };
    }
    const batch = items.slice(start, start + size);
    start += size;
    await Promise.all(batch.map(work));
    options.saveLedger(options.ledger);
    log(`Batch of ${batch.length} done. $${options.ledger.costUsd.toFixed(4)} spent in total.`);
  }
  return { stoppedForBudget: false };
}

/** What a model call produces for one case: how to key, prompt, parse, check and store it. */
export interface Job<T> {
  purpose: Purpose;
  key(p: CaseParams, model: string): string;
  prompt(p: CaseParams): { system: string; user: string };
  spec: JsonSpec<T>;
  validate(p: CaseParams, value: T): string | null;
  entry(p: CaseParams, value: T, meta: { key: string; model: string; usage: Usage; costUsd: number; createdAt: string; rejected: string | null }): CachedProse;
}

export interface FillOptions extends BudgetOptions {
  cases: CaseParams[];
  limit: number;
  model: ModelChoice;
  client: JsonClient;
  cache: ProseCache;
  now?: () => Date;
}

export interface FillResult {
  generated: number;
  rejected: number;
  cached: number;
  failed: number;
  stoppedForBudget: boolean;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/**
 * Fills the first `limit` cases that have no cached result. A cached case is never sent again,
 * including one that failed validation. Bad output is retried once; an HTTP error is not.
 */
export async function fillJob<T>(job: Job<T>, options: FillOptions): Promise<FillResult> {
  const { cache, model, client, ledger } = options;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const result: FillResult = { generated: 0, rejected: 0, cached: 0, failed: 0, stoppedForBudget: false, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
  const record = (usage: Usage, ok: boolean) => {
    const cost = costOf(usage, model.price);
    charge(ledger, job.purpose, usage, cost, ok);
    result.calls++;
    result.promptTokens += usage.promptTokens;
    result.completionTokens += usage.completionTokens;
    result.costUsd += cost;
  };

  const todo: CaseParams[] = [];
  for (const params of options.cases.slice(0, options.limit)) {
    if (cache.get(job.key(params, model.id))) result.cached++;
    else todo.push(params);
  }
  ledger.model = model.id;

  const { stoppedForBudget } = await runBudgeted(todo, worstCaseCallUsd(model.price) * ATTEMPTS_PER_CASE, options, async (params) => {
    const { system, user } = job.prompt(params);
    const key = job.key(params, model.id);
    let lastReason = "no attempt";
    for (let attempt = 1; attempt <= ATTEMPTS_PER_CASE; attempt++) {
      let usage: Usage = { promptTokens: 0, completionTokens: 0 };
      try {
        const reply = await client(system, user, job.spec);
        usage = reply.usage;
        record(usage, true);
        const problem = job.validate(params, reply.value);
        if (problem === null || attempt === ATTEMPTS_PER_CASE) {
          cache.put(job.entry(params, reply.value, { key, model: model.id, usage, costUsd: costOf(usage, model.price), createdAt: now().toISOString(), rejected: problem }));
          if (problem === null) result.generated++;
          else result.rejected++;
          return;
        }
        lastReason = problem;
      } catch (error) {
        const known = (error as { usage?: Usage }).usage;
        if (known) usage = known;
        record(usage, false);
        lastReason = error instanceof Error ? error.message : String(error);
        if (!known) break; // HTTP or network error: do not retry and spend again.
      }
    }
    result.failed++;
    log(`${params.id}: nothing written (${lastReason})`);
  });
  result.stoppedForBudget = stoppedForBudget;
  return result;
}

export const fillProse = (options: FillOptions): Promise<FillResult> => fillJob(proseJob, options);
export const fillAdversarial = (options: FillOptions): Promise<FillResult> => fillJob(adversarialJob, options);
