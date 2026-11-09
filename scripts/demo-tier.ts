/**
 * Reputation tiers in sim. A clean group starts at Bronze (2% fee, 25 USDC coverage). Ten proven
 * calls in a row move it to Silver (1.5%, 50 USDC), so its eleventh call pays a lower fee.
 *
 *   pnpm demo:tier          offline, in-process gateway and the local test TEE
 */
import { bootstrap } from "../services/api/src/bootstrap.js";
import { runScene } from "../services/api/src/demo-scenes.js";
import { systemClock, toDateClock } from "../services/api/src/time.js";

type Rep = { name: string; tier: string; proven_calls: number; claims: number; fee_bps: number; coverage_cap: string };
const deps = bootstrap(":memory:", systemClock, {}, undefined, { env: { WARDLINE_CHAIN_MODE: "sim" } });
const s = (await runScene("tier", { now: toDateClock(systemClock), engine: deps.payee.engine, context: deps.payee.context })) as { before: Rep; after: Rep; first: { fee: string }; last: { fee: string }; calls: number };
const line = (r: Rep) => `${r.tier}, ${r.proven_calls} proven calls, ${r.claims} claims, fee ${(r.fee_bps / 100).toFixed(2)}%, coverage ${(Number(r.coverage_cap) / 1e6).toFixed(2)} USDC`;
console.log(`${s.before.name}: ${line(s.before)}`);
console.log(`After ${s.calls} proven calls: ${line(s.after)}`);
console.log(`Fee on call 1: ${(Number(s.first.fee) / 1e6).toFixed(4)} USDC. Fee on call ${s.calls}: ${(Number(s.last.fee) / 1e6).toFixed(4)} USDC`);
