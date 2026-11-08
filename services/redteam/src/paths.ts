import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

export const PATHS = {
  env: join(REPO_ROOT, ".env"),
  fixtures: join(REPO_ROOT, "fixtures", "redteam"),
  cases: join(REPO_ROOT, "fixtures", "redteam", "cases.json"),
  prose: join(REPO_ROOT, "fixtures", "redteam", "prose"),
  ledger: join(REPO_ROOT, "fixtures", "redteam", "ledger.json"),
  evidence: join(REPO_ROOT, "evidence", "redteam"),
  report: join(REPO_ROOT, "evidence", "redteam", "report.json"),
  reportLive: join(REPO_ROOT, "evidence", "redteam", "report-live.json"),
  agent: join(REPO_ROOT, "fixtures", "redteam", "agent"),
  doc: join(REPO_ROOT, "docs", "REDTEAM.md"),
};
