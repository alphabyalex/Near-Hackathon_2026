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
import { GROUP_BUDGET, mutualStats, SIM_SEED_PROOFS } from "./chain/index.js";
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
/** NEAR account ids: 2 to 64 characters of lowercase letters, digits, - _ and dots. */
export const Account = z.string().min(2).max(64).regex(/^[a-z0-9._-]+$/, "Not a NEAR account id.");
/** The smallest deposit: 1 USDC. Smaller ones cost more in gas than they earn. */
export const MIN_DEPOSIT_ATOMIC = 1_000_000n;
const Atomic = z.string().regex(/^[1-9][0-9]{0,30}$/);
const PoolChallenge = z.union([
  z.object({ account: Account, action: z.literal("deposit"), amount: Atomic.refine((v) => BigInt(v) >= MIN_DEPOSIT_ATOMIC, { message: "BELOW_MINIMUM" }) }),
  z.object({ account: Account, action: z.literal("withdraw"), amount: Atomic }),
  z.object({ account: Account, action: z.literal("redeem"), id: z.string().regex(/^[a-z0-9_]{3,40}$/) }),
  z.object({ account: Account, action: z.literal("vote"), id: z.number().int().min(0), support: z.enum(["for", "against"]) }),
  z.object({ account: Account, action: z.literal("propose"), description: z.string().trim().min(4).max(200), proposal: MutualActionSchema }),
]);
type PoolRequest = z.infer<typeof PoolChallenge>;
const BudgetId = z.string().regex(/^[a-z0-9_]{3,64}$/);
const ProposalId = z.coerce.number().int().min(0).max(1_000_000);
const ProofsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) });
const badParam = (what: string) => ({ error: "BAD_REQUEST", message: `Not a valid ${what}.` });
const PoolSigned = z.object({ nonce: z.string(), publicKey: z.string(), signature: z.string() });
const MeterKeyBody = z.object({ budget_id: z.string().min(1).default(GROUP_BUDGET), member: z.string().min(2).max(64), label: z.string().max(60).optional(), models: z.array(z.string()).min(1).optional() });

/** A stable code for a refused Mutual request, so the site can say what happened and what to do next. */
export function refusalCode(message: string): string {
  if (/closed/i.test(message)) return "VOTING_CLOSED";
  if (/wait is not over|cooldown|unlock/i.test(message)) return "COOLDOWN";
  if (/already voted/i.test(message)) return "ALREADY_VOTED";
  if (/held no WARD|no vote/i.test(message)) return "NO_WEIGHT";
  if (/not enough free WARD/i.test(message)) return "NOT_ENOUGH_WARD";
  if (/already executed/i.test(message)) return "ALREADY_EXECUTED";
  return "REFUSED";
}

/** Errors from a chain client that mean the RPC is down, not that the request was wrong. */
export function isChainOutage(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network|timed? ?out|RPC|503|502|504|Server error/i.test(text);
}

export function registerAiPublicRoutes(app: Hono<never>, deps: Deps): void {
  const nowMs = () => Number(deps.now() / 1_000_000n);
  const pool = deps.ai.chain.pool;

  // Which TEE signer is attested for which model. In near mode this mirrors the model registry contract.
  app.get("/v1/ai-registry", async (c) => c.json({ mode: deps.ai.chain.mode, contract: deps.ai.contracts.registry, models: await deps.ai.chain.registry.listModels() }));

  // token: the USDC contract a wallet sends ft_transfer_call to, with the pool as receiver.
  app.get("/v1/pool", async (c) => c.json({ mode: deps.ai.chain.mode, contract: deps.ai.contracts.pool, token: deps.ai.contracts.token, pool: await pool.getPool(), claims: await pool.listClaims() }));

  app.get("/v1/pool/positions/:account", async (c) => {
    const account = Account.safeParse(c.req.param("account"));
    if (!account.success) return c.json(badParam("NEAR account id"), 400);
    return c.json(await pool.getPosition(account.data));
  });

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

  const flaggedNow = async () => {
    const proposals = await deps.ai.dao.listProposals().catch(() => [] as ProposalView[]);
    return (await payoutsAwaitingVote(deps, proposals)).filter((p) => p.flagged).length;
  };

  // The latest metered calls, without members, keys or content: what happened, for which group, and which side of the line.
  app.get("/v1/proofs", async (c) => {
    const query = ProofsQuery.safeParse({ limit: c.req.query("limit") ?? undefined });
    if (!query.success) return c.json(badParam("limit (1 to 50)"), 400);
    const limit = query.data.limit;
    const names = new Map((await chain.reputation.listReputations()).map((r) => [r.budget_id, r.name]));
    const calls = deps.ai.meter.listCalls(undefined, limit);
    const proofs = calls.map((x) => ({
      call_id: x.callId,
      budget_id: x.budgetId,
      group: names.get(x.budgetId) ?? x.budgetId,
      side: x.status === "verified" ? "above" : "below",
      status: x.status,
      reason: x.reason,
      model_claimed: x.modelClaimed,
      model_proven: x.modelProven,
      amount: x.amount,
      refund: x.refund,
      created_at: x.createdAt,
      // The settle or release transaction. In near mode a NEAR hash; in sim mode a simulated id.
      tx: x.settlementTx ?? x.releaseTx,
    }));
    // In sim mode the feed is never empty: the live seed's groups' recent calls follow any real ones.
    if (chain.mode === "sim") {
      for (const s of SIM_SEED_PROOFS.slice(0, Math.max(0, limit - proofs.length))) {
        const { minutes_ago, ...row } = s;
        proofs.push({ ...row, tx: null, group: names.get(row.budget_id) ?? row.budget_id, side: row.status === "verified" ? "above" : "below", created_at: new Date(nowMs() - minutes_ago * 60_000).toISOString() });
      }
    }
    return c.json({ mode: chain.mode, proofs });
  });

  // Everything the Mutual home page shows, in one call.
  app.get("/v1/mutual", async (c) => {
    const [poolView, claims, list, proposals, tiers, params] = await Promise.all([pool.getPool(), pool.listClaims(), groups(), chain.governance.listProposals(), chain.reputation.tierRules(), chain.governance.params()]);
    return c.json({
      mode: chain.mode,
      // sim, or near: reputation and voting read from the meter and pool contracts (T4.6).
      mutual_mode: chain.governance.mode,
      contract: deps.ai.contracts.pool,
      min_deposit: MIN_DEPOSIT_ATOMIC.toString(),
      pool: poolView,
      claims,
      stats: await mutualStats(chain, await flaggedNow()),
      groups: list,
      tiers,
      governance: { ...params, proposals },
    });
  });

  app.get("/v1/groups", async (c) => c.json({ mode: chain.reputation.mode, groups: await groups(), tiers: await chain.reputation.tierRules() }));

  // get_reputation(budget_id)
  app.get("/v1/reputation/:budget", async (c) => {
    const budget = BudgetId.safeParse(c.req.param("budget"));
    if (!budget.success) return c.json(badParam("budget id"), 400);
    const r = await chain.reputation.getReputation(budget.data);
    return r ? c.json(r) : c.json({ error: "NOT_FOUND", message: "No group with that budget." }, 404);
  });

  app.get("/v1/mutual/proposals", async (c) => c.json({ mode: chain.governance.mode, ...(await chain.governance.params()), proposals: await chain.governance.listProposals() }));

  app.get("/v1/mutual/proposals/:id/weight/:account", async (c) => {
    const id = ProposalId.safeParse(c.req.param("id"));
    const account = Account.safeParse(c.req.param("account"));
    if (!id.success || !account.success) return c.json(badParam("proposal id or account"), 400);
    if (!(await chain.governance.getProposal(id.data))) return c.json({ error: "NOT_FOUND", message: "No such proposal." }, 404);
    return c.json({ id: id.data, account: account.data, weight: await chain.governance.weightOf(id.data, account.data) });
  });

  // Anyone can execute a passed proposal. It runs once.
  app.post("/v1/mutual/proposals/:id/execute", async (c) => {
    const parsed = ProposalId.safeParse(c.req.param("id"));
    if (!parsed.success) return c.json(badParam("proposal id"), 400);
    const id = parsed.data;
    if (!(await chain.governance.getProposal(id))) return c.json({ error: "NOT_FOUND", message: "No such proposal." }, 404);
    try {
      return c.json({ proposal: await chain.governance.execute(id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution refused.";
      return c.json({ error: refusalCode(message), message }, 409);
    }
  });

  // Deposit and withdraw are signed by the LP's own wallet (NEP-413), in sim mode only. In near mode
  // the wallet sends the transaction itself (ft_transfer_call, vote, request_redeem, redeem on the pool
  // contract), and these routes refuse before touching any pool: a signed message moves no USDC, and the
  // pool's own deposit(account, amount) would mint WARD for nothing.
  const walletTransactionOnly = () => ({
    error: "WALLET_TRANSACTION",
    message: "On NEAR testnet the Mutual takes real transactions: your wallet signs them and sends them to the pool contract. A signed message moves no USDC.",
    pool: deps.ai.contracts.pool,
  });
  app.post("/v1/pool/challenge", async (c) => {
    if (deps.ai.chain.mode === "near") return c.json(walletTransactionOnly(), 409);
    const body = PoolChallenge.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      if (body.error.issues.some((i) => i.message === "BELOW_MINIMUM")) return c.json({ error: "BELOW_MINIMUM", message: "The smallest deposit is 1.00 USDC.", min: MIN_DEPOSIT_ATOMIC.toString() }, 400);
      return c.json({ error: "BAD_REQUEST", message: z.prettifyError(body.error) }, 400);
    }
    const expiresAt = new Date(nowMs() + POOL_TTL_MS).toISOString();
    const message = `wardline-mutual:v1:${JSON.stringify({ ...body.data, pool: deps.ai.contracts.pool, expiresAt })}`;
    const nonce = randomBytes(32).toString("base64");
    deps.store.saveChallenge({ nonce, account: body.data.account, message, expiresAt: nowMs() + POOL_TTL_MS }, nowMs());
    return c.json({ message, recipient: MUTUAL_RECIPIENT, nonce, expiresAt });
  });

  app.post("/v1/pool/submit", async (c) => {
    if (deps.ai.chain.mode === "near") return c.json(walletTransactionOnly(), 409);
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
      const message = error instanceof Error ? error.message : "Pool refused the request.";
      return c.json({ error: refusalCode(message), message }, 409);
    }
  });

  // How one account voted, across every proposal. Votes are public on chain; this is the same view.
  app.get("/v1/mutual/votes/:account", async (c) => {
    const account = Account.safeParse(c.req.param("account"));
    if (!account.success) return c.json({ error: "BAD_REQUEST", message: "Not a NEAR account id." }, 400);
    const proposals = await chain.governance.listProposals();
    const votes = [];
    for (const p of proposals) {
      const v = (await chain.governance.voteOf?.(p.id, account.data)) ?? null;
      if (v) votes.push({ id: p.id, support: v.support, weight: v.weight });
    }
    return c.json({ account: account.data, votes });
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
