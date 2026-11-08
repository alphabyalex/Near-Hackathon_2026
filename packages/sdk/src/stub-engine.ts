import type { EvidenceTier, PayeeCheckRequest, PayeeReason, PayeeReasonCode, PayeeSignals, PayeeVendor, PayeeVerdict } from "@wardline/schemas";
import { chainOf, normalizeChain, normalizeDomain, parseAccount, type ParsedAccount } from "./caip.js";
import type { EngineCheckResult, EngineContext, EngineResolveResult, PayeeEngine, PayeeRegistry, RegistryVendor } from "./interfaces.js";

const BLOCK_CODES: ReadonlySet<PayeeReasonCode> = new Set(["ACCOUNT_MISSING", "LOOKALIKE_ACCOUNT", "ACCOUNT_NOT_VENDORS"]);
const NEW_ACCOUNT_DAYS = 7;
const MIN_LOOKALIKE_LABEL = 5;

const UNAVAILABLE_SIGNALS: PayeeSignals = {
  supported: true,
  accountExists: null,
  createdAtBlock: null,
  ageDays: null,
  fullAccessKeysAddedLast7d: null,
  codeChangedLast7d: null,
  hasContract: null,
  lookalikeOf: null,
};

/** PAY only on VERIFIED_MATCH with nothing else. Any block code wins; everything else holds. */
export function verdictFromReasons(reasons: readonly PayeeReason[]): PayeeVerdict {
  if (reasons.some((r) => BLOCK_CODES.has(r.code))) return "BLOCK";
  if (reasons.length === 1 && reasons[0]?.code === "VERIFIED_MATCH") return "PAY";
  return "HOLD";
}

const toPublicVendor = (vendor: RegistryVendor): PayeeVendor => ({
  domain: vendor.domain,
  name: vendor.name,
  verifiedAt: vendor.verifiedAt,
  accounts: vendor.accounts.map((a) => ({
    account: a.account,
    status: a.status,
    activatesAt: a.activatesAt,
    ...(a.evidenceTier ? { evidenceTier: a.evidenceTier } : {}),
  })),
});

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

const unconfuse = (text: string): string =>
  text.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/[1il]/g, "l").replace(/5/g, "s").replace(/[-_]/g, "");

/** True when `candidate` imitates `real`: not the same account, but built to pass a quick look. */
export function looksLike(candidate: ParsedAccount, real: ParsedAccount): boolean {
  if (candidate.chain !== real.chain || candidate.address === real.address) return false;
  if (candidate.namespace === "near") {
    const candidateLabel = candidate.address.split(".")[0] ?? "";
    const realLabel = real.address.split(".")[0] ?? "";
    if (realLabel.length < MIN_LOOKALIKE_LABEL) return false;
    if (unconfuse(candidateLabel) === unconfuse(realLabel)) return true;
    return editDistance(candidate.address, real.address) <= 2 || candidateLabel.includes(realLabel);
  }
  // Address poisoning: EVM and Solana look-alikes copy the characters wallets show, the start and the end.
  const skip = candidate.namespace === "eip155" ? 2 : 0;
  const head = (address: string) => address.slice(skip, skip + 4);
  const tail = (address: string) => address.slice(-4);
  return head(candidate.address) === head(real.address) && tail(candidate.address) === tail(real.address);
}

async function findLookalike(payee: ParsedAccount, registry: PayeeRegistry, only: RegistryVendor | null): Promise<string | null> {
  const vendors = only ? [only] : await registry.listVendors();
  for (const vendor of vendors) {
    for (const { account } of vendor.accounts) {
      if (looksLike(payee, parseAccount(account))) return account;
    }
  }
  return null;
}

/**
 * The account's tier in the registry, raised to T3 when this payer has paid it before or its owner
 * approved it. T3 needs an active T2 account. An account the vendor did not list is T0.
 */
async function tierFor(vendor: RegistryVendor | null, caip10: string, payer: string | undefined, context: EngineContext): Promise<EvidenceTier> {
  const entry = vendor?.accounts.find((a) => a.account === caip10);
  if (!entry) return "T0_NONE";
  const tier = entry.evidenceTier ?? "T2_DOMAIN_LINKED";
  if (tier === "T2_DOMAIN_LINKED" && entry.status === "active" && payer && (await context.history.hasRelationship(payer, caip10))) {
    return "T3_RELATIONSHIP";
  }
  return tier;
}

async function readSignals(context: EngineContext, caip10: string): Promise<PayeeSignals> {
  try {
    return await context.signals.signals(caip10);
  } catch {
    return UNAVAILABLE_SIGNALS;
  }
}

function signalReasons(signals: PayeeSignals): PayeeReason[] {
  if (!signals.supported) return [];
  if (signals.accountExists === false) {
    return [{ code: "ACCOUNT_MISSING", detail: "This account does not exist on chain." }];
  }
  const unavailable =
    signals.accountExists === null ||
    signals.ageDays === null ||
    signals.fullAccessKeysAddedLast7d === null ||
    signals.codeChangedLast7d === null;
  if (unavailable) return [{ code: "SIGNALS_UNAVAILABLE", detail: "On-chain signals could not be read, so this account is unconfirmed." }];
  const reasons: PayeeReason[] = [];
  if ((signals.ageDays ?? 0) < NEW_ACCOUNT_DAYS) {
    reasons.push({ code: "NEW_ACCOUNT", detail: `This account is under ${NEW_ACCOUNT_DAYS} days old.` });
  }
  if ((signals.fullAccessKeysAddedLast7d ?? 0) > 0) {
    reasons.push({ code: "RECENT_FULL_ACCESS_KEY", detail: "A full-access key was added in the last 7 days." });
  }
  if (signals.codeChangedLast7d === true) {
    reasons.push({ code: "RECENT_CODE_CHANGE", detail: "Contract code changed in the last 7 days." });
  }
  return reasons;
}

async function claimedVendor(request: PayeeCheckRequest, registry: PayeeRegistry): Promise<{ domain: string | null; vendor: RegistryVendor | null }> {
  const claimed = request.vendor;
  if (claimed?.domain) {
    const domain = normalizeDomain(claimed.domain);
    return { domain, vendor: await registry.getVendor(domain) };
  }
  if (claimed?.name) {
    const name = claimed.name.trim().toLowerCase();
    const vendor = (await registry.listVendors()).find((v) => v.name.toLowerCase() === name || v.legalName?.toLowerCase() === name);
    return { domain: vendor?.domain ?? null, vendor: vendor ?? null };
  }
  return { domain: null, vendor: null };
}

function matchReasons(payee: ParsedAccount, vendor: RegistryVendor, lookalike: string | null): PayeeReason[] {
  const entry = vendor.accounts.find((a) => a.account === payee.caip10);
  if (entry?.status === "active") {
    return [{ code: "VERIFIED_MATCH", detail: `Account linked to ${vendor.domain}.` }];
  }
  if (entry) {
    return [{ code: "COOLING_OFF", detail: `Linked to ${vendor.domain}, active from ${entry.activatesAt ?? "a later date"}.` }];
  }
  if (lookalike) {
    return [{ code: "LOOKALIKE_ACCOUNT", detail: `Imitates ${lookalike}, an account linked to ${vendor.domain}.` }];
  }
  if (!vendor.accounts.some((a) => chainOf(a.account) === payee.chain)) {
    return [{ code: "CHAIN_NOT_VERIFIED", detail: `${vendor.domain} has no linked account on ${payee.chain}.` }];
  }
  return [{ code: "ACCOUNT_NOT_VENDORS", detail: `Not an account linked to ${vendor.domain}.` }];
}

/** Deterministic engine, used until @wardline/payee-check lands. Same inputs give the same verdict. */
export function createStubEngine(): PayeeEngine {
  return {
    async check(request, context): Promise<EngineCheckResult> {
      const payee = parseAccount(request.payee, context.network);
      const { registry } = context;
      const claim = await claimedVendor(request, registry);
      const owner = await registry.findByAccount(payee.caip10);
      const claimedSomething = Boolean(request.vendor?.domain || request.vendor?.name);
      const vendor = claim.vendor ?? (claimedSomething ? null : owner);
      const lookalike = owner ? null : await findLookalike(payee, registry, vendor);
      const signals = await readSignals(context, payee.caip10);

      const reasons: PayeeReason[] = [];
      if (vendor) {
        reasons.push(...matchReasons(payee, vendor, lookalike));
      } else if (lookalike) {
        reasons.push({ code: "LOOKALIKE_ACCOUNT", detail: `Imitates ${lookalike}, an account linked to a vendor domain.` });
      } else {
        const claimed = claim.domain ?? request.vendor?.name;
        reasons.push({ code: "NOT_IN_REGISTRY", detail: claimed ? `${claimed} is not in the registry.` : "This account is not in the registry." });
      }
      reasons.push(...signalReasons(signals));

      if (request.payer && vendor) {
        const last = await context.history.lastAccount(request.payer, vendor.domain, payee.chain);
        if (last !== null && last !== payee.caip10) {
          reasons.push({ code: "PAYEE_CHANGED", detail: `This payer last paid ${vendor.domain} at ${last}.` });
        }
      }

      return {
        verdict: verdictFromReasons(reasons),
        evidenceTier: await tierFor(vendor, payee.caip10, request.payer, context),
        payee: payee.caip10,
        reasons,
        vendor: vendor ? toPublicVendor(vendor) : null,
        signals: { ...signals, lookalikeOf: signals.lookalikeOf ?? lookalike },
        caseFile: null,
      };
    },

    async resolve(request, context): Promise<EngineResolveResult> {
      const domain = normalizeDomain(request.domain);
      const chain = normalizeChain(request.chain);
      const vendor = await context.registry.getVendor(domain);
      const hold = (reason: PayeeReason, found: RegistryVendor | null): EngineResolveResult => ({
        verdict: "HOLD",
        domain,
        chain,
        account: null,
        reasons: [reason],
        vendor: found ? toPublicVendor(found) : null,
        evidenceTier: "T0_NONE",
      });
      if (!vendor) return hold({ code: "NOT_IN_REGISTRY", detail: `${domain} is not in the registry.` }, null);
      const onChain = vendor.accounts.filter((a) => chainOf(a.account) === chain);
      const active = onChain.find((a) => a.status === "active");
      if (active) {
        return {
          verdict: "PAY",
          domain,
          chain,
          account: active.account,
          reasons: [{ code: "VERIFIED_MATCH", detail: `Account linked to ${domain}.` }],
          vendor: toPublicVendor(vendor),
          evidenceTier: await tierFor(vendor, active.account, request.payer, context),
        };
      }
      const pending = onChain[0];
      if (pending) {
        return hold({ code: "COOLING_OFF", detail: `${domain} linked an account on ${chain}, active from ${pending.activatesAt ?? "a later date"}.` }, vendor);
      }
      return hold({ code: "CHAIN_NOT_VERIFIED", detail: `${domain} has no linked account on ${chain}.` }, vendor);
    },
  };
}
