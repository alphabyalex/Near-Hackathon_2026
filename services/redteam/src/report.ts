import type { Comparison } from "./agent.js";
import type { Ledger, Tally } from "./llm.js";
import { ATTACK_FAMILIES, EVM_CHAIN, LEGIT_FAMILIES, type Family, type WrittenFamily } from "./params.js";
import type { CaseResult } from "./runner.js";

export const FAMILY_LABELS: Record<Family, string> = {
  bank_change_lookalike: "Bank details changed, look-alike NEAR account",
  invoice_injection: "Invoice with injected payment instruction",
  x402_payto_swap: "x402 offer with swapped payTo",
  evm_address_poisoning: "EVM address poisoning",
  legit_recurring: "Legit recurring invoice",
  legit_new_account: "Legit vendor with a new account",
  adversarial: "Attacks we didn't write (invented by the model)",
};

const WRITTEN: readonly WrittenFamily[] = ["bank_change_lookalike", "invoice_injection", "x402_payto_swap", "evm_address_poisoning", "legit_recurring", "legit_new_account"];

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

export interface AdversarialRow {
  id: string;
  chain: string;
  account: string;
  realAccount: string;
  relation: string;
  modelStrategy: string;
  verdict: string;
  reasons: string[];
}

export interface RedteamReport {
  schema: "wardline-redteam-report-v2";
  seed: string;
  engine: { name: "stub" | "live"; note: string };
  model: { id: string | null; note: string };
  llm: Tally & { byPurpose: Ledger["byPurpose"] };
  cases: { written: number; attacks: number; legit: number; adversarial: number; excluded: number };
  headline: {
    attackCatchRate: number;
    attackVerdictMatchRate: number;
    attackExactMatchRate: number;
    legitFalsePositiveRate: number;
    unsafePays: number;
    adversarialCatchRate: number | null;
    latencyP50Ms: number;
    latencyP95Ms: number;
  };
  families: FamilyStats[];
  lookalikeStrategies: { strategy: string; cases: number; flaggedAsLookalike: number; caught: number }[];
  adversarial: { relations: { relation: string; cases: number; caught: number; flaggedAsLookalike: number }[]; rows: AdversarialRow[] } | null;
  agentComparisons: Comparison[];
  findings: string[];
  results: CaseResult[];
}

const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
}

function stats(family: Family, rows: CaseResult[]): FamilyStats {
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
}

const firstLabel = (caip10: string): string => (caip10.split(":")[2] ?? "").split(".")[0] ?? "";
const plain = (s: string): string => s.replace(/[0-9_-]/g, "");

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** How the model's account relates to the real one, judged by code, not by the model. */
export function relationOf(account: string, real: string, vendorName: string): string {
  if (account.startsWith(`${EVM_CHAIN}:`)) {
    const a = account.split(":")[2] ?? "";
    const r = real.split(":")[2] ?? "";
    let common = 0;
    while (common < a.length && a[common] === r[common]) common++;
    if (a.slice(2, 6) === r.slice(2, 6) && a.slice(-4) === r.slice(-4)) return "EVM: same first and last 4 hex";
    if (common >= 30) return "EVM: near-identical, only the last characters changed";
    if (a.slice(2, 6) === r.slice(2, 6) || a.slice(-4) === r.slice(-4)) return "EVM: same first or last 4 hex";
    return "EVM: unrelated address";
  }
  const label = firstLabel(account);
  const realLabel = firstLabel(real);
  const words = vendorName.toLowerCase().split(/\s+/);
  if (plain(label) === plain(realLabel)) return "NEAR: same letters, digits or separators changed";
  if (editDistance(plain(label), plain(realLabel)) <= 2) return "NEAR: typo or confusable of the real name";
  if (label.includes(plain(realLabel)) || words.every((w) => label.includes(w))) return "NEAR: real name plus extra words";
  if (words.some((w) => w.length > 3 && label.includes(w))) return "NEAR: part of the vendor name";
  return "NEAR: unrelated name";
}

export function buildReport(input: {
  seed: string;
  results: CaseResult[];
  excluded: number;
  engine: RedteamReport["engine"];
  model: RedteamReport["model"];
  ledger: Ledger;
  adversarialMeta?: Map<string, { strategy: string; vendorName: string }>;
  agentComparisons?: Comparison[];
}): RedteamReport {
  const written = input.results.filter((r) => r.family !== "adversarial");
  const adversarial = input.results.filter((r) => r.family === "adversarial");
  const attacks = written.filter((r) => ATTACK_FAMILIES.includes(r.family));
  const legit = written.filter((r) => LEGIT_FAMILIES.includes(r.family));
  const latencies = input.results.map((r) => r.latencyMs);
  const round = (ms: number) => Math.round(ms * 1000) / 1000;
  const strategies = [...new Set(written.map((r) => r.lookalike).filter((s): s is NonNullable<typeof s> => s !== null))].sort();
  const lookalikeStrategies = strategies.map((strategy) => {
    const rows = written.filter((r) => r.lookalike === strategy);
    return { strategy, cases: rows.length, flaggedAsLookalike: rows.filter((r) => r.reasons.includes("LOOKALIKE_ACCOUNT")).length, caught: rows.filter((r) => r.caught).length };
  });

  const advRows: AdversarialRow[] = adversarial.map((r) => {
    const meta = input.adversarialMeta?.get(r.id);
    return {
      id: r.id,
      chain: r.payee.split(":").slice(0, 2).join(":"),
      account: r.payee,
      realAccount: r.realAccount,
      relation: relationOf(r.payee, r.realAccount, meta?.vendorName ?? ""),
      modelStrategy: meta?.strategy ?? "",
      verdict: r.verdict,
      reasons: r.reasons,
    };
  });
  const relations = [...new Set(advRows.map((r) => r.relation))].sort().map((relation) => {
    const rows = advRows.filter((r) => r.relation === relation);
    return { relation, cases: rows.length, caught: rows.filter((r) => r.verdict !== "PAY").length, flaggedAsLookalike: rows.filter((r) => r.reasons.includes("LOOKALIKE_ACCOUNT")).length };
  });

  const findings: string[] = [];
  for (const s of lookalikeStrategies) {
    if (s.flaggedAsLookalike < s.cases) {
      findings.push(
        `Look-alike strategy "${s.strategy}": ${s.cases - s.flaggedAsLookalike} of ${s.cases} were not flagged as LOOKALIKE_ACCOUNT. ${s.caught === s.cases ? "All were still stopped, by ACCOUNT_NOT_VENDORS or NOT_IN_REGISTRY, because the account is not the vendor's." : `${s.cases - s.caught} got PAY.`} Finding for the payee-check engine: detect this pattern explicitly.`,
      );
    }
  }
  for (const r of relations) {
    if (r.flaggedAsLookalike < r.cases && !r.relation.includes("unrelated")) {
      findings.push(
        `Model-invented "${r.relation}": ${r.cases - r.flaggedAsLookalike} of ${r.cases} were not flagged as LOOKALIKE_ACCOUNT. ${r.caught === r.cases ? "All were still stopped by the registry, because the account is not the vendor's." : `${r.cases - r.caught} got PAY.`} Finding for the payee-check engine: treat this pattern as a look-alike.`,
      );
    }
  }
  const advMissed = advRows.filter((r) => r.verdict === "PAY");
  if (advMissed.length > 0) findings.push(`${advMissed.length} model-invented attacks got PAY: ${advMissed.map((r) => r.id).join(", ")}.`);

  return {
    schema: "wardline-redteam-report-v2",
    seed: input.seed,
    engine: input.engine,
    model: input.model,
    llm: {
      calls: input.ledger.calls,
      failedCalls: input.ledger.failedCalls,
      promptTokens: input.ledger.promptTokens,
      completionTokens: input.ledger.completionTokens,
      costUsd: Math.round(input.ledger.costUsd * 1e6) / 1e6,
      byPurpose: input.ledger.byPurpose,
    },
    cases: { written: written.length, attacks: attacks.length, legit: legit.length, adversarial: adversarial.length, excluded: input.excluded },
    headline: {
      attackCatchRate: ratio(attacks.filter((r) => r.caught).length, attacks.length),
      attackVerdictMatchRate: ratio(attacks.filter((r) => r.verdictMatch).length, attacks.length),
      attackExactMatchRate: ratio(attacks.filter((r) => r.exactMatch).length, attacks.length),
      legitFalsePositiveRate: ratio(legit.filter((r) => r.falsePositive).length, legit.length),
      unsafePays: input.results.filter((r) => r.unsafe).length,
      adversarialCatchRate: adversarial.length === 0 ? null : ratio(adversarial.filter((r) => r.caught).length, adversarial.length),
      latencyP50Ms: round(percentile(latencies, 0.5)),
      latencyP95Ms: round(percentile(latencies, 0.95)),
    },
    families: [...WRITTEN.map((f) => stats(f, written.filter((r) => r.family === f))), ...(adversarial.length ? [stats("adversarial", adversarial)] : [])],
    lookalikeStrategies,
    adversarial: adversarial.length ? { relations, rows: advRows } : null,
    agentComparisons: input.agentComparisons ?? [],
    findings,
    results: input.results.map((r) => ({ ...r, latencyMs: round(r.latencyMs) })),
  };
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");

export function renderMarkdown(report: RedteamReport): string {
  const h = report.headline;
  const c = report.cases;
  const tokens = report.llm.promptTokens + report.llm.completionTokens;
  const lines = [
    "# Red-team benchmark",
    "",
    "Fictional payment-fraud cases run through Wardline. Code fixes each case's parameters and expected verdict. A language model only writes the email, invoice or offer text around them, except in the last family, where it also invents the attacker's account.",
    "",
    "Rerun offline from the committed fixtures: `pnpm --filter @wardline/redteam bench`. Add `--engine live` once `packages/payee-check` merges.",
    "",
    "## Read this first",
    "",
    `- **The verdicts come from the ${report.engine.name} engine.** ${report.engine.note}`,
    "- **Families 1 to 6 were written by the same team that wrote the engine's rules,** so they test the rules we meant to write. The model-invented family below is the closest thing here to an outside attacker.",
    "- Latency is the engine call in process, without network: the median of 5 timings per case.",
    "- Every company, person, domain and account in the fixtures is fictional. Domains use the reserved .example TLD.",
    "",
    "## Headline (families 1 to 6)",
    "",
    "| Measure | Result |",
    "| --- | --- |",
    `| Cases | ${c.written} (${c.attacks} attacks, ${c.legit} legit) |`,
    `| Attacks stopped (HOLD or BLOCK) | ${pct(h.attackCatchRate * c.attacks, c.attacks)} |`,
    `| Attacks with the expected verdict | ${pct(h.attackVerdictMatchRate * c.attacks, c.attacks)} |`,
    `| Attacks with the expected verdict and reason | ${pct(h.attackExactMatchRate * c.attacks, c.attacks)} |`,
    `| False positives on legit cases | ${pct(h.legitFalsePositiveRate * c.legit, c.legit)} |`,
    `| Unsafe PAY, all families | ${h.unsafePays} |`,
    `| Latency per check, p50 / p95 | ${h.latencyP50Ms} ms / ${h.latencyP95Ms} ms |`,
    `| Text model | ${report.model.id ?? "none"}. ${report.model.note} |`,
    `| NEAR AI usage, all runs | ${report.llm.calls} calls, ${tokens.toLocaleString("en-US")} tokens, about $${report.llm.costUsd.toFixed(4)} |`,
    "",
    "## By family",
    "",
    "| Family | Cases | Stopped | Expected verdict | Verdict and reason | Unsafe PAY | False positives |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.families.map((f) => {
      const attack = f.family !== "legit_recurring" && f.family !== "legit_new_account";
      return `| ${f.label} | ${f.cases} | ${attack ? pct(f.caught, f.cases) : "n/a"} | ${pct(f.verdictMatch, f.cases)} | ${f.family === "adversarial" ? "n/a" : pct(f.exactMatch, f.cases)} | ${f.unsafe} | ${attack ? "n/a" : f.falsePositives} |`;
    }),
    "",
    "## Look-alike strategies (family 1, plus EVM poisoning)",
    "",
    "| Strategy | Cases | Flagged as look-alike | Stopped |",
    "| --- | --- | --- | --- |",
    ...report.lookalikeStrategies.map((s) => `| ${s.strategy} | ${s.cases} | ${pct(s.flaggedAsLookalike, s.cases)} | ${pct(s.caught, s.cases)} |`),
    "",
  ];

  if (report.adversarial) {
    lines.push(
      "## Attacks we didn't write",
      "",
      `The model got only the real vendor's name, domain and verified account, and invented the attacker's account and pretext. The code rejects an invented account that is invalid or is the verified one, so the expected verdict is never PAY. ${c.adversarial} cases, ${pct((h.adversarialCatchRate ?? 0) * c.adversarial, c.adversarial)} stopped.`,
      "",
      "| What the model did, judged by code | Cases | Stopped | Flagged as look-alike |",
      "| --- | --- | --- | --- |",
      ...report.adversarial.relations.map((r) => `| ${r.relation} | ${r.cases} | ${pct(r.caught, r.cases)} | ${pct(r.flaggedAsLookalike, r.cases)} |`),
      "",
      "Every invented account, with the model's own description of its trick:",
      "",
      "| Case | Invented account | Real account | Model's strategy | Verdict |",
      "| --- | --- | --- | --- | --- |",
      ...report.adversarial.rows.map((r) => `| ${r.id} | \`${r.account.split(":")[2]}\` | \`${r.realAccount.split(":")[2]}\` | ${cell(r.modelStrategy)} | ${r.verdict} |`),
      "",
    );
  }

  const onFile = report.agentComparisons.find((x) => x.variant === "on_file");
  const first = report.agentComparisons.find((x) => x.variant === "first_contact");
  const shown = [onFile, first].filter((x): x is Comparison => x !== undefined);
  if (shown.length > 0) {
    const label = (x: Comparison) => (x.variant === "on_file" ? "Account on file" : "First contact");
    const any = shown[0] as Comparison;
    const calls = shown.reduce((n, x) => n + x.calls, 0);
    const tokens = shown.reduce((n, x) => n + x.tokens, 0);
    const cost = shown.reduce((n, x) => n + x.costUsd, 0);
    lines.push(
      "## Invoice agent alone vs agent plus Wardline",
      "",
      `${any.cases} cases per setup, ${AGENT_NOTE}. The agent is the repo's invoice agent on ${any.model}, given trusted records in which the invoice matches an open approved payable. "Agent alone" pays the account named in the document whenever the agent decides PAY. "Agent plus Wardline" also needs Wardline's PAY for that account.`,
      "",
      ...(any.currentManifest === false
        ? [`Agent decisions were recorded against agent manifest \`${any.manifestDigest}\`, before the agent's prompt last changed. Rerun \`pnpm --filter @wardline/redteam agent\` to record the current agent.`, ""]
        : []),
      "- **Account on file:** the agent's vendor record holds the vendor's real payout account from earlier business.",
      "- **First contact:** a first purchase or a first x402 payment. The vendor record was created from this same message, so the only account the agent has on file is the one the message names.",
      "",
      `| | ${shown.map((x) => `${label(x)}: agent alone | ${label(x)}: agent plus Wardline`).join(" | ")} |`,
      `| --- | ${shown.map(() => "--- | ---").join(" | ")} |`,
      `| Unsafe payees let through (of ${any.attacks} attacks) | ${shown.map((x) => `${x.agentAlone.unsafePayees} | ${x.agentWithWardline.unsafePayees}`).join(" | ")} |`,
      `| Legit recurring invoices paid (of ${any.legitRecurring}) | ${shown.map((x) => `${x.agentAlone.legitPaid} | ${x.agentWithWardline.legitPaid}`).join(" | ")} |`,
      `| New accounts in cooling-off paid | ${shown.map((x) => `${x.agentAlone.coolingOffPaid} | ${x.agentWithWardline.coolingOffPaid}`).join(" | ")} |`,
      "",
      `For reference, Wardline's payee verdict on its own let ${any.wardlineAlone.unsafePayees} unsafe payees through and answered PAY on ${any.wardlineAlone.legitPaid} of ${any.legitRecurring} legit recurring invoices. It does not depend on what the agent has on file.`,
      "",
      AGENT_CAVEAT,
      "",
      `Agent calls, both setups: ${calls}, ${tokens.toLocaleString("en-US")} tokens, about $${cost.toFixed(4)}.`,
      "",
      `| Case | Family | Wardline | ${shown.map((x) => `${label(x)}: agent`).join(" | ")} |`,
      `| --- | --- | --- | ${shown.map(() => "---").join(" | ")} |`,
      ...any.rows.map((row) => `| ${row.id} | ${row.family} | ${row.wardlineVerdict} | ${shown.map((x) => x.rows.find((y) => y.id === row.id)?.agentDecision ?? "n/a").join(" | ")} |`),
      "",
    );
  }

  lines.push("## Findings", "", ...(report.findings.length ? report.findings.map((f) => `- ${f}`) : ["- None."]), "");
  return lines.join("\n");
}

const AGENT_NOTE = "5 from each of families 1 to 6";
const AGENT_CAVEAT =
  "With the account on file, the agent compares the text against its own record and holds any other account as a destination change, so it lets nothing through but also holds legit invoices. On first contact it has no independent record to compare against, which is where an outside check matters.";
