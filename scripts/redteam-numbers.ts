/**
 * The red-team numbers, read from evidence/redteam/report.json (committed, offline).
 * Recompute them with: pnpm --filter @wardline/redteam bench
 */
import { readFileSync } from "node:fs";

const r = JSON.parse(readFileSync(new URL("../evidence/redteam/report.json", import.meta.url), "utf8")) as {
  engine: { name: string };
  cases: { attacks: number; adversarial: number; legit: number };
  headline: { attackCatchRate: number; unsafePays: number; legitFalsePositiveRate: number; latencyP50Ms: number };
  agentComparisons?: { variant: string; attacks: number; model: string; agentAlone: { unsafePayees: number }; agentWithWardline: { unsafePayees: number } }[];
};
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
console.log(`Engine: ${r.engine.name}`);
console.log(`Attacks stopped: ${pct(r.headline.attackCatchRate)} of ${r.cases.attacks} written and ${r.cases.adversarial} model-invented scam payees`);
console.log(`Unsafe payments: ${r.headline.unsafePays}`);
console.log(`False positives: ${pct(r.headline.legitFalsePositiveRate)} of ${r.cases.legit} legitimate invoices`);
console.log(`Check latency p50: ${r.headline.latencyP50Ms} ms`);
for (const c of r.agentComparisons ?? []) {
  console.log(`AI agent (${c.model}, ${c.variant === "first_contact" ? "first payment to a vendor" : "vendor account on file"}): alone ${c.agentAlone.unsafePayees} of ${c.attacks} scams paid, with Wardline ${c.agentWithWardline.unsafePayees}`);
}
