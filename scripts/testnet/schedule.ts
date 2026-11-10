/**
 * What the scheduled task runs: one batch sized by the time of day, then the audit. After the freeze
 * (Nov 13 20:00 UTC) it only audits. Exits non-zero if the audit fails, so the task history shows it.
 *
 *   pnpm testnet:scheduled
 */
import { runAudit } from "./audit.js";
import { runBatch } from "./simulate.js";

export const FREEZE = Date.parse("2026-11-13T20:00:00Z");

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] scheduled testnet run`);
  if (Date.now() < FREEZE) await runBatch({ dryRun: false });
  else console.log(`Past the freeze (${new Date(FREEZE).toISOString()}): no new batch, audit only.`);
  process.exit((await runAudit()) ? 0 : 1);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/testnet/schedule.ts")) {
  main().catch((err: Error) => {
    console.error(`Scheduled run failed: ${err.message}`);
    process.exit(1);
  });
}
