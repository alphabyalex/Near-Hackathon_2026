import { GAS_PAYMENT, ONE_YOCTO, VaultExecutionError, callFinal, type SignerHandle } from "@redline/vault-client";
import { VaultPanic, VaultSim, type AgentCaller, type TransferOutcome } from "@redline/vault-sim";
import type { RequestResult } from "@redline/schemas";
import { Chain, DIGEST_A, FAR_FUTURE_NS, NS_PER_DAY, registerWithToken, type World, type WorldOptions } from "./harness.js";

export type Caller = "agent" | "stranger" | "agent_other_key";
export type TokenMode = "ok" | "fail" | "weird" | "hold";
export type Window = "open" | "early" | "expired";

/** One action, applied the same way to the contract and to the simulator. */
export type Step =
  | { op: "register"; ref: string; amount: bigint; window?: Window; vendor_revision?: number }
  | { op: "request"; ref: string; digest?: string; caller?: Caller; stale?: "vendor" | "policy" | "binding" }
  | { op: "owner_pay"; ref: string; as?: "owner" | "agent" }
  | { op: "cancel"; ref: string }
  | { op: "reopen"; ref: string }
  | { op: "set_vendor"; cap?: bigint; active?: boolean; rotate?: boolean; expected?: number }
  | { op: "set_policy"; weekly: bigint; lifetime: bigint; expected?: number }
  | { op: "pause" }
  | { op: "unpause" }
  | { op: "revoke" }
  | { op: "reactivate" }
  | { op: "fund"; amount: bigint }
  | { op: "withdraw"; amount: bigint; as?: "owner" | "agent" }
  | { op: "reconcile"; operation: string; settled: boolean }
  | { op: "token"; mode: TokenMode }
  /** Fake token in hold mode: starts the request and leaves it pending. */
  | { op: "request_held"; ref: string; digest?: string }
  /** Finishes the oldest held transfer. */
  | { op: "release"; outcome: "ok" | "fail" }
  /** Real token only: registers the vendor. */
  | { op: "register_vendor" }
  /**
   * Makes settled payments this many days older. The contract gets its rolling entries back-dated.
   * The sim's clock runs ahead instead, which is the same thing for the rolling window.
   */
  | { op: "days"; days: number };

/** What a step returned: a result, a stable panic code, or nothing. */
export type Observation = { result: RequestResult } | { panic: string } | { revision: number } | "done";

export interface Snapshot {
  usage: unknown;
  policy: unknown;
  binding: unknown;
  vendors: unknown;
  payables: unknown;
  operations: unknown;
}

function pickOperation(op: Record<string, unknown>): object {
  const { operation_id, payable_ref, amount_atomic, recipient, status, attempt, origin, request_digest } = op;
  return { operation_id, payable_ref, amount_atomic, recipient, status, attempt, origin, request_digest };
}

/** Shared times, computed once from the chain, so both sides see the same absolute values. */
export interface Clocks {
  window(kind: Window): { not_before_ns: string; due_at_ns: string; expires_at_ns: string };
}

function clocksFrom(now: bigint): Clocks {
  return {
    window(kind) {
      switch (kind) {
        case "open":
          return { not_before_ns: (now - NS_PER_DAY).toString(), due_at_ns: FAR_FUTURE_NS.toString(), expires_at_ns: FAR_FUTURE_NS.toString() };
        case "early":
          return { not_before_ns: (now + 3650n * NS_PER_DAY).toString(), due_at_ns: FAR_FUTURE_NS.toString(), expires_at_ns: FAR_FUTURE_NS.toString() };
        case "expired":
          return { not_before_ns: (now - 2n * NS_PER_DAY).toString(), due_at_ns: (now - NS_PER_DAY).toString(), expires_at_ns: (now - NS_PER_DAY).toString() };
      }
    },
  };
}

const unchangedBinding = (world: World) => ({
  agent_account_id: world.agent.account_id,
  public_key: world.agentKey.public_key,
  manifest_digest: DIGEST_A,
  assessment_ref: "run_test",
  expires_at_ns: FAR_FUTURE_NS.toString(),
});

class ChainDriver {
  private inFlight: Array<Promise<unknown>> = [];

  constructor(
    readonly world: World,
    private readonly clocks: Clocks,
    private readonly stranger: SignerHandle,
    private readonly otherKey: SignerHandle,
    private readonly rotated: SignerHandle,
  ) {}

  private catching(run: () => Promise<Observation>): Promise<Observation> {
    return run().catch((error: unknown) => {
      if (error instanceof VaultExecutionError) return { panic: error.code ?? JSON.stringify(error.failure) };
      throw error;
    });
  }

  private signerFor(caller: Caller | undefined): SignerHandle {
    if (caller === "stranger") return this.stranger;
    if (caller === "agent_other_key") return this.otherKey;
    return this.world.agentKey;
  }

  async apply(step: Step): Promise<Observation> {
    const w = this.world;
    return this.catching(async () => {
      switch (step.op) {
        case "register": {
          const vendorRevision = step.vendor_revision ?? (await w.revisions()).vendor;
          await w.admin.registerPayable({
            payable_ref: step.ref,
            vendor_id: "vnd",
            vendor_revision: vendorRevision,
            po_number: `PO-${step.ref}`,
            invoice_number: null,
            amount_atomic: step.amount.toString(),
            evidence_commitment: DIGEST_A,
            ...this.clocks.window(step.window ?? "open"),
          });
          return "done";
        }
        case "request": {
          const revisions = await w.revisions();
          const result = await w.request(
            step.ref,
            {
              ...(step.digest ? { request_digest: step.digest } : {}),
              ...(step.stale === "vendor" ? { expected_vendor_revision: revisions.vendor + 99 } : {}),
              ...(step.stale === "policy" ? { expected_policy_revision: revisions.policy + 99 } : {}),
              ...(step.stale === "binding" ? { expected_binding_revision: revisions.binding + 99 } : {}),
            },
            this.signerFor(step.caller),
          );
          return { result };
        }
        case "owner_pay":
          return { result: await w.ownerPay(step.ref, step.as === "agent" ? w.agent : w.owner) };
        case "cancel":
          await w.admin.cancelPayable(step.ref);
          return "done";
        case "reopen":
          await w.admin.reopenFailedPayable(step.ref);
          return "done";
        case "set_vendor": {
          const vendors = await w.view<Array<{ per_payment_cap_atomic: string; account_id: string; active: boolean; revision: number }>>("get_vendors");
          const current = vendors[0];
          if (!current) throw new Error("world has no vendor");
          await w.admin.setVendor(
            {
              vendor_id: "vnd",
              display_name: "Larkspur Office Supply",
              account_id: step.rotate ? this.rotated.account_id : current.account_id,
              per_payment_cap_atomic: (step.cap ?? BigInt(current.per_payment_cap_atomic)).toString(),
              active: step.active ?? current.active,
            },
            step.expected ?? current.revision,
          );
          return "done";
        }
        case "set_policy": {
          const policy = await w.view<{ revision: number; expires_at_ns: string }>("get_policy");
          await w.admin.setPolicy(
            { weekly_cap_atomic: step.weekly.toString(), lifetime_cap_atomic: step.lifetime.toString(), expires_at_ns: policy.expires_at_ns },
            step.expected ?? policy.revision,
          );
          return "done";
        }
        case "pause":
          await w.admin.pause();
          return "done";
        case "unpause":
          await w.admin.unpause();
          return "done";
        case "revoke":
          await w.admin.revokeAgent(w.agent.account_id);
          return "done";
        case "reactivate": {
          const revision = (await w.revisions()).binding;
          await w.admin.activateAgent(unchangedBinding(w), revision);
          return "done";
        }
        case "fund":
          if (!w.fake) throw new Error("fund step is for the fake token");
          await callFinal(w.owner, { contract_id: w.token.account_id, method: "fund", args: { vault: w.vaultId, amount: step.amount.toString() } });
          return "done";
        case "withdraw":
          await callFinal(step.as === "agent" ? w.agent : w.owner, {
            contract_id: w.vaultId,
            method: "withdraw_available",
            args: { amount: step.amount.toString() },
            deposit: ONE_YOCTO,
            gas: GAS_PAYMENT,
          });
          return "done";
        case "reconcile":
          await w.admin.reconcileOperation(step.operation, step.settled);
          return "done";
        case "token":
          await w.setTokenMode(step.mode);
          return "done";
        case "request_held": {
          const before = await w.transferCount();
          this.inFlight.push(w.request(step.ref, step.digest ? { request_digest: step.digest } : {}));
          await w.waitFor("the transfer to be held", async () => (await w.transferCount()) > before);
          return "done";
        }
        case "release":
          await w.releaseHeld(step.outcome);
          await this.inFlight.shift();
          return "done";
        case "register_vendor":
          await registerWithToken(w.token, w.owner, w.vendor.account_id);
          return "done";
        case "days":
          await w.chain.ageRolling(w.vaultId, BigInt(step.days) * NS_PER_DAY);
          return "done";
      }
    });
  }

  async snapshot(operationCount: number): Promise<Snapshot> {
    const w = this.world;
    const operations = [];
    for (let i = 1; i <= operationCount; i++) {
      const op = await w.operation(`op_${i}`);
      operations.push(op ? pickOperation(op as unknown as Record<string, unknown>) : null);
    }
    return {
      usage: await w.usage(),
      policy: await w.view("get_policy"),
      binding: await w.view("get_binding"),
      vendors: await w.view("get_vendors"),
      payables: await w.view("get_payables"),
      operations,
    };
  }
}

class SimDriver {
  private mode: TokenMode = "ok";
  private held: string[] = [];
  private heldWithdrawal: bigint[] = [];
  private registered: Set<string>;

  constructor(
    readonly sim: VaultSim,
    private readonly world: World,
    private readonly clocks: Clocks,
    private readonly stranger: SignerHandle,
    private readonly otherKey: SignerHandle,
    private readonly rotated: SignerHandle,
    vendorRegistered: boolean,
  ) {
    this.registered = new Set(vendorRegistered ? [world.vendor.account_id, world.owner.account_id] : [world.owner.account_id]);
  }

  private outcomeFor(recipient: string): TransferOutcome | null {
    if (!this.world.fake) return this.registered.has(recipient) ? "success" : "failed";
    if (this.mode === "ok") return "success";
    if (this.mode === "fail") return "failed";
    if (this.mode === "weird") return "unknown";
    return null;
  }

  private callerFor(caller: Caller | undefined): AgentCaller {
    const w = this.world;
    if (caller === "stranger") return { predecessor: this.stranger.account_id, signer: this.stranger.account_id, public_key: this.stranger.public_key };
    if (caller === "agent_other_key") return { predecessor: w.agent.account_id, signer: w.agent.account_id, public_key: this.otherKey.public_key };
    return { predecessor: w.agent.account_id, signer: w.agent.account_id, public_key: w.agentKey.public_key };
  }

  private settleNew(result: RequestResult, operationCountBefore: number, operationCountAfter: number): void {
    if (!result.ok || !result.operation_id || operationCountAfter === operationCountBefore) return;
    const operation = this.sim.getOperation(result.operation_id);
    if (!operation) return;
    const outcome = this.outcomeFor(operation.recipient);
    if (outcome) this.sim.resolveOperation(result.operation_id, outcome);
    else this.held.push(result.operation_id);
  }

  private count(): number {
    let n = 0;
    while (this.sim.getOperation(`op_${n + 1}`)) n++;
    return n;
  }

  operationCount(): number {
    return this.count();
  }

  apply(step: Step): Observation {
    const sim = this.sim;
    const w = this.world;
    try {
      switch (step.op) {
        case "register":
          sim.registerPayable(w.owner.account_id, {
            payable_ref: step.ref,
            vendor_id: "vnd",
            vendor_revision: step.vendor_revision ?? sim.getVendors()[0]?.revision ?? 0,
            po_number: `PO-${step.ref}`,
            invoice_number: null,
            amount_atomic: step.amount.toString(),
            evidence_commitment: DIGEST_A,
            ...this.clocks.window(step.window ?? "open"),
          });
          return "done";
        case "request":
        case "request_held": {
          const vendorRevision = sim.getVendors()[0]?.revision ?? 0;
          const policyRevision = sim.getPolicy().revision;
          const bindingRevision = sim.getBinding()?.revision ?? 0;
          const stale = step.op === "request" ? step.stale : undefined;
          const before = this.count();
          const result = sim.requestPayment(this.callerFor(step.op === "request" ? step.caller : undefined), {
            payable_ref: step.ref,
            request_digest: step.digest ?? DIGEST_A,
            expected_vendor_revision: stale === "vendor" ? vendorRevision + 99 : vendorRevision,
            expected_policy_revision: stale === "policy" ? policyRevision + 99 : policyRevision,
            expected_binding_revision: stale === "binding" ? bindingRevision + 99 : bindingRevision,
          });
          this.settleNew(result, before, this.count());
          return step.op === "request" ? { result } : "done";
        }
        case "owner_pay": {
          const before = this.count();
          const result = sim.ownerPay(step.as === "agent" ? w.agent.account_id : w.owner.account_id, step.ref);
          this.settleNew(result, before, this.count());
          return { result };
        }
        case "cancel":
          sim.cancelPayable(w.owner.account_id, step.ref);
          return "done";
        case "reopen":
          sim.reopenFailedPayable(w.owner.account_id, step.ref);
          return "done";
        case "set_vendor": {
          const current = sim.getVendors()[0];
          if (!current) throw new Error("sim has no vendor");
          sim.setVendor(
            w.owner.account_id,
            {
              vendor_id: "vnd",
              display_name: "Larkspur Office Supply",
              account_id: step.rotate ? this.rotated.account_id : current.account_id,
              per_payment_cap_atomic: (step.cap ?? BigInt(current.per_payment_cap_atomic)).toString(),
              active: step.active ?? current.active,
            },
            step.expected ?? current.revision,
          );
          return "done";
        }
        case "set_policy": {
          const policy = sim.getPolicy();
          sim.setPolicy(
            w.owner.account_id,
            { weekly_cap_atomic: step.weekly.toString(), lifetime_cap_atomic: step.lifetime.toString(), expires_at_ns: policy.expires_at_ns },
            step.expected ?? policy.revision,
          );
          return "done";
        }
        case "pause":
          sim.pause(w.owner.account_id);
          return "done";
        case "unpause":
          sim.unpause(w.owner.account_id);
          return "done";
        case "revoke":
          sim.revokeAgent(w.owner.account_id, w.agent.account_id);
          return "done";
        case "reactivate":
          sim.activateAgent(w.owner.account_id, unchangedBinding(w), sim.getBinding()?.revision ?? 0);
          return "done";
        case "fund":
          sim.fund(step.amount);
          return "done";
        case "withdraw": {
          sim.withdrawAvailable(step.as === "agent" ? w.agent.account_id : w.owner.account_id, step.amount);
          const outcome = this.outcomeFor(w.owner.account_id);
          if (outcome) sim.resolveWithdrawal(step.amount, outcome);
          else this.heldWithdrawal.push(step.amount);
          return "done";
        }
        case "reconcile":
          sim.reconcileOperation(w.owner.account_id, step.operation, step.settled);
          return "done";
        case "token":
          this.mode = step.mode;
          return "done";
        case "release": {
          const operationId = this.held.shift();
          if (!operationId) throw new Error("nothing held in the sim");
          sim.resolveOperation(operationId, step.outcome === "ok" ? "success" : "failed");
          return "done";
        }
        case "register_vendor":
          this.registered.add(w.vendor.account_id);
          return "done";
        case "days":
          return "done";
      }
    } catch (error) {
      if (error instanceof VaultPanic) return { panic: error.code };
      throw error;
    }
  }

  snapshot(): Snapshot {
    const sim = this.sim;
    const operations = [];
    for (let i = 1; i <= this.count(); i++) {
      const op = sim.getOperation(`op_${i}`);
      operations.push(op ? pickOperation(op as unknown as Record<string, unknown>) : null);
    }
    return {
      usage: sim.getUsage(),
      policy: sim.getPolicy(),
      binding: sim.getBinding(),
      vendors: sim.getVendors(),
      payables: sim.getPayables(),
      operations,
    };
  }
}

export interface ParityReport {
  steps: number;
  mismatch: { index: number; step: Step; contract: unknown; sim: unknown } | null;
  /** How often each outcome came up, so a test can check a sequence was not vacuous. */
  outcomes: Record<string, number>;
}

function outcomeLabel(observation: Observation): string {
  if (observation === "done") return "done";
  if ("panic" in observation) return observation.panic;
  if ("result" in observation) return observation.result.rejection ?? "ACCEPTED";
  return "done";
}

/** BigInts in steps, so a mismatch can be printed. */
function printable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as unknown;
}

/** Builds a tenant and a matching simulator, runs `steps` on both, and stops at the first difference. */
export async function runParity(chain: Chain, makeWorldFn: (options: WorldOptions) => Promise<World>, options: WorldOptions, steps: Step[]): Promise<ParityReport> {
  const world = await makeWorldFn({ funded: 1_000_000n, weekly_cap: 100_000n, lifetime_cap: 1_000_000n, vendor_cap: 50_000n, ...options });
  const stranger = await chain.account("stranger");
  const rotated = await chain.account("rotated");
  const otherKey = await chain.restrictedKey(world.agent, world.vaultId, ["request_payment"]);
  const now = await chain.blockTimestampNs();
  const clocks = clocksFrom(now);

  const sim = new VaultSim({
    vault_id: world.vaultId,
    owner: world.owner.account_id,
    guardian: world.guardian?.account_id ?? null,
    token_contract: world.token.account_id,
    token_decimals: 6,
    policy: {
      weekly_cap_atomic: (options.weekly_cap ?? 100_000n).toString(),
      lifetime_cap_atomic: (options.lifetime_cap ?? 1_000_000n).toString(),
      expires_at_ns: FAR_FUTURE_NS.toString(),
    },
    now_ns: now,
    auto_resolve: false,
    ...(options.capacities ? { capacities: options.capacities } : {}),
  });
  sim.setVendor(world.owner.account_id, { vendor_id: "vnd", display_name: "Larkspur Office Supply", account_id: world.vendor.account_id, per_payment_cap_atomic: (options.vendor_cap ?? 50_000n).toString(), active: true }, 0);
  sim.activateAgent(world.owner.account_id, unchangedBinding(world), 0);
  sim.fund(options.funded ?? 1_000_000n);
  if (options.unpaused !== false) sim.unpause(world.owner.account_id);

  const contract = new ChainDriver(world, clocks, stranger, otherKey, rotated);
  const model = new SimDriver(sim, world, clocks, stranger, otherKey, rotated, options.register_vendor !== false);

  let simAhead = 0n;
  const syncClock = async () => sim.setNow((await chain.blockTimestampNs()) + simAhead);
  const outcomes: Record<string, number> = {};

  for (const [index, step] of steps.entries()) {
    await syncClock();
    const fromContract = await contract.apply(step);
    if (step.op === "days") simAhead += BigInt(step.days) * NS_PER_DAY;
    await syncClock();
    const fromSim = model.apply(step);
    if (JSON.stringify(fromContract) !== JSON.stringify(fromSim)) {
      return { steps: index, outcomes, mismatch: { index, step: printable(step) as Step, contract: fromContract, sim: fromSim } };
    }
    const label = outcomeLabel(fromContract);
    outcomes[label] = (outcomes[label] ?? 0) + 1;
    await syncClock();
    const contractState = await contract.snapshot(model.operationCount());
    const simState = model.snapshot();
    if (JSON.stringify(contractState) !== JSON.stringify(simState)) {
      return { steps: index, outcomes, mismatch: { index, step: printable(step) as Step, contract: contractState, sim: simState } };
    }
  }
  return { steps: steps.length, mismatch: null, outcomes };
}
