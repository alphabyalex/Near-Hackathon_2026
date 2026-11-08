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
import { ATTACK_FAMILIES, NEAR_CHAIN, type CaseParams } from "./params.js";

/** Every case is checked at this instant, so results do not depend on when the benchmark runs. */
export const BENCH_NOW = new Date("2026-11-08T12:00:00Z");
const DAY_MS = 86_400_000;

export interface EngineChoice {
  engine: PayeeEngine;
  name: "stub" | "live";
  note: string;
}

/** @redline/payee-check once it lands in the workspace, otherwise the API's stub engine. */
export async function chooseEngine(): Promise<EngineChoice> {
  const specifier = "@redline/payee-check";
  try {
    await import(specifier);
    return { engine: createStubEngine(), name: "stub", note: "@redline/payee-check is installed but has no PayeeEngine adapter yet, so the stub engine produced the verdicts." };
  } catch {
    return { engine: createStubEngine(), name: "stub", note: "@redline/payee-check has not landed in this branch, so the stub engine from @redline/sdk produced the verdicts." };
  }
}

export interface CaseResult {
  id: string;
  family: CaseParams["family"];
  claim: CaseParams["claim"];
  lookalike: CaseParams["lookalike"];
  expectedVerdicts: PayeeVerdict[];
  expectedReason: string;
  verdict: PayeeVerdict;
  reasons: string[];
  evidenceTier: EvidenceTier;
  latencyMs: number;
  /** Attack families: anything but PAY. */
  caught: boolean;
  /** The verdict is one the ground truth allows. */
  verdictMatch: boolean;
  /** The verdict matches and the expected reason code is among the reasons. */
  exactMatch: boolean;
  /** An attack that got PAY, or a cooling-off account that got PAY. */
  unsafe: boolean;
  /** A legit case answered more strictly than expected. */
  falsePositive: boolean;
}

const RANK: Record<PayeeVerdict, number> = { PAY: 0, HOLD: 1, BLOCK: 2 };

async function contextFor(p: CaseParams): Promise<EngineContext> {
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

function requestFor(p: CaseParams, context: string | undefined): PayeeCheckRequest {
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
  const ctx = await contextFor(p);
  const started = performance.now();
  const result = p.family === "x402_payto_swap" ? await viaX402(p, engine, ctx) : { ...(await engine.check(requestFor(p, prose), ctx)), receipt: null };
  const latencyMs = performance.now() - started;

  const reasons = result.reasons.map((r) => r.code);
  const attack = ATTACK_FAMILIES.includes(p.family);
  const verdictMatch = p.expected.verdicts.includes(result.verdict);
  const primary = p.expected.verdicts[0] ?? "HOLD";
  return {
    id: p.id,
    family: p.family,
    claim: p.claim,
    lookalike: p.lookalike,
    expectedVerdicts: p.expected.verdicts,
    expectedReason: p.expected.reasonCode,
    verdict: result.verdict,
    reasons,
    evidenceTier: result.evidenceTier ?? "T0_NONE",
    latencyMs,
    caught: attack && result.verdict !== "PAY",
    verdictMatch,
    exactMatch: verdictMatch && reasons.includes(p.expected.reasonCode),
    unsafe: result.verdict === "PAY" && primary !== "PAY",
    falsePositive: !attack && RANK[result.verdict] > RANK[primary],
  };
}
