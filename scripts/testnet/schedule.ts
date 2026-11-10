import { runBatch } from "./simulate.js";

const FREEZE_TIMESTAMP = Date.parse("2026-11-14T00:00:00Z");

function batchSizeForHour(hourUtc: number): number {
  // Peak activity during daylight hours (14:00 to 22:00 UTC)
  if (hourUtc >= 14 && hourUtc <= 22) {
    return 12 + Math.floor(Math.random() * 6); // 12-17 calls
  }
  // Moderate activity during morning hours (08:00 to 13:00 UTC)
  if (hourUtc >= 8 && hourUtc <= 13) {
    return 8 + Math.floor(Math.random() * 4); // 8-11 calls
  }
  // Light activity overnight (00:00 to 07:00 UTC)
  return 3 + Math.floor(Math.random() * 3); // 3-5 calls
}

export async function runScheduledBatch(): Promise<void> {
  const now = Date.now();
  if (now >= FREEZE_TIMESTAMP) {
    console.log(`[Schedule] Freeze deadline passed (${new Date(FREEZE_TIMESTAMP).toISOString()}). No further batches executed.`);
    return;
  }

  const hourUtc = new Date(now).getUTCHours();
  const count = batchSizeForHour(hourUtc);
  console.log(`[Schedule] Triggering batch at ${new Date(now).toISOString()} (UTC hour ${hourUtc}: ${count} calls)...`);

  await runBatch({ callsCount: count });
}

if (process.argv[1]?.endsWith("schedule.ts")) {
  runScheduledBatch().catch((err) => {
    console.error("Scheduled batch run failed:", err);
    process.exit(1);
  });
}
