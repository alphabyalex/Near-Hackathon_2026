import {
  DecisionSchema,
  type AgentContext,
  type Decision,
  type PaymentRequest,
  type PayableStatus,
  type RequestResult,
  type VaultUsage,
} from "@redline/schemas";
import type { GymAgent, TokenUsage } from "./agents.js";
import { groupForRun, type LoadedScenario } from "./fixtures.js";
import { DECIDE_TIMEOUT_MS } from "./rubric.js";
import { createStubVaultSim, type SimTransfer, type VaultSim, type VaultSimFactory } from "./sim.js";

/** Everything that happened in one scenario step. Raw facts only; scoring is in oracle.ts. */
export interface CaseRecord {
  scenario_id: string;
  family: string;
  sequence: { sequence_id: string; step: number; of: number } | null;
  vault_id: string;
  /** Raw agent output before validation, kept so invalid output stays visible. */
  raw_decision: unknown;
  decision: Decision | null;
  decision_error: string | null;
  request: PaymentRequest | null;
  adapter_error: string | null;
  vault_response: RequestResult | null;
  vault_error: string | null;
  /** Transfers that settled during this step only. */
  transfers: SimTransfer[];
  /** Payable statuses in this vault before and after the step. */
  payables_before: Record<string, PayableStatus>;
  payables_after: Record<string, PayableStatus>;
  usage_before: VaultUsage;
  usage_after: VaultUsage;
  latency_ms: number;
  timed_out: boolean;
  infra_error: string | null;
  usage: TokenUsage | null;
}

export interface RunOptions {
  timeoutMs?: number;
  simFactory?: VaultSimFactory;
  /** Injectable for tests. */
  clock?: () => number;
}

class TimeoutError extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function statuses(sim: VaultSim, vaultId: string, refs: string[]): Promise<Record<string, PayableStatus>> {
  const out: Record<string, PayableStatus> = {};
  for (const r of refs) {
    const p = await sim.getPayable(vaultId, r);
    if (p) out[r] = p.status;
  }
  return out;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Runs one agent over a suite. Each standalone scenario gets a fresh ledger; each sequence gets
 * one fresh ledger shared by its steps. Agent errors and timeouts are recorded, never dropped.
 */
export async function runSuite(suite: LoadedScenario[], agent: GymAgent, opts: RunOptions = {}): Promise<CaseRecord[]> {
  const timeoutMs = opts.timeoutMs ?? DECIDE_TIMEOUT_MS;
  const factory = opts.simFactory ?? createStubVaultSim;
  const clock = opts.clock ?? (() => performance.now());
  const records: CaseRecord[] = [];

  for (const group of groupForRun(suite)) {
    const first = group[0]!;
    const vaultId = first.scenario.intake.vault_id;
    const st = first.state;
    const sim = factory(
      [
        {
          vault_id: vaultId,
          policy: st.policy,
          binding_revision: st.binding_revision,
          binding_enabled: st.binding_enabled,
          vendors: first.scenario.context.vendors,
          payables: first.scenario.context.payables,
          balance_atomic: st.balance_atomic,
          weekly_settled_atomic: st.weekly_settled_atomic,
          lifetime_settled_atomic: st.lifetime_settled_atomic,
        },
      ],
      BigInt(st.now_ns ?? first.scenario.intake.received_at_ns),
    );

    for (const item of group) {
      const { scenario } = item;
      sim.setNow(BigInt(item.state.now_ns ?? scenario.intake.received_at_ns));
      const refs = scenario.context.payables.map((p) => p.payable_ref);
      const before = await statuses(sim, vaultId, refs);
      const usageBefore = await sim.getUsage(vaultId);
      const transfersBefore = sim.transfers().length;

      // Trusted context with live payable statuses from the ledger (matters for sequences).
      const ctx: AgentContext = structuredClone(scenario.context);
      for (const p of ctx.payables) p.status = before[p.payable_ref] ?? p.status;

      const rec: CaseRecord = {
        scenario_id: scenario.scenario_id,
        family: scenario.family,
        sequence: item.state.sequence ?? null,
        vault_id: vaultId,
        raw_decision: null,
        decision: null,
        decision_error: null,
        request: null,
        adapter_error: null,
        vault_response: null,
        vault_error: null,
        transfers: [],
        payables_before: before,
        payables_after: before,
        usage_before: usageBefore,
        usage_after: usageBefore,
        latency_ms: 0,
        timed_out: false,
        infra_error: null,
        usage: null,
      };

      const t0 = clock();
      try {
        rec.raw_decision = await withTimeout(agent.runner.decide(structuredClone(scenario.intake), ctx), timeoutMs);
      } catch (e) {
        rec.timed_out = e instanceof TimeoutError;
        rec.infra_error = `agent: ${errMsg(e)}`;
      }
      rec.latency_ms = Math.max(0, Math.round(clock() - t0));
      rec.usage = agent.lastUsage?.() ?? null;

      if (rec.infra_error === null) {
        const parsed = DecisionSchema.safeParse(rec.raw_decision);
        if (!parsed.success) rec.decision_error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        else if (parsed.data.intake_ref !== scenario.intake.intake_ref) rec.decision_error = "decision.intake_ref does not match the intake";
        else rec.decision = parsed.data;
      }

      if (rec.decision?.decision === "PAY") {
        try {
          const policy = await sim.getPolicy(vaultId);
          const binding = await sim.getBinding(vaultId);
          rec.request = await agent.adapter.toPaymentRequest(rec.decision, ctx, {
            policy_revision: policy.revision,
            binding_revision: binding?.revision ?? 0,
          });
        } catch (e) {
          rec.adapter_error = errMsg(e);
        }
        if (rec.request) {
          try {
            rec.vault_response = await sim.requestPayment(vaultId, rec.request);
          } catch (e) {
            // Per VaultGateway: a throw means the outcome is unknown. Never treat it as a rejection.
            rec.vault_error = errMsg(e);
            rec.infra_error = `vault: outcome unknown: ${rec.vault_error}`;
          }
        }
      }

      rec.transfers = sim.transfers().slice(transfersBefore);
      rec.payables_after = await statuses(sim, vaultId, refs);
      rec.usage_after = await sim.getUsage(vaultId);
      records.push(rec);
    }
  }
  return records;
}
