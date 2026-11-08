import type { Ledger } from "./llm.js";
import { ATTACK_FAMILIES, FAMILIES, LEGIT_FAMILIES, type Family } from "./params.js";
import type { CaseResult } from "./runner.js";

export const FAMILY_LABELS: Record<Family, string> = {
  bank_change_lookalike: "Bank details changed, look-alike NEAR account",
  invoice_injection: "Invoice with injected payment instruction",
  x402_payto_swap: "x402 offer with swapped payTo",
  evm_address_poisoning: "EVM address poisoning",
  legit_recurring: "Legit recurring invoice",
  legit_new_account: "Legit vendor with a new account",
};

export interface FamilyStats {
  family: Family;
  label: string;
  cases: number;
  caught: number;
  verdictMatch: number;
  exactMatch: number;
  unsafe: number;
  falsePositives: number;
}

export interface RedteamReport {
  schema: "redline-redteam-report-v1";
  seed: string;
  engine: { name: "stub" | "live"; note: string };
  model: { id: string | null; note: string };
  llm: { calls: number; failedCalls: number; promptTokens: number; completionTokens: number; estimatedUsd: number };
  cases: { total: number; attacks: number; legit: number; excluded: number };
  headline: {
    attackCatchRate: number;
    attackVerdictMatchRate: number;
    attackExactMatchRate: number;
    legitFalsePositiveRate: number;
    unsafePays: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
  };
  families: FamilyStats[];
  lookalikeStrategies: { strategy: string; cases: number; flaggedAsLookalike: number; caught: number }[];
  results: CaseResult[];
}

const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
}

export function buildReport(input: {
  seed: string;
  results: CaseResult[];
  excluded: number;
  engine: RedteamReport["engine"];
  model: RedteamReport["model"];
  ledger: Ledger;
}): RedteamReport {
  const { results } = input;
  const attacks = results.filter((r) => ATTACK_FAMILIES.includes(r.family));
  const legit = results.filter((r) => LEGIT_FAMILIES.includes(r.family));
  const families = FAMILIES.map((family): FamilyStats => {
    const rows = results.filter((r) => r.family === family);
    return {
      family,
      label: FAMILY_LABELS[family],
      cases: rows.length,
      caught: rows.filter((r) => r.caught).length,
      verdictMatch: rows.filter((r) => r.verdictMatch).length,
      exactMatch: rows.filter((r) => r.exactMatch).length,
      unsafe: rows.filter((r) => r.unsafe).length,
      falsePositives: rows.filter((r) => r.falsePositive).length,
    };
  });
  const strategies = [...new Set(results.map((r) => r.lookalike).filter((s): s is NonNullable<typeof s> => s !== null))].sort();
  const latencies = results.map((r) => r.latencyMs);
  const round = (ms: number) => Math.round(ms * 1000) / 1000;
  return {
    schema: "redline-redteam-report-v1",
    seed: input.seed,
    engine: input.engine,
    model: input.model,
    llm: {
      calls: input.ledger.calls,
      failedCalls: input.ledger.failedCalls,
      promptTokens: input.ledger.promptTokens,
      completionTokens: input.ledger.completionTokens,
      estimatedUsd: Math.round(input.ledger.costUsd * 1e6) / 1e6,
    },
    cases: { total: results.length, attacks: attacks.length, legit: legit.length, excluded: input.excluded },
    headline: {
      attackCatchRate: ratio(attacks.filter((r) => r.caught).length, attacks.length),
      attackVerdictMatchRate: ratio(attacks.filter((r) => r.verdictMatch).length, attacks.length),
      attackExactMatchRate: ratio(attacks.filter((r) => r.exactMatch).length, attacks.length),
      legitFalsePositiveRate: ratio(legit.filter((r) => r.falsePositive).length, legit.length),
      unsafePays: results.filter((r) => r.unsafe).length,
      latencyP50Ms: round(percentile(latencies, 0.5)),
      latencyP95Ms: round(percentile(latencies, 0.95)),
    },
    families,
    lookalikeStrategies: strategies.map((strategy) => {
      const rows = results.filter((r) => r.lookalike === strategy);
      return { strategy, cases: rows.length, flaggedAsLookalike: rows.filter((r) => r.reasons.includes("LOOKALIKE_ACCOUNT")).length, caught: rows.filter((r) => r.caught).length };
    }),
    results: results.map((r) => ({ ...r, latencyMs: round(r.latencyMs) })),
  };
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

export function renderMarkdown(report: RedteamReport): string {
  const h = report.headline;
  const lines = [
    "# Red-team benchmark",
    "",
    "Fictional payment-fraud cases run through Redline. Code fixes each case's parameters and expected verdict; a language model only writes the email, invoice or offer text around them.",
    "",
    "Rerun offline from the committed fixtures: `pnpm --filter @redline/redteam bench`",
    "",
    "## Headline",
    "",
    "| Measure | Result |",
    "| --- | --- |",
    `| Cases | ${report.cases.total} (${report.cases.attacks} attacks, ${report.cases.legit} legit) |`,
    `| Attacks stopped (HOLD or BLOCK) | ${pct(h.attackCatchRate * report.cases.attacks, report.cases.attacks)} |`,
    `| Attacks with the expected verdict | ${pct(h.attackVerdictMatchRate * report.cases.attacks, report.cases.attacks)} |`,
    `| Attacks with the expected verdict and reason | ${pct(h.attackExactMatchRate * report.cases.attacks, report.cases.attacks)} |`,
    `| False positives on legit cases | ${pct(h.legitFalsePositiveRate * report.cases.legit, report.cases.legit)} |`,
    `| Unsafe PAY | ${h.unsafePays} |`,
    `| Latency per check, p50 / p95 | ${h.latencyP50Ms} ms / ${h.latencyP95Ms} ms |`,
    `| Verdict engine | ${report.engine.name}. ${report.engine.note} |`,
    `| Prose model | ${report.model.id ?? "none"}. ${report.model.note} |`,
    `| NEAR AI usage | ${report.llm.calls} calls, ${report.llm.promptTokens + report.llm.completionTokens} tokens, about $${report.llm.estimatedUsd.toFixed(4)} |`,
    "",
    "## By family",
    "",
    "| Family | Cases | Stopped | Expected verdict | Verdict and reason | Unsafe PAY | False positives |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.families.map((f) => {
      const attack = ATTACK_FAMILIES.includes(f.family);
      return `| ${f.label} | ${f.cases} | ${attack ? pct(f.caught, f.cases) : "n/a"} | ${pct(f.verdictMatch, f.cases)} | ${pct(f.exactMatch, f.cases)} | ${f.unsafe} | ${attack ? "n/a" : f.falsePositives} |`;
    }),
    "",
    "## Look-alike strategies",
    "",
    "| Strategy | Cases | Flagged as look-alike | Stopped |",
    "| --- | --- | --- | --- |",
    ...report.lookalikeStrategies.map((s) => `| ${s.strategy} | ${s.cases} | ${pct(s.flaggedAsLookalike, s.cases)} | ${pct(s.caught, s.cases)} |`),
    "",
    "## How to read this",
    "",
    "- Latency is the engine call in process, without network.",
    "- The verdict engine's look-alike rules and these attack families were written by the same team. A strategy those rules do not model, such as an abbreviation of the vendor name, still gets stopped when the agent names the vendor, but as ACCOUNT_NOT_VENDORS rather than LOOKALIKE_ACCOUNT.",
    "- Every company, person, domain and account in the fixtures is fictional. Domains use the reserved .example TLD.",
    "",
  ];
  return lines.join("\n");
}
