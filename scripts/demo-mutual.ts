/**
 * Wardline Mutual with WARD: two wrong approvals. The first payout is all Wardline's own stake and
 * WARD's price does not move. The bigger second one uses up the stake; WARD holders cover the rest.
 *
 *   pnpm demo:mutual        offline, simulated pool
 */
import { bootstrap } from "../services/api/src/bootstrap.js";
import { runScene } from "../services/api/src/demo-scenes.js";
import { systemClock, toDateClock } from "../services/api/src/time.js";

const deps = bootstrap(":memory:", systemClock, {}, undefined, { env: { WARDLINE_CHAIN_MODE: "sim" } });
const s = (await runScene("mutual", { now: toDateClock(systemClock), engine: deps.payee.engine, context: deps.payee.context })) as {
  before: { junior: string; senior: string; ward_price: string };
  payouts: { claim: { amount: string; paid_from_junior: string; paid_from_senior: string; ward_price_before: string; ward_price_after: string; status: string }; pool: { junior: string } }[];
};
const usdc = (a: string) => (Number(BigInt(a)) / 1e6).toFixed(2);
const price = (a: string) => (Number(BigInt(a)) / 1e6).toFixed(4);
console.log(`Pool: Wardline's first-loss stake ${usdc(s.before.junior)} USDC, behind WARD ${usdc(s.before.senior)} USDC, WARD price ${price(s.before.ward_price)}`);
s.payouts.forEach(({ claim, pool }, i) => {
  console.log(`Payout ${i + 1}: ${usdc(claim.amount)} USDC ${claim.status}. From Wardline's stake ${usdc(claim.paid_from_junior)}, from WARD holders ${usdc(claim.paid_from_senior)}. Stake left ${usdc(pool.junior)}. WARD ${price(claim.ward_price_before)} to ${price(claim.ward_price_after)}`);
});
