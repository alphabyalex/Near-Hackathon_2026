/**
 * cheapai claims to serve DeepSeek V4.1 Flash but answers with GLM-5.3 Flash and passes that model's
 * real NEAR AI signature through. The gateway must refuse to pay and refund the reservation.
 *
 *   pnpm demo:swapped-model      offline, from recorded NEAR AI traffic. Never calls NEAR AI.
 */
import { createApp } from "../services/api/src/app.js";
import { bootstrap } from "../services/api/src/bootstrap.js";
import { runScene } from "../services/api/src/demo-scenes.js";
import { systemClock, toDateClock } from "../services/api/src/time.js";

const deps = bootstrap(":memory:", systemClock, {}, undefined, { env: { WARDLINE_CHAIN_MODE: "sim" } });
void createApp(deps);
const s = (await runScene("swap", { now: toDateClock(systemClock), engine: deps.payee.engine, context: deps.payee.context })) as {
  claimed: string; status: number; proof: string; error: { code: string; message: string }; call: { model_proven: string; reserved: string; refund: string; amount: string; release_tx: string };
};
const usdc = (a: string) => (Number(BigInt(a)) / 1e6).toFixed(6);
console.log(`Asked for:      ${s.claimed}`);
console.log(`Signature names: ${s.call.model_proven}`);
console.log(`Gateway:        HTTP ${s.status}, X-Wardline-Proof: ${s.proof}, ${s.error.code}`);
console.log(`Reserved ${usdc(s.call.reserved)} USDC, paid ${usdc(s.call.amount)}, refunded ${usdc(s.call.refund)} (${s.call.release_tx})`);
if (s.proof !== "refused" || s.call.amount !== "0") process.exitCode = 1;
