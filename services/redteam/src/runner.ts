import type { EvidenceTier, PayeeCheckRequest, PayeeCheckResult, PayeeVerdict } from "@redline/schemas";
import {
  createMemoryHistory,
  createMemoryRegistry,
  createStubEngine,
  createStubSignals,
  RedlineBlockedError,
  type EngineContext,
  type PayeeEngine,
} from "@redline/sdk";
import { withRedline } from "@redline/x402-guard";
import { liveEngine, loadPayeeCheck } from "./live-engine.js";
import { ADVERSARIAL, ATTACK_FAMILIES, NEAR_CHAIN, type CaseParams } from "./params.js";

/** Every case is checked at this instant, so results do not depend on when the benchmark runs. */
export const BENCH_NOW = new Date("2026-11-08T12:00:00Z");
const DAY_MS = 86_400_000;

export interface EngineChoice {
  engine: PayeeEngine;
  name: "stub" | "live";
  note: string;
}

/**
 * stub: the deterministic engine in @redline/sdk, which the API runs today.
 * live: @redline/payee-check. Fails loudly when it is not installed, never falls back to the stub.
 */
export async function chooseEngine(mode: "stub" | "live" = "stub", modulePath?: string): Promise<EngineChoice> {
  if (mode === "live") {
    const mod = await loadPayeeCheck(modulePath);
    return {
      engine: liveEngine(mod, BENCH_NOW.getTime()),
      name: "live",
      note: modulePath ? `@redline/payee-check loaded from ${modulePath}, which is not merged yet.` : "@redline/payee-check produced the verdicts.",
    };
  }
  return { engine: createStubEngine(), name: "stub", note: "The stub engine in @redline/sdk produced the verdicts. @redline/payee-check has not merged; rerun with --engine live once it does." };
}

export const isAttack = (family: CaseParams["family"]): boolean => ATTACK_FAMILIES.includes(family) || family === ADVERSARIAL;

export interface CaseResult {
  id: string;
  family: CaseParams["family"];
  claim: CaseParams["claim"];
  lookalike: CaseParams["lookalike"];
  payee: string;
  realAccount: string;
  expectedVerdicts: PayeeVerdict[];
  expectedReason: string | null;
  verdict: PayeeVerdict;
  reasons: string[];
  /** Null when the engine does not report a tier. */
  evidenceTier: EvidenceTier | null;
  latencyMs: number;
  /** Attacks: anything but PAY. */
  caught: boolean;
  /** The verdict is one the ground truth allows. */
  verdictMatch: boolean;
  /** The verdict matches and, where one is expected, the reason code is among the reasons. */
  exactMatch: boolean;
  /** An attack that got PAY, or a cooling-off account that got PAY. */
  unsafe: boolean;
  /** A legit case answered more strictly than expected. */
  falsePositive: boolean;
}

const RANK: Record<PayeeVerdict, number> = { PAY: 0, HOLD: 1, BLOCK: 2 };

export async function contextFor(p: CaseParams): Promise<EngineContext> {
  let clock = new Date(BENCH_NOW.getTime() - 30 * DAY_MS);
  const registry = createMemoryRegistry({ now: () => clock, coolingOffHours: 72 });
  const base = { domain: p.vendor.domain, name: p.vendor.name, evidenceHash: "sha256:redteam", issuedAt: clock.toISOString() };
  await registry.attestVendor({ ...base, accounts: [p.vendorAccounts.near, p.vendorAccounts.evm] });
  if (p.family === "legit_new_account" && p.newAccountHoursAgo !== null) {
    clock = new Date(BENCH_NOW.getTime() - p.newAccountHoursAgo * 3_600_000);
    await registry.attestVendor({ ...base, issuedAt: clock.toISOString(), accounts: [p.vendorAccounts.near, p.vendorAccounts.evm, p.payee] });
  }
  clock = BENCH_NOW;

  const history = createMemoryHistory();
  // The payer has paid this vendor's real account before, so a switch is visible.
  await history.record({ payer: p.payer.account, domain: p.vendor.domain, account: p.realAccount });

  const overrides: Record<string, { ageDays: number }> = { [p.vendorAccounts.near]: { ageDays: 900 } };
  if (p.payee.startsWith(`${NEAR_CHAIN}:`) && p.payee !== p.vendorAccounts.near) overrides[p.payee] = { ageDays: p.payeeAgeDays };
  return { registry, history, signals: createStubSignals(overrides), network: "testnet" };
}

export function requestFor(p: CaseParams, context?: string): PayeeCheckRequest {
  const vendor = p.claim === "domain" ? { domain: p.vendor.domain } : p.claim === "name" ? { name: p.vendor.name } : undefined;
  const source = p.family === "invoice_injection" || p.family === "legit_recurring" ? "invoice" : "manual";
  return {
    payee: p.payee,
    ...(vendor ? { vendor } : {}),
    amount: p.amount.atomic,
    asset: p.amount.asset,
    payer: p.payer.account,
    source,
    ...(context ? { context: context.slice(0, 8000) } : {}),
  };
}

/** x402: a 402 response with the case's payTo goes through the real guard, which calls the engine. */
async function viaX402(p: CaseParams, engine: PayeeEngine, ctx: EngineContext): Promise<PayeeCheckResult> {
  let seen: PayeeCheckResult | null = null;
  const redline = {
    check: async (request: PayeeCheckRequest) => {
      seen = { ...(await engine.check({ ...request, payer: p.payer.account }, ctx)), receipt: null };
      return seen;
    },
  };
  const offer = { scheme: "exact", network: p.chain, amount: p.amount.atomic, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", payTo: p.payee.split(":")[2] };
  const server = (async () => new Response(JSON.stringify({ x402Version: 2, accepts: [offer] }), { status: 402 })) as typeof fetch;
  try {
    await withRedline(server, { redline })(`https://${p.vendor.domain}/paid/report`);
  } catch (error) {
    if (!(error instanceof RedlineBlockedError)) throw error;
  }
  if (!seen) throw new Error(`${p.id}: the guard never called the engine.`);
  return seen;
}

export async function runCase(p: CaseParams, engine: PayeeEngine, prose?: string): Promise<CaseResult> {
  if (!p.payee) throw new Error(`${p.id}: no payee. Adversarial cases need the model's account first.`);
  const ctx = await contextFor(p);
  const started = performance.now();
  const result = p.family === "x402_payto_swap" ? await viaX402(p, engine, ctx) : { ...(await engine.check(requestFor(p, prose), ctx)), receipt: null };
  const latencyMs = performance.now() - started;

  const reasons = result.reasons.map((r) => r.code);
  const attack = isAttack(p.family);
  const verdictMatch = p.expected.verdicts.includes(result.verdict);
  const primary = p.expected.verdicts[0] ?? "HOLD";
  return {
    id: p.id,
    family: p.family,
    claim: p.claim,
    lookalike: p.lookalike,
    payee: p.payee,
    realAccount: p.realAccount,
    expectedVerdicts: p.expected.verdicts,
    expectedReason: p.expected.reasonCode,
    verdict: result.verdict,
    reasons,
    evidenceTier: result.evidenceTier ?? null,
    latencyMs,
    caught: attack && result.verdict !== "PAY",
    verdictMatch,
    exactMatch: verdictMatch && (p.expected.reasonCode === null || reasons.includes(p.expected.reasonCode)),
    unsafe: result.verdict === "PAY" && primary !== "PAY",
    falsePositive: !attack && RANK[result.verdict] > RANK[primary],
  };
}
