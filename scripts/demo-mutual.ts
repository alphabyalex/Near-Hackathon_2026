/**
 * Wardline Mutual with WARD. An investor deposits USDC and receives WARD. Then two wrong approvals:
 * the first payout is all Wardline's own stake and WARD's price does not move; the bigger second one
 * uses up the stake, WARD holders cover the rest, and fees from proven calls refill it.
 *
 *   pnpm demo:mutual        offline, simulated pool
 */
import { bootstrap } from "../services/api/src/bootstrap.js";
import { runScene } from "../services/api/src/demo-scenes.js";
import { systemClock, toDateClock } from "../services/api/src/time.js";

const deps = bootstrap(":memory:", systemClock, {}, undefined, { env: { WARDLINE_CHAIN_MODE: "sim" } });
const ctx = { now: toDateClock(systemClock), engine: deps.payee.engine, context: deps.payee.context };
const usdc = (a: string) => (Number(BigInt(a)) / 1e6).toFixed(2);
const price = (a: string) => (Number(BigInt(a)) / 1e6).toFixed(4);

const join = (await runScene("mutual", ctx)) as {
  stats: { total_pooled: string; groups_covered: number; proven_payments: number; yield_earned: string };
  deposit: { account: string; usdc: string; ward: string; price: string };
};
console.log(`Mutual: ${usdc(join.stats.total_pooled)} USDC pooled, ${join.stats.groups_covered} groups covered, ${join.stats.proven_payments} proven AI payments, ${usdc(join.stats.yield_earned)} USDC earned by WARD holders`);
console.log(`Deposit: ${join.deposit.account} puts in ${usdc(join.deposit.usdc)} USDC and receives ${usdc(join.deposit.ward)} WARD at ${price(join.deposit.price)}`);

const s = (await runScene("payout", ctx)) as {
  before: { junior: string; senior: string; ward_price: string };
  payouts: { claim: { amount: string; paid_from_junior: string; paid_from_senior: string; ward_price_before: string; ward_price_after: string; status: string }; pool: { junior: string } }[];
  refill: { calls: number; spent: string; fees: string; ward_before: string; ward_after: string };
};
console.log(`Pool: Wardline's first-loss stake ${usdc(s.before.junior)} USDC, behind WARD ${usdc(s.before.senior)} USDC, WARD price ${price(s.before.ward_price)}`);
s.payouts.forEach(({ claim, pool }, i) => {
  console.log(`Payout ${i + 1}: ${usdc(claim.amount)} USDC ${claim.status}. From Wardline's stake ${usdc(claim.paid_from_junior)}, from WARD holders ${usdc(claim.paid_from_senior)}. Stake left ${usdc(pool.junior)}. WARD ${price(claim.ward_price_before)} to ${price(claim.ward_price_after)}`);
});
console.log(`Refill: ${s.refill.calls} proven calls (${usdc(s.refill.spent)} USDC) paid ${(Number(BigInt(s.refill.fees)) / 1e6).toFixed(4)} USDC in fees. WARD ${price(s.refill.ward_before)} to ${price(s.refill.ward_after)}`);
