/**
 * Read-only check of the T4.5 deployment: view calls only, no keys, no transactions.
 *
 *   pnpm testnet:check        (from the repository root)
 */
import repo from "../../../repo.config.json" with { type: "json" };
import { NearCoverPoolClient, NearMeterClient, NearModelRegistryClient, makeProvider } from "@wardline/vault-client";

const rpc = process.env.WARDLINE_NEAR_RPC_URL ?? process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const c = repo.near.contracts;
const provider = makeProvider(rpc);
const usdc = (atomic: string) => (Number(BigInt(atomic)) / 1e6).toFixed(6);

const pool = new NearCoverPoolClient({ contractId: c.coverPool, provider });
const meter = new NearMeterClient({ contractId: c.meter, provider });
const registry = new NearModelRegistryClient({ contractId: c.modelRegistry, provider });

const p = await pool.getPool();
console.log(`${c.coverPool}: TVL ${usdc(p.tvl)} USDC, junior ${usdc(p.junior)}, senior ${usdc(p.senior)}, ${usdc(p.ward_supply)} WARD at ${usdc(p.ward_price)}, fees ${usdc(p.fees_earned)}, claims paid ${usdc(p.claims_paid)}`);
const budgets = await meter.listBudgets();
console.log(`${c.meter}: ${budgets.length} budgets`);
for (const b of budgets.slice(0, 6)) console.log(`  ${b.budget_id} owner ${b.owner} deposit ${usdc(b.deposit)} spent ${usdc(b.spent)} members ${b.members.length}`);
const models = await registry.listModels();
console.log(`${c.modelRegistry}: ${models.length} attested models`);
for (const m of models) console.log(`  ${m.model_id} signer ${m.signing_address}`);
for (const who of ["investor1.wardline-labs.testnet", "investor2.wardline-labs.testnet"]) {
  const pos = await pool.getPosition(who);
  console.log(`  ${who}: ${usdc(pos.ward)} WARD free, ${usdc(pos.ward_locked)} locked`);
}
const reps = await meter.listReputations();
console.log(`${c.meter}: ${reps.length} reputations`);
for (const r of reps) console.log(`  ${r.budget_id} tier ${r.tier} fee ${r.fee_bps} bps clean ${r.clean_calls} proven ${r.proven_calls} cap ${usdc(r.coverage_cap)} USDC`);
const props = await pool.listProposals();
const gov = await pool.governanceParams();
console.log(`${c.coverPool}: ${props.length} proposals (quorum ${gov.quorum_bps} bps, window ${gov.voting_days} days)`);
for (const pr of props) console.log(`  #${pr.id} status ${pr.status} for ${usdc(pr.votes_for)} against ${usdc(pr.votes_against)}: ${pr.description}`);
