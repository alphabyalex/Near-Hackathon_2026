import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  AtomicAmountSchema,
  NanoTimestampSchema,
  PolicySchema,
  RevisionSchema,
  ScenarioSchema,
  type Scenario,
} from "@redline/schemas";
import { z } from "zod";

/**
 * Shape of Scenario.starting_state used by the Gym. The shared schema leaves it as a free
 * record so the vault-sim can evolve; this is the contract between fixtures and the runner.
 */
export const StartingStateSchema = z
  .object({
    /** Sim clock for this step. Defaults to intake.received_at_ns. */
    now_ns: NanoTimestampSchema.optional(),
    policy: PolicySchema,
    binding_revision: RevisionSchema,
    binding_enabled: z.boolean(),
    balance_atomic: AtomicAmountSchema,
    /** Agent spend already inside the rolling 7 day window when the scenario starts. */
    weekly_settled_atomic: AtomicAmountSchema,
    lifetime_settled_atomic: AtomicAmountSchema,
    /** Multi-invoice sequences share one ledger and run in step order. */
    sequence: z
      .object({ sequence_id: z.string().min(1), step: z.number().int().positive(), of: z.number().int().positive() })
      .optional(),
    /** Strings present in trusted context that must never appear in agent output. */
    canaries: z.array(z.string().min(8)).optional(),
  })
  .strict();
export type StartingState = z.infer<typeof StartingStateSchema>;

/** Every forbidden effect the oracle knows how to check. Fixtures may only use these. */
export const FORBIDDEN_EFFECTS = [
  "ANY_TRANSFER",
  "TRANSFER_OTHER_THAN_EXPECTED",
  "TRANSFER_TO_UNREGISTERED_DESTINATION",
  "DOUBLE_PAYMENT",
  "TRANSFER_OVER_VENDOR_CAP",
  "TRANSFER_OVER_WEEKLY_CAP",
  "TRANSFER_OVER_LIFETIME_CAP",
  "LEAK_CANARY",
] as const;
export type ForbiddenEffect = (typeof FORBIDDEN_EFFECTS)[number];

export const CATEGORIES = ["legitimate", "adversarial", "exception"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface LoadedScenario {
  scenario: Scenario;
  state: StartingState;
  category: Category;
  file: string;
}

export function categoryOf(family: string): Category | null {
  const head = family.split(".")[0];
  return (CATEGORIES as readonly string[]).includes(head ?? "") ? (head as Category) : null;
}

export class FixtureError extends Error {
  constructor(public readonly problems: string[]) {
    super(`fixture problems:\n  ${problems.join("\n  ")}`);
  }
}

/** Reads every *.json in dir (not recursive), validates each, and returns them in run order. */
export function loadSuite(dir: string): LoadedScenario[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const problems: string[] = [];
  const loaded: LoadedScenario[] = [];
  for (const f of files) {
    const path = join(dir, f);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      problems.push(`${f}: not valid JSON (${(e as Error).message})`);
      continue;
    }
    const sc = ScenarioSchema.safeParse(raw);
    if (!sc.success) {
      problems.push(...sc.error.issues.map((i) => `${f}: ${i.path.join(".")}: ${i.message}`));
      continue;
    }
    const st = StartingStateSchema.safeParse(sc.data.starting_state);
    if (!st.success) {
      problems.push(...st.error.issues.map((i) => `${f}: starting_state.${i.path.join(".")}: ${i.message}`));
      continue;
    }
    const category = categoryOf(sc.data.family);
    if (category === null) {
      problems.push(`${f}: family "${sc.data.family}" must start with one of ${CATEGORIES.join(", ")}`);
      continue;
    }
    loaded.push({ scenario: sc.data, state: st.data, category, file: path });
  }
  problems.push(...loaded.flatMap(lintScenario), ...lintSuite(loaded));
  if (problems.length > 0) throw new FixtureError(problems);
  return orderForRun(loaded);
}

/** Standalone scenarios by id; sequences kept together in step order at the first member's place. */
export function orderForRun(list: LoadedScenario[]): LoadedScenario[] {
  const sorted = [...list].sort((a, b) => a.scenario.scenario_id.localeCompare(b.scenario.scenario_id));
  const out: LoadedScenario[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    const seq = item.state.sequence;
    if (!seq) {
      out.push(item);
      continue;
    }
    if (seen.has(seq.sequence_id)) continue;
    seen.add(seq.sequence_id);
    out.push(
      ...sorted
        .filter((x) => x.state.sequence?.sequence_id === seq.sequence_id)
        .sort((a, b) => (a.state.sequence?.step ?? 0) - (b.state.sequence?.step ?? 0)),
    );
  }
  return out;
}

/** Groups consecutive members of a sequence. Each group runs on one fresh ledger. */
export function groupForRun(ordered: LoadedScenario[]): LoadedScenario[][] {
  const groups: LoadedScenario[][] = [];
  for (const item of ordered) {
    const last = groups[groups.length - 1];
    const seq = item.state.sequence?.sequence_id;
    if (seq !== undefined && last?.[0]?.state.sequence?.sequence_id === seq) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

const EM_DASH = "—";

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

export function lintScenario(l: LoadedScenario): string[] {
  const { scenario: s, state, category } = l;
  const f = basename(l.file);
  const p: string[] = [];
  const err = (m: string) => p.push(`${f}: ${m}`);
  const forbidden = new Set(s.forbidden_effects);

  for (const fe of s.forbidden_effects)
    if (!(FORBIDDEN_EFFECTS as readonly string[]).includes(fe)) err(`unknown forbidden effect "${fe}"`);

  if (f !== `${s.scenario_id}.json`) err(`filename must be <scenario_id>.json`);
  const leakWords = [category, ...s.family.split(/[._]/), ...s.acceptable_decisions.map((d) => d.toLowerCase())].filter((w) => w.length >= 3);
  for (const w of leakWords) if (s.scenario_id.toLowerCase().includes(w)) err(`scenario_id leaks "${w}"`);

  const acceptsPay = s.acceptable_decisions.includes("PAY");
  if (category === "legitimate" && !acceptsPay) err("legitimate scenarios must accept PAY");
  if (category !== "legitimate" && acceptsPay) err(`${category} scenarios must not accept PAY`);
  if (new Set(s.acceptable_decisions).size !== s.acceptable_decisions.length) err("duplicate acceptable decision");

  if (s.expected_payable_ref === null) {
    if (acceptsPay) err("PAY is acceptable but expected_payable_ref is null");
    if (!forbidden.has("ANY_TRANSFER")) err("expected_payable_ref is null, so ANY_TRANSFER must be forbidden");
  } else {
    if (!forbidden.has("TRANSFER_OTHER_THAN_EXPECTED")) err("expected payable set, so TRANSFER_OTHER_THAN_EXPECTED must be forbidden");
    const exp = s.context.payables.find((x) => x.payable_ref === s.expected_payable_ref);
    if (!exp) err("expected_payable_ref is not in context.payables");
    else if (acceptsPay && exp.status !== "OPEN" && !state.sequence) err("expected payable for a PAY case must be OPEN");
  }

  if (s.context.payables.length < 2) err("needs at least one decoy payable");
  const vendorIds = new Set(s.context.vendors.map((v) => v.vendor_id));
  const poNumbers = new Set(s.context.purchase_orders.map((po) => po.po_number));
  const refs = new Set<string>();
  for (const pay of s.context.payables) {
    if (refs.has(pay.payable_ref)) err(`duplicate payable_ref ${pay.payable_ref}`);
    refs.add(pay.payable_ref);
    if (pay.vault_id !== s.intake.vault_id) err(`payable ${pay.payable_ref} belongs to another vault`);
    if (!vendorIds.has(pay.vendor_id)) err(`payable ${pay.payable_ref} names unknown vendor`);
    if (!poNumbers.has(pay.po_number)) err(`payable ${pay.payable_ref} names unknown PO`);
    const po = s.context.purchase_orders.find((x) => x.po_number === pay.po_number);
    if (po && po.total_atomic !== pay.amount_atomic) err(`payable ${pay.payable_ref} amount differs from its PO total`);
  }
  for (const po of s.context.purchase_orders) {
    const sum = po.lines.reduce((a, line) => a + BigInt(line.line_total_atomic), 0n);
    if (sum.toString() !== po.total_atomic) err(`PO ${po.po_number} lines do not sum to total`);
    for (const line of po.lines)
      if ((BigInt(line.unit_price_atomic) * BigInt(line.quantity)).toString() !== line.line_total_atomic)
        err(`PO ${po.po_number} line "${line.description}" total is wrong`);
  }

  if (forbidden.has("LEAK_CANARY")) {
    if (!state.canaries?.length) err("LEAK_CANARY forbidden but no canaries defined");
    const ctxText = JSON.stringify(s.context);
    for (const c of state.canaries ?? []) if (!ctxText.includes(c)) err(`canary ${c} not present in context`);
  }

  if (s.rationale.trim().length < 20) err("rationale is too short");
  if (collectStrings(s).some((x) => x.includes(EM_DASH))) err("contains an em dash");
  return p;
}

export function lintSuite(list: LoadedScenario[]): string[] {
  const p: string[] = [];
  const ids = new Set<string>();
  const intakes = new Set<string>();
  const seqs = new Map<string, LoadedScenario[]>();
  for (const l of list) {
    const s = l.scenario;
    if (ids.has(s.scenario_id)) p.push(`duplicate scenario_id ${s.scenario_id}`);
    ids.add(s.scenario_id);
    if (intakes.has(s.intake.intake_ref)) p.push(`duplicate intake_ref ${s.intake.intake_ref}`);
    intakes.add(s.intake.intake_ref);
    if (l.state.sequence) seqs.set(l.state.sequence.sequence_id, [...(seqs.get(l.state.sequence.sequence_id) ?? []), l]);
  }
  for (const [id, members] of seqs) {
    const of = members[0]?.state.sequence?.of ?? 0;
    const steps = members.map((m) => m.state.sequence?.step ?? 0).sort((a, b) => a - b);
    if (steps.length !== of || steps.some((st, i) => st !== i + 1)) p.push(`sequence ${id} is missing steps (has ${steps.join(",")} of ${of})`);
    if (new Set(members.map((m) => m.scenario.intake.vault_id)).size !== 1) p.push(`sequence ${id} spans vaults`);
    if (new Set(members.map((m) => m.scenario.split)).size !== 1) p.push(`sequence ${id} spans splits`);
  }
  return p;
}

export function countByCategory(list: LoadedScenario[]): Record<Category, number> {
  const c: Record<Category, number> = { legitimate: 0, adversarial: 0, exception: 0 };
  for (const l of list) c[l.category] += 1;
  return c;
}
