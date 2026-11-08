import { pathToFileURL } from "node:url";
import type { PayeeCheckRequest, PayeeSignals, PayeeVendor } from "@redline/schemas";
import { chainOf, normalizeAccount, type EngineContext, type PayeeEngine, type RegistryVendor } from "@redline/sdk";

/**
 * Adapts @redline/payee-check (Lucy's engine) to the benchmark. The benchmark builds each case's
 * registry, signals and history with the SDK's in-memory pieces; this maps them onto the
 * interfaces checkPayee expects. Nothing here changes how payee-check decides.
 */

interface ParsedAccountLike {
  namespace: string;
}

export interface PayeeCheckModule {
  checkPayee(request: PayeeCheckRequest, deps: unknown): Promise<{ verdict: string; payee: string; reasons: { code: string; detail: string }[]; vendor: PayeeVendor | null; signals: PayeeSignals }>;
  formatAccount(parsed: ParsedAccountLike): string;
}

const publicVendor = (v: RegistryVendor | null): PayeeVendor | null =>
  v === null ? null : { domain: v.domain, name: v.name, verifiedAt: v.verifiedAt, accounts: v.accounts.map(({ account, status, activatesAt }) => ({ account, status, activatesAt })) };

export function payeeCheckDeps(mod: PayeeCheckModule, ctx: EngineContext, request: PayeeCheckRequest, nowMs: number) {
  const chain = chainOf(normalizeAccount(request.payee, ctx.network));
  return {
    registry: {
      getVendor: async (domain: string) => publicVendor(await ctx.registry.getVendor(domain)),
      getVendorByAccount: async (caip10: string) => publicVendor(await ctx.registry.findByAccount(caip10)),
      isVerifiedPayee: async (caip10: string, domain: string) =>
        Boolean((await ctx.registry.getVendor(domain))?.accounts.some((a) => a.account === caip10 && a.status === "active")),
      resolve: async (domain: string, onChain: string) =>
        (await ctx.registry.getVendor(domain))?.accounts.find((a) => a.status === "active" && chainOf(a.account) === onChain)?.account ?? null,
      listVendors: async () => (await ctx.registry.listVendors()).map((v) => publicVendor(v) as PayeeVendor),
    },
    signals: {
      getSignals: async (parsed: ParsedAccountLike) => {
        const { lookalikeOf: _ignored, ...rest } = await ctx.signals.signals(mod.formatAccount(parsed));
        return rest;
      },
    },
    history: { lastPaidAccount: (payer: string, domain: string) => ctx.history.lastAccount(payer, domain, chain) },
    now: () => nowMs,
    defaultNearNetwork: ctx.network,
  };
}

export function liveEngine(mod: PayeeCheckModule, nowMs: number): PayeeEngine {
  return {
    async check(request, ctx) {
      const outcome = await mod.checkPayee(request, payeeCheckDeps(mod, ctx, request, nowMs));
      return { ...outcome, verdict: outcome.verdict as "PAY" | "HOLD" | "BLOCK", reasons: outcome.reasons as never, caseFile: null };
    },
    async resolve() {
      throw new Error("The benchmark only checks payees.");
    },
  };
}

/** Loads @redline/payee-check, or a built module at `modulePath` to try an unmerged checkout. */
export async function loadPayeeCheck(modulePath?: string): Promise<PayeeCheckModule> {
  const specifier = modulePath ? pathToFileURL(modulePath).href : "@redline/payee-check";
  let mod: Partial<PayeeCheckModule>;
  try {
    mod = (await import(specifier)) as Partial<PayeeCheckModule>;
  } catch (error) {
    throw new Error(`--engine live needs @redline/payee-check, which could not be loaded (${error instanceof Error ? error.message : String(error)}). Merge packages/payee-check and run pnpm install, or pass --payee-check <path to its dist/index.js>.`);
  }
  if (typeof mod.checkPayee !== "function" || typeof mod.formatAccount !== "function") {
    throw new Error("The payee-check module does not export checkPayee and formatAccount.");
  }
  return mod as PayeeCheckModule;
}
