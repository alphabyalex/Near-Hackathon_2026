/**
 * WARD-holder voting in the simulated Mutual. Two LPs hold WARD at launch. One proposes a lower
 * Silver fee; a late depositor gets no vote on it (the snapshot was taken when it opened); a majority
 * of the snapshot passes it; anyone executes it, once; the fee changes for every Silver group.
 *
 *   pnpm demo:vote          offline, simulated pool and governance
 */
import { createChain, defaultSimSeed, type SimPool } from "../services/api/src/chain/index.js";

const now = () => new Date();
const chain = createChain("sim", now, defaultSimSeed());
const pool = chain.pool as SimPool;
const gov = chain.governance;
const ward = (a: string | bigint) => (Number(BigInt(a)) / 1e6).toFixed(2);

const holders = [...pool.holders()].map(([who, w]) => `${who} ${ward(w)} WARD`).join(", ");
console.log(`WARD holders: ${holders}`);
const p = await gov.propose({ proposer: "lp-harbor.testnet", description: "Lower the Silver fee to 1.25%", action: { type: "set_fee_bps", tier: "silver", fee_bps: 125 } });
console.log(`Proposal ${p.id}: "${p.description}". Snapshot ${ward(p.snapshot_supply)} WARD, quorum ${ward(p.quorum)} WARD, closes ${p.closes_at.slice(0, 16)}Z`);
await pool.deposit("late.testnet", "40000000");
await gov.vote({ id: p.id, voter: "late.testnet", support: "for" }).catch((e: Error) => console.log(`late.testnet votes: refused. ${e.message}`));
let v = await gov.vote({ id: p.id, voter: "lp-harbor.testnet", support: "for" });
console.log(`lp-harbor.testnet votes for with ${ward(v.votes_for)} WARD: ${v.status}`);
v = await gov.vote({ id: p.id, voter: "lp-north.testnet", support: "for" });
console.log(`lp-north.testnet votes for: ${ward(v.votes_for)} of ${ward(v.snapshot_supply)} WARD for, ${v.status}`);
const done = await gov.execute(p.id);
console.log(`Executed by anyone: ${done.status} (${done.tx})`);
await gov.execute(p.id).catch((e: Error) => console.log(`Execute again: refused. ${e.message}`));
const silver = (await chain.reputation.tierRules()).rules.find((r) => r.tier === "silver")!;
console.log(`Silver fee is now ${(silver.fee_bps / 100).toFixed(2)}%`);
