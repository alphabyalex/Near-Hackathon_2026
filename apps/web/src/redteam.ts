import summary from "virtual:redteam-summary";

/** The red-team report, read from evidence/redteam/report.json when the site is built. */
export const REDTEAM = summary;

export const percent = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;

/** The engine the verdicts came from, in words. */
export const engineLabel = (name: string): string => (name === "stub" ? "stub rules engine (@redline/sdk)" : name === "live" ? "payee-check engine (@redline/payee-check)" : name);

export const firstContact = () => summary.comparisons.find((c) => c.variant === "first_contact") ?? null;
export const onFile = () => summary.comparisons.find((c) => c.variant === "on_file") ?? null;
