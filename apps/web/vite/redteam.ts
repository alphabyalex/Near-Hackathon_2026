import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const ID = "virtual:redteam-summary";
const RESOLVED = `\0${ID}`;

interface Tally {
  unsafePayees: number;
  legitPaid: number;
}

interface Report {
  engine: { name: string; note: string };
  cases: { written: number; attacks: number; legit: number; adversarial: number };
  headline: { attackCatchRate: number; legitFalsePositiveRate: number; unsafePays: number; adversarialCatchRate: number; latencyP50Ms: number; latencyP95Ms: number };
  agentComparisons: { variant: string; model: string; cases: number; attacks: number; legitRecurring: number; agentAlone: Tally; agentWithWardline: Tally }[];
}

/** Only the numbers the site shows, so the full report never ships in the bundle. */
export function summarize(report: Report) {
  return {
    engine: report.engine,
    cases: report.cases,
    headline: report.headline,
    comparisons: report.agentComparisons.map((c) => ({
      variant: c.variant,
      model: c.model,
      cases: c.cases,
      attacks: c.attacks,
      legitRecurring: c.legitRecurring,
      agentAlone: { unsafePayees: c.agentAlone.unsafePayees, legitPaid: c.agentAlone.legitPaid },
      agentWithWardline: { unsafePayees: c.agentWithWardline.unsafePayees, legitPaid: c.agentWithWardline.legitPaid },
    })),
  };
}

/** Reads evidence/redteam/report.json at build time and exposes it as `virtual:redteam-summary`. */
export function redteamSummary(reportPath: string): Plugin {
  return {
    name: "wardline-redteam-summary",
    resolveId(source) {
      return source === ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(reportPath);
      const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
      return `export default ${JSON.stringify(summarize(report))};`;
    },
  };
}
