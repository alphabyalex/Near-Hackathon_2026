import { costOf, worstCaseCallUsd, type Ledger, type ModelChoice, type ProseClient } from "./llm.js";
import type { CaseParams } from "./params.js";
import { buildPrompt, cacheKey, validateProse, type CachedProse, type ProseCache } from "./prose.js";

export const ATTEMPTS_PER_CASE = 2;

export interface FillOptions {
  cases: CaseParams[];
  limit: number;
  batchSize: number;
  capUsd: number;
  model: ModelChoice;
  client: ProseClient;
  cache: ProseCache;
  ledger: Ledger;
  /** Called after every batch, so spend is on disk before the next one starts. */
  saveLedger: (ledger: Ledger) => void;
  log?: (line: string) => void;
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
 * Writes prose for the first `limit` cases that have none. Cached cases are never sent again,
 * including ones that failed validation. Before each batch it reserves the worst case for every
 * call in it and shrinks or stops the batch if that would pass the cap.
 */
export async function fillProse(options: FillOptions): Promise<FillResult> {
  const { cases, cache, model, client, ledger } = options;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const result: FillResult = { generated: 0, rejected: 0, cached: 0, failed: 0, stoppedForBudget: false, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };

  const todo: CaseParams[] = [];
  for (const params of cases.slice(0, options.limit)) {
    if (cache.get(cacheKey(params, model.id))) result.cached++;
    else todo.push(params);
  }

  const worstPerCase = worstCaseCallUsd(model.price) * ATTEMPTS_PER_CASE;
  ledger.model = model.id;

  for (let start = 0; start < todo.length; ) {
    const headroom = options.capUsd - ledger.costUsd;
    const affordable = Math.floor(headroom / worstPerCase);
    const size = Math.min(options.batchSize, todo.length - start, affordable);
    if (size <= 0) {
      result.stoppedForBudget = true;
      log(`Stopped: spent $${ledger.costUsd.toFixed(4)} of the $${options.capUsd.toFixed(2)} cap, and the next case could cost up to $${worstPerCase.toFixed(4)}.`);
      break;
    }
    const batch = todo.slice(start, start + size);
    start += size;

    await Promise.all(
      batch.map(async (params) => {
        const { system, user } = buildPrompt(params);
        const key = cacheKey(params, model.id);
        let lastReason = "no attempt";
        for (let attempt = 1; attempt <= ATTEMPTS_PER_CASE; attempt++) {
          let usage = { promptTokens: 0, completionTokens: 0 };
          try {
            const completion = await client(system, user);
            usage = completion.usage;
            record(usage, true);
            const problem = validateProse(params, completion.prose);
            const entry: CachedProse = {
              key,
              caseId: params.id,
              model: model.id,
              promptVersion: "redteam-prose-v1",
              prose: completion.prose,
              usage,
              costUsd: costOf(usage, model.price),
              createdAt: now().toISOString(),
              rejected: problem,
            };
            if (problem === null || attempt === ATTEMPTS_PER_CASE) {
              cache.put(entry);
              if (problem === null) result.generated++;
              else result.rejected++;
              return;
            }
            lastReason = problem;
          } catch (error) {
            const known = (error as { usage?: typeof usage }).usage;
            if (known) usage = known;
            record(usage, false);
            lastReason = error instanceof Error ? error.message : String(error);
            if (!known) break; // HTTP or network error: do not retry and spend again.
          }
        }
        result.failed++;
        log(`${params.id}: no prose (${lastReason})`);
      }),
    );
    options.saveLedger(ledger);
    log(`Batch done: ${result.generated} written, ${result.rejected} rejected, ${result.failed} failed, $${ledger.costUsd.toFixed(4)} spent in total.`);
  }
  return result;

  function record(usage: { promptTokens: number; completionTokens: number }, ok: boolean): void {
    const cost = costOf(usage, model.price);
    ledger.calls++;
    if (!ok) ledger.failedCalls++;
    ledger.promptTokens += usage.promptTokens;
    ledger.completionTokens += usage.completionTokens;
    ledger.costUsd += cost;
    result.calls++;
    result.promptTokens += usage.promptTokens;
    result.completionTokens += usage.completionTokens;
    result.costUsd += cost;
  }
}
