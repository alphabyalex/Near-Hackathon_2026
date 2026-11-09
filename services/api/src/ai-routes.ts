/**
 * Routes for the group page, the AI dashboard, meter keys, Wardline Mutual and the demo scenes.
 * Public: /v1/mutual (home page summary), /v1/groups, /v1/reputation, /v1/mutual/proposals (read,
 * execute), /v1/pool (read, plus wallet-signed deposit, redeem, vote and propose), /v1/demo/:scene.
 * Owner (session): /owner/group, /owner/ai/overview, /owner/meter-keys.
 */

import { randomBytes } from "node:crypto";
import type { ProposalView } from "@wardline/dao-adapter";
import { normalizeDomain } from "@wardline/sdk";
import type { Hono } from "hono";
import { z } from "zod";
import { GROUP_BUDGET, mutualStats } from "./chain/index.js";
import { runScene, SCENES, type SceneName } from "./demo-scenes.js";
import { publicCall } from "./meter/gateway.js";
import type { CallRow } from "./meter/store.js";
import { verifyNep413 } from "./payee/proofs.js";
import type { Deps } from "./service.js";
import { toDateClock } from "./time.js";

export const MUTUAL_RECIPIENT = "wardline-mutual";
const POOL_TTL_MS = 5 * 60_000;

const DOMAIN_IN_TEXT = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:example|com|org|net|io|xyz|ai|app|dev|co))\b/i;

/** Pending treasury transfers, each run through the payee check before anyone votes on it. */
export async function payoutsAwaitingVote(deps: Deps, proposals: ProposalView[]) {
  const pending = proposals.filter((p) => p.status === "InProgress" && p.transfer && p.transfer.receiver_id !== deps.ai.contracts.meter);
  return Promise.all(
    pending.map(async (p) => {
      const t = p.transfer!;
      const domainMatch = DOMAIN_IN_TEXT.exec(p.description);
      const domain = domainMatch ? normalizeDomain(domainMatch[1]!) : null;
      const payee = `near:testnet:${t.receiver_id}`;
      const check = await deps.payee.engine.check({ payee, ...(domain ? { vendor: { domain } } : {}) }, deps.payee.context);
      return {
        proposal: p.id,
        description: p.description,
        proposer: p.proposer,
        receiver: t.receiver_id,
        token: t.token_id,
        amount: t.amount,
        domain,
        payee,
        verdict: check.verdict,
        evidenceTier: check.evidenceTier ?? "T0_NONE",
        reasons: check.reasons,
        flagged: check.verdict !== "PAY",
      };
    }),
  );
}

/** Spend per day for the last `days` days, verified calls only, plus refunds. */
export function spendSeries(calls: CallRow[], now: Date, days = 14) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86_400_000;
  const buckets = Array.from({ length: days }, (_, i) => ({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), spent: 0n, refunded: 0n, verified: 0, refused: 0 }));
  for (const c of calls) {
    const i = Math.floor((Date.parse(c.createdAt) - start) / 86_400_000);
    const b = buckets[i];
    if (!b) continue;
    b.spent += BigInt(c.amount);
    b.refunded += c.status === "verified" ? 0n : BigInt(c.refund);
    if (c.status === "verified") b.verified++;
    else b.refused++;
  }
  return buckets.map((b) => ({ ...b, spent: b.spent.toString(), refunded: b.refunded.toString() }));
}

export function aiOverview(calls: CallRow[], now: Date) {
  const verified = calls.filter((c) => c.status === "verified");
  const refusedProof = calls.filter((c) => c.status !== "verified" && c.reserved !== "0");
  return {
    verifiedCalls: verified.length,
    refusedCalls: calls.filter((c) => c.status === "refused").length,
    failedCalls: calls.filter((c) => c.status === "failed").length,
    spent: verified.reduce((n, c) => n + BigInt(c.amount), 0n).toString(),
    refunded: refusedProof.reduce((n, c) => n + BigInt(c.refund), 0n).toString(),
    series: spendSeries(calls, now),
  };
}

const TierName = z.enum(["bronze", "silver", "gold"]);
export const MutualActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_fee_bps"), tier: TierName, fee_bps: z.number().int().min(0).max(1_000) }),
  z.object({ type: z.literal("set_coverage_multiplier"), multiplier_bps: z.number().int().min(2_500).max(40_000) }),
  z.object({ type: z.literal("cover_model"), model_id: z.string().min(3).max(120), signing_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }),
  z.object({ type: z.literal("uncover_model"), model_id: z.string().min(3).max(120) }),
  z.object({ type: z.literal("approve_payout"), claim_id: z.string().regex(/^clm_[a-z0-9]{6,20}$/) }),
]);
const Account = z.string().min(2).max(64);
const PoolChallenge = z.union([
  z.object({ account: Account, action: z.enum(["deposit", "withdraw"]), amount: z.string().regex(/^[1-9][0-9]{0,30}$/) }),
  z.object({ account: Account, action: z.literal("redeem"), id: z.string().regex(/^[a-z0-9_]{3,40}$/) }),
  z.object({ account: Account, action: z.literal("vote"), id: z.number().int().min(0), support: z.enum(["for", "against"]) }),
  z.object({ account: Account, action: z.literal("propose"), description: z.string().trim().min(4).max(200), proposal: MutualActionSchema }),
]);
type PoolRequest = z.infer<typeof PoolChallenge>;
const PoolSigned = z.object({ nonce: z.string(), publicKey: z.string(), signature: z.string() });
const MeterKeyBody = z.object({ budget_id: z.string().min(1).default(GROUP_BUDGET), member: z.string().min(2).max(64), label: z.string().max(60).optional(), models: z.array(z.string()).min(1).optional() });

export function registerAiPublicRoutes(app: Hono<never>, deps: Deps): void {
  const nowMs = () => Number(deps.now() / 1_000_000n);
  const pool = deps.ai.chain.pool;

  // Which TEE signer is attested for which model. In near mode this mirrors the model registry contract.
  app.get("/v1/ai-registry", async (c) => c.json({ mode: deps.ai.chain.mode, contract: deps.ai.contracts.registry, models: await deps.ai.chain.registry.listModels() }));

  app.get("/v1/pool", async (c) => c.json({ mode: deps.ai.chain.mode, contract: deps.ai.contracts.pool, pool: await pool.getPool(), claims: await pool.listClaims() }));

  app.get("/v1/pool/positions/:account", async (c) => c.json(await pool.getPosition(c.req.param("account"))));

  const chain = deps.ai.chain;
  const groups = async () => {
    const reps = await chain.reputation.listReputations();
    return Promise.all(
      reps.map(async (r) => {
        const b = await chain.meter.getBudget(r.budget_id).catch(() => null);
        return { ...r, deposit: b?.deposit ?? "0", members: b?.members.length ?? 0, period: b?.period ?? null };
      }),
    );
  };

  // Everything the Mutual home page shows, in one call.
  app.get("/v1/mutual", async (c) => {
    const [poolView, claims, list, proposals, tiers, params] = await Promise.all([pool.getPool(), pool.listClaims(), groups(), chain.governance.listProposals(), chain.reputation.tierRules(), chain.governance.params()]);
    return c.json({
      mode: chain.mode,
      // Reputation and voting are simulated until Tharun's T4.6 contracts are deployed.
      mutual_mode: chain.governance.mode,
      contract: deps.ai.contracts.pool,
      pool: poolView,
      claims,
      stats: await mutualStats(chain),
      groups: list,
      tiers,
      governance: { ...params, proposals },
    });
  });

  app.get("/v1/groups", async (c) => c.json({ mode: chain.reputation.mode, groups: await groups(), tiers: await chain.reputation.tierRules() }));

  // get_reputation(budget_id)
  app.get("/v1/reputation/:budget", async (c) => {
    const r = await chain.reputation.getReputation(c.req.param("budget"));
    return r ? c.json(r) : c.json({ error: "NOT_FOUND", message: `No group with budget ${c.req.param("budget")}.` }, 404);
  });

  app.get("/v1/mutual/proposals", async (c) => c.json({ mode: chain.governance.mode, ...(await chain.governance.params()), proposals: await chain.governance.listProposals() }));

  app.get("/v1/mutual/proposals/:id/weight/:account", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || !(await chain.governance.getProposal(id))) return c.json({ error: "NOT_FOUND", message: "No such proposal." }, 404);
    return c.json({ id, account: c.req.param("account"), weight: await chain.governance.weightOf(id, c.req.param("account")) });
  });

  // Anyone can execute a passed proposal. It runs once.
  app.post("/v1/mutual/proposals/:id/execute", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || !(await chain.governance.getProposal(id))) return c.json({ error: "NOT_FOUND", message: "No such proposal." }, 404);
    try {
      return c.json({ proposal: await chain.governance.execute(id) });
    } catch (error) {
      return c.json({ error: "REFUSED", message: error instanceof Error ? error.message : "Execution refused." }, 409);
    }
  });

  // Deposit and withdraw are signed by the LP's own wallet (NEP-413). In near mode the wallet sends
  // ft_transfer_call to the pool contract directly instead.
  app.post("/v1/pool/challenge", async (c) => {
    const body = PoolChallenge.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    const expiresAt = new Date(nowMs() + POOL_TTL_MS).toISOString();
    const message = `wardline-mutual:v1:${JSON.stringify({ ...body.data, pool: deps.ai.contracts.pool, expiresAt })}`;
    const nonce = randomBytes(32).toString("base64");
    deps.store.saveChallenge({ nonce, account: body.data.account, message, expiresAt: nowMs() + POOL_TTL_MS }, nowMs());
    return c.json({ message, recipient: MUTUAL_RECIPIENT, nonce, expiresAt });
  });

  app.post("/v1/pool/submit", async (c) => {
    const body = PoolSigned.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: "Send nonce, publicKey and signature." }, 400);
    const challenge = deps.store.consumeChallenge(body.data.nonce, nowMs());
    if (!challenge || !challenge.message.startsWith("wardline-mutual:v1:")) return c.json({ error: "REFUSED", message: "Unknown, used or expired request. Start again." }, 401);
    const nonce = Uint8Array.from(Buffer.from(body.data.nonce, "base64"));
    const reason = await verifyNep413(
      { network: deps.auth.network, accountId: challenge.account, publicKey: body.data.publicKey, signature: body.data.signature, nonce, message: challenge.message, recipient: MUTUAL_RECIPIENT },
      deps.payee.lookupKeys,
    ).catch(() => "Your account's keys could not be read.");
    if (reason) return c.json({ error: "REFUSED", message: reason }, 401);
    const req = JSON.parse(challenge.message.slice("wardline-mutual:v1:".length)) as PoolRequest;
    try {
      if (req.action === "deposit") return c.json({ action: "deposit", ...(await pool.deposit(req.account, req.amount)), position: await pool.getPosition(req.account) });
      if (req.action === "redeem") return c.json({ action: "redeem", ...(await pool.redeem(req.account, req.id)), position: await pool.getPosition(req.account) });
      if (req.action === "vote") return c.json({ action: "vote", proposal: await chain.governance.vote({ id: req.id, voter: req.account, support: req.support }) });
      if (req.action === "propose") return c.json({ action: "propose", proposal: await chain.governance.propose({ proposer: req.account, description: req.description, action: req.proposal }) });
      return c.json({ action: "withdraw", ...(await pool.requestWithdraw(req.account, req.amount)), position: await pool.getPosition(req.account) });
    } catch (error) {
      return c.json({ error: "REFUSED", message: error instanceof Error ? error.message : "Pool refused the request." }, 409);
    }
  });

  app.post("/v1/demo/:scene", async (c) => {
    const name = c.req.param("scene") as SceneName;
    if (!SCENES.includes(name)) return c.json({ error: "NOT_FOUND", message: `Scenes: ${SCENES.join(", ")}` }, 404);
    return c.json(await runScene(name, { now: toDateClock(deps.now), engine: deps.payee.engine, context: deps.payee.context }));
  });
}

export function registerAiOwnerRoutes(app: Hono<never>, deps: Deps, requireOwner: () => never): void {
  const meter = deps.ai.meter;
  const nowDate = toDateClock(deps.now);
  type Ctx = { get(k: "session"): { account: string } };

  app.get("/group", async (c) => {
    const budgetId = c.req.query("budget") ?? GROUP_BUDGET;
    const budget = await deps.ai.chain.meter.getBudget(budgetId);
    if (!budget) return c.json({ error: "NOT_FOUND", message: `No budget ${budgetId}.` }, 404);
    const proposals = await deps.ai.dao.listProposals().catch(() => [] as ProposalView[]);
    const calls = meter.listCalls(budgetId, 100);
    const [reputation, tiers] = await Promise.all([deps.ai.chain.reputation.getReputation(budgetId), deps.ai.chain.reputation.tierRules()]);
    return c.json({
      mode: deps.ai.chain.mode,
      reputation,
      tiers,
      dao: deps.ai.dao.dao,
      budget,
      calls: calls.map(publicCall),
      proposals,
      payouts: await payoutsAwaitingVote(deps, proposals),
      models: await deps.ai.chain.registry.listModels(),
      routes: deps.ai.routes.models.map((m) => ({ id: m.id, label: m.label })),
    });
  });

  app.get("/ai/overview", (c) => c.json(aiOverview(meter.listCalls(c.req.query("budget") ?? undefined, 1000), nowDate())));

  app.get("/meter-keys", (c) => c.json({ keys: meter.listKeys() }));

  app.post("/meter-keys", requireOwner(), async (c) => {
    const body = MeterKeyBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    const budget = await deps.ai.chain.meter.getBudget(body.data.budget_id);
    if (!budget) return c.json({ error: "NOT_FOUND", message: `No budget ${body.data.budget_id}.` }, 404);
    if (!budget.members.some((m) => m.member === body.data.member)) return c.json({ error: "NOT_A_MEMBER", message: `${body.data.member} has no allowance in this budget. Add one through a DAO proposal first.` }, 409);
    const created = meter.createKey({ budgetId: body.data.budget_id, member: body.data.member, label: body.data.label ?? "", models: body.data.models ?? null, createdBy: (c as unknown as Ctx).get("session").account, now: nowDate() });
    return c.json({ key: created.key, row: created.row, note: "Store this key now. Only its hash is kept." }, 201);
  });

  app.post("/meter-keys/:id/revoke", requireOwner(), (c) => {
    if (!meter.revokeKey(c.req.param("id"), nowDate())) return c.json({ error: "NOT_FOUND", message: "No such active key." }, 404);
    return c.json({ revoked: c.req.param("id") });
  });
}
