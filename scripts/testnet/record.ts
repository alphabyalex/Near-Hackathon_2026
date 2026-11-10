/**
 * Records one transaction from a manual check into the activity log, through the same writer as the
 * batch: the row is built from NEAR RPC and throws for a hash RPC does not know. Served after the
 * next pnpm testnet:audit.
 *
 *   pnpm tsx scripts/testnet/record.ts <tx hash> <signer> '<fields as JSON>'
 */
import { ActivityWriter } from "./chain-log.js";
import type { RowFields } from "../../services/api/src/activity/log.js";

const [hash, signer, json] = process.argv.slice(2);
if (!hash || !signer || !json) throw new Error("Usage: record.ts <tx hash> <signer> '<fields JSON>'");
const row = await new ActivityWriter({ dryRun: process.argv.includes("--dry-run") }).record(hash, signer, JSON.parse(json) as RowFields);
console.log(`recorded ${row.kind}:${row.outcome} at block ${row.block_height}  https://testnet.nearblocks.io/txns/${row.tx}`);
