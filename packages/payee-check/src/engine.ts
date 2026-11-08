import { PayeeCheckRequest, PayeeResolveRequest, type PayeeReason, type PayeeReasonCode, type PayeeVendor, type PayeeVerdict } from "@redline/schemas";
import { AccountParseError, formatAccount, normalizeDomain, parseAccount, parseChainId, tryParseAccount, type ParsedAccount } from "./caip.js";
import { PAYEE_CHECK_CONFIG } from "./config.js";
import { detectLookalike, verifiedEntries } from "./lookalike.js";
import { UNAVAILABLE_SIGNALS } from "./signals/near-signals.js";
import { PayeeDependencyError, type ChainSignals, type CheckDeps, type CheckOutcome, type ResolveOutcome } from "./types.js";

export const BLOCK_CODES: ReadonlySet<PayeeReasonCode> = new Set(["ACCOUNT_MISSING", "LOOKALIKE_ACCOUNT", "ACCOUNT_NOT_VENDORS"]);
export const HOLD_CODES: ReadonlySet<PayeeReasonCode> = new Set([
  "NOT_IN_REGISTRY",
  "CHAIN_NOT_VERIFIED",
  "COOLING_OFF",
  "NEW_ACCOUNT",
  "RECENT_FULL_ACCESS_KEY",
  "RECENT_CODE_CHANGE",
  "PAYEE_CHANGED",
  "SIGNALS_UNAVAILABLE",
]);

/** BLOCK beats HOLD; PAY only on VERIFIED_MATCH with nothing else. */
export function verdictFor(reasons: PayeeReason[]): PayeeVerdict {
  if (reasons.some((r) => BLOCK_CODES.has(r.code))) return "BLOCK";
  if (reasons.some((r) => HOLD_CODES.has(r.code))) return "HOLD";
  return reasons.some((r) => r.code === "VERIFIED_MATCH") ? "PAY" : "HOLD";
}

const ORDER: PayeeReasonCode[] = [...BLOCK_CODES, ...HOLD_CODES, "VERIFIED_MATCH"];
const sortReasons = (rs: PayeeReason[]): PayeeReason[] => [...rs].sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));

async function dep<T>(name: "registry" | "history", p: () => Promise<T>): Promise<T> {
  try {
    return await p();
  } catch (e) {
    throw new PayeeDependencyError(name, e);
  }
}

/** Signals never throw out of the engine: any provider failure becomes SIGNALS_UNAVAILABLE. */
async function safeSignals(deps: CheckDeps, account: ParsedAccount): Promise<ChainSignals> {
  try {
    return await deps.signals.getSignals(account);
  } catch {
    return account.namespace === "near" ? UNAVAILABLE_SIGNALS : { ...UNAVAILABLE_SIGNALS, supported: false };
  }
}

const isPending = (status: string, activatesAt: string | null, now: number): boolean =>
  status === "pending" || (activatesAt !== null && Date.parse(activatesAt) > now);

function signalReasons(id: string, s: ChainSignals): PayeeReason[] {
  const cfg = PAYEE_CHECK_CONFIG;
  if (!s.supported) return [];
  if (s.accountExists === false) return [{ code: "ACCOUNT_MISSING", detail: `${id} does not exist on chain, so a payment to it would fail or be lost.` }];
  const out: PayeeReason[] = [];
  const missing = (
    [
      ["account state", s.accountExists],
      ["account age", s.ageDays],
      ["recent full-access keys", s.fullAccessKeysAddedLast7d],
      ["recent code changes", s.codeChangedLast7d],
    ] as const
  )
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missing.length > 0) out.push({ code: "SIGNALS_UNAVAILABLE", detail: `On-chain signals could not be read (${missing.join(", ")}), so the account's recent history is unknown.` });
  if (s.ageDays !== null && s.ageDays < cfg.newAccountDays)
    out.push({ code: "NEW_ACCOUNT", detail: `${id} was created ${s.ageDays.toFixed(1)} days ago, under the ${cfg.newAccountDays} day threshold.` });
  if (s.fullAccessKeysAddedLast7d !== null && s.fullAccessKeysAddedLast7d > 0)
    out.push({
      code: "RECENT_FULL_ACCESS_KEY",
      detail: `${s.fullAccessKeysAddedLast7d} full-access key${s.fullAccessKeysAddedLast7d === 1 ? " was" : "s were"} added to ${id} in the last ${cfg.recentWindowDays} days, a common sign of account takeover.`,
    });
  if (s.codeChangedLast7d === true) out.push({ code: "RECENT_CODE_CHANGE", detail: `The contract code on ${id} changed in the last ${cfg.recentWindowDays} days.` });
  return out;
}

/**
 * Is this the right account for this payment? Deterministic: registry facts, string rules and
 * on-chain signals only. Malformed input throws AccountParseError or DomainParseError before
 * any check. Registry or history failures throw PayeeDependencyError. Signal failures never throw.
 */
export async function checkPayee(rawReq: PayeeCheckRequest, deps: CheckDeps): Promise<CheckOutcome> {
  const parsedReq = PayeeCheckRequest.safeParse(rawReq);
  if (!parsedReq.success) throw new AccountParseError(String((rawReq as { payee?: unknown })?.payee ?? ""), parsedReq.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const req = parsedReq.data;
  const opts = { defaultNearNetwork: deps.defaultNearNetwork ?? PAYEE_CHECK_CONFIG.defaultNearNetwork };
  const account = parseAccount(req.payee, opts);
  const payee = formatAccount(account);
  const claimedDomain = req.vendor?.domain !== undefined ? normalizeDomain(req.vendor.domain) : null;
  const now = deps.now();

  const reverse = await dep("registry", () => deps.registry.getVendorByAccount(payee));
  let vendor: PayeeVendor | null = null;
  if (claimedDomain !== null) vendor = await dep("registry", () => deps.registry.getVendor(claimedDomain));
  else vendor = reverse;
  const domain = claimedDomain ?? reverse?.domain ?? null;

  const reasons: PayeeReason[] = [];

  // Registry: is this account the claimed vendor's?
  if (domain === null) {
    reasons.push({ code: "NOT_IN_REGISTRY", detail: `${payee} is not registered to any verified vendor and no vendor domain was given.` });
  } else if (vendor === null) {
    reasons.push({ code: "NOT_IN_REGISTRY", detail: `${domain} has not verified any payout accounts with Redline.` });
  } else {
    const verified = await dep("registry", () => deps.registry.isVerifiedPayee(payee, vendor!.domain));
    const entries = vendor.accounts.map((a) => ({ ...a, parsed: tryParseAccount(a.account, opts) }));
    const entry = entries.find((a) => a.parsed && formatAccount(a.parsed) === payee);
    if (verified) {
      reasons.push({ code: "VERIFIED_MATCH", detail: `${payee} is a verified payout account of ${vendor.domain}.` });
    } else if (entry && isPending(entry.status, entry.activatesAt, now)) {
      reasons.push({
        code: "COOLING_OFF",
        detail: `${payee} was added to ${vendor.domain} recently and is in its cooling-off period${entry.activatesAt ? ` until ${entry.activatesAt}` : ""}.`,
      });
    } else {
      const sameAddressOtherChain = entries.some((a) => a.parsed && a.parsed.namespace === account.namespace && a.parsed.address === account.address && a.parsed.chainId !== account.chainId);
      const hasThisChain = entries.some((a) => a.parsed?.chainId === account.chainId);
      if (reverse !== null && reverse.domain !== vendor.domain)
        reasons.push({ code: "ACCOUNT_NOT_VENDORS", detail: `${payee} is registered to ${reverse.domain}, not ${vendor.domain}.` });
      else if (sameAddressOtherChain || !hasThisChain)
        reasons.push({ code: "CHAIN_NOT_VERIFIED", detail: `${vendor.domain} is verified, but has no verified payout account on ${account.chainId}${sameAddressOtherChain ? " (this address is verified for it on another chain)" : ""}.` });
      else
        reasons.push({ code: "ACCOUNT_NOT_VENDORS", detail: `${vendor.domain} has verified accounts on ${account.chainId}, and ${payee} is not one of them.` });
    }
  }

  // Look-alike: only for accounts nobody registered.
  let lookalikeOf: string | null = null;
  if (reverse === null) {
    const all = await dep("registry", () => deps.registry.listVendors());
    const hit = detectLookalike(account, verifiedEntries(all));
    if (hit) {
      lookalikeOf = hit.lookalikeOf;
      reasons.push({ code: "LOOKALIKE_ACCOUNT", detail: hit.detail });
    }
  }

  // Payee change against this payer's own history.
  if (req.payer !== undefined && domain !== null && deps.history) {
    const last = await dep("history", () => deps.history!.lastPaidAccount(req.payer!, domain));
    const lastNorm = last === null ? null : tryParseAccount(last, opts);
    if (last !== null && (lastNorm === null || formatAccount(lastNorm) !== payee))
      reasons.push({ code: "PAYEE_CHANGED", detail: `Last time this payer paid ${domain} at ${last}, not ${payee}.` });
  }

  const chain = await safeSignals(deps, account);
  reasons.push(...signalReasons(payee, chain));

  const sorted = sortReasons(reasons);
  return { verdict: verdictFor(sorted), payee, reasons: sorted, vendor, signals: { ...chain, lookalikeOf } };
}

/**
 * "Pay this domain on this chain": returns the verified account, so the caller never handles a
 * raw address. PAY only for an active account whose signals are clean.
 */
export async function resolvePayee(rawReq: PayeeResolveRequest, deps: CheckDeps): Promise<ResolveOutcome> {
  const parsedReq = PayeeResolveRequest.safeParse(rawReq);
  if (!parsedReq.success) throw new AccountParseError(String((rawReq as { chain?: unknown })?.chain ?? ""), parsedReq.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const domain = normalizeDomain(parsedReq.data.domain);
  const chain = parseChainId(parsedReq.data.chain).chainId;
  const now = deps.now();
  const opts = { defaultNearNetwork: deps.defaultNearNetwork ?? PAYEE_CHECK_CONFIG.defaultNearNetwork };

  const vendor = await dep("registry", () => deps.registry.getVendor(domain));
  const hold = (reasons: PayeeReason[]): ResolveOutcome => ({ verdict: verdictFor(reasons), domain, chain, account: null, reasons: sortReasons(reasons), vendor });
  if (!vendor) return hold([{ code: "NOT_IN_REGISTRY", detail: `${domain} has not verified any payout accounts with Redline.` }]);

  const resolved = await dep("registry", () => deps.registry.resolve(domain, chain));
  const onChain = vendor.accounts.filter((a) => tryParseAccount(a.account, opts)?.chainId === chain);
  if (!resolved) {
    const pending = onChain.find((a) => isPending(a.status, a.activatesAt, now));
    if (pending)
      return hold([{ code: "COOLING_OFF", detail: `${domain}'s account on ${chain} is in its cooling-off period${pending.activatesAt ? ` until ${pending.activatesAt}` : ""}.` }]);
    return hold([{ code: "CHAIN_NOT_VERIFIED", detail: `${domain} is verified, but has no active payout account on ${chain}.` }]);
  }

  const account = parseAccount(resolved, opts);
  const id = formatAccount(account);
  const signals = await safeSignals(deps, account);
  const extra = signalReasons(id, signals);
  const reasons = sortReasons([{ code: "VERIFIED_MATCH", detail: `${id} is ${domain}'s verified payout account on ${chain}.` }, ...extra]);
  const verdict = verdictFor(reasons);
  return { verdict, domain, chain, account: verdict === "PAY" ? id : null, reasons, vendor };
}
