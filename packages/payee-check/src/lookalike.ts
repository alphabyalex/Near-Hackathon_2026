import type { PayeeVendor } from "@redline/schemas";
import { tryParseAccount, type ParsedAccount } from "./caip.js";
import { PAYEE_CHECK_CONFIG } from "./config.js";

export type LookalikeRule =
  | "SAME_NAME_OTHER_PARENT"
  | "CONFUSABLE"
  | "BAIT_WORD"
  | "EDIT_DISTANCE"
  | "PREFIX_SUFFIX_MATCH";

export interface LookalikeHit {
  /** Vendor domain being imitated. */
  lookalikeOf: string;
  /** The verified account it resembles. */
  resembles: string;
  rule: LookalikeRule;
  /** One sentence for humans. */
  detail: string;
}

export interface VerifiedEntry {
  account: ParsedAccount;
  domain: string;
  vendorName: string;
}

/** Flattens vendors into parsed accounts (active and pending both count as theirs). */
export function verifiedEntries(vendors: PayeeVendor[]): VerifiedEntry[] {
  const out: VerifiedEntry[] = [];
  for (const v of vendors)
    for (const a of v.accounts) {
      const p = tryParseAccount(a.account);
      if (p) out.push({ account: p, domain: v.domain, vendorName: v.name });
    }
  return out;
}

export function editDistance(a: string, b: string, cap = Number.POSITIVE_INFINITY): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const NEAR_TLDS = new Set(["near", "testnet", "tg"]);

/** The account's own name: leftmost label, after removing top-level suffixes. "northwind-billing.near" -> "northwind-billing". */
export function nearOwnName(id: string): string {
  const labels = id.toLowerCase().split(".");
  while (labels.length > 1 && NEAR_TLDS.has(labels[labels.length - 1]!)) labels.pop();
  return labels[0] ?? id;
}

export function nearParent(id: string): string {
  const i = id.indexOf(".");
  return i === -1 ? "" : id.slice(i + 1);
}

/** Visual skeleton: 0->o, 1/i->l, rn->m, vv->w, separators dropped. Two names with the same skeleton look alike. */
export function skeleton(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_.]/g, "")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/[1i]/g, "l");
}

const isHexId = (s: string): boolean => /^(0x)?[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(s);

function prefixSuffixMatch(a: string, b: string, cfg = PAYEE_CHECK_CONFIG.lookalike): boolean {
  return a !== b && a.slice(0, cfg.prefixChars) === b.slice(0, cfg.prefixChars) && a.slice(-cfg.suffixChars) === b.slice(-cfg.suffixChars);
}

/** Name tokens that identify a vendor: its account own-names and its domain's first label. */
function vendorTokens(entries: VerifiedEntry[], domain: string): string[] {
  const tokens = new Set<string>();
  const add = (s: string) => {
    for (const t of s.toLowerCase().split(/[-_.]/)) if (t.length >= PAYEE_CHECK_CONFIG.lookalike.minTokenLength) tokens.add(t);
  };
  add(domain.split(".")[0] ?? "");
  for (const e of entries) if (e.domain === domain && e.account.namespace === "near" && !isHexId(e.account.address)) add(nearOwnName(e.account.address));
  return [...tokens];
}

function nearBait(name: string, token: string): boolean {
  const bait = PAYEE_CHECK_CONFIG.lookalike.baitWords as readonly string[];
  const parts = name.split(/[-_.]/);
  if (parts.includes(token) && parts.some((p) => p !== token && bait.includes(p))) return true;
  const compact = name.replace(/[-_.]/g, "");
  if (!compact.includes(token) || compact === token) return false;
  const rest = compact.replace(token, "");
  return bait.includes(rest);
}

function detectNear(acct: ParsedAccount, entries: VerifiedEntry[]): LookalikeHit | null {
  const cfg = PAYEE_CHECK_CONFIG.lookalike;
  const id = acct.address;
  // Same network only: a testnet name resembling a mainnet one is not a useful signal.
  const near = entries.filter((e) => e.account.namespace === "near" && e.account.reference === acct.reference && e.account.address !== id);

  // Hex implicit accounts are addresses, not names: use the poisoning rule.
  if (isHexId(id)) {
    for (const e of near)
      if (isHexId(e.account.address) && prefixSuffixMatch(id.replace(/^0x/, ""), e.account.address.replace(/^0x/, "")))
        return hit(e, "PREFIX_SUFFIX_MATCH", `${id} shares its first ${cfg.prefixChars} and last ${cfg.suffixChars} characters with ${e.domain}'s verified account ${e.account.address}, a common address-poisoning pattern.`);
    return null;
  }

  const name = nearOwnName(id);
  const named = near.filter((e) => !isHexId(e.account.address));
  for (const e of named) {
    const other = e.account.address;
    if (nearOwnName(other) === name && nearParent(other) !== nearParent(id) && !id.endsWith(`.${other}`))
      return hit(e, "SAME_NAME_OTHER_PARENT", `${id} uses the same name as ${e.domain}'s verified account ${other} under a different parent.`);
  }
  for (const e of named) {
    const otherName = nearOwnName(e.account.address);
    if (otherName !== name && skeleton(otherName) === skeleton(name))
      return hit(e, "CONFUSABLE", `${id} differs from ${e.domain}'s verified account ${e.account.address} only by look-alike characters (such as 0 for o, 1 for l, rn for m).`);
  }
  for (const domain of new Set(named.map((e) => e.domain))) {
    const e = named.find((x) => x.domain === domain)!;
    for (const token of vendorTokens(entries, domain))
      if (nearBait(name, token))
        return hit(e, "BAIT_WORD", `${id} combines ${e.vendorName}'s name "${token}" with a payment word, but is not one of ${domain}'s verified accounts.`);
  }
  if (name.length >= cfg.minNameLengthForEditDistance)
    for (const e of named) {
      const otherName = nearOwnName(e.account.address);
      const d = editDistance(name, otherName, cfg.nearEditDistance);
      if (otherName !== name && d <= cfg.nearEditDistance)
        return hit(e, "EDIT_DISTANCE", `${id} is ${d} character edit${d === 1 ? "" : "s"} away from ${e.domain}'s verified account ${e.account.address}.`);
    }
  return null;
}

function detectEvm(acct: ParsedAccount, entries: VerifiedEntry[]): LookalikeHit | null {
  const cfg = PAYEE_CHECK_CONFIG.lookalike;
  const a = acct.address.slice(2);
  // Address poisoning works across chains, so compare against verified EVM addresses on every EVM chain.
  const evm = entries.filter((e) => e.account.namespace === "eip155" && e.account.address !== acct.address);
  for (const e of evm)
    if (prefixSuffixMatch(a, e.account.address.slice(2)))
      return hit(e, "PREFIX_SUFFIX_MATCH", `${acct.address} shares its first ${cfg.prefixChars} and last ${cfg.suffixChars} hex characters with ${e.domain}'s verified address ${e.account.address}, the address-poisoning pattern.`);
  for (const e of evm) {
    const d = editDistance(a, e.account.address.slice(2), cfg.evmEditDistance);
    if (d <= cfg.evmEditDistance)
      return hit(e, "EDIT_DISTANCE", `${acct.address} is ${d} character edit${d === 1 ? "" : "s"} away from ${e.domain}'s verified address ${e.account.address}.`);
  }
  return null;
}

function detectSolana(acct: ParsedAccount, entries: VerifiedEntry[]): LookalikeHit | null {
  const cfg = PAYEE_CHECK_CONFIG.lookalike;
  for (const e of entries)
    if (e.account.namespace === "solana" && prefixSuffixMatch(acct.address, e.account.address))
      return hit(e, "PREFIX_SUFFIX_MATCH", `${acct.address} shares its first ${cfg.prefixChars} and last ${cfg.suffixChars} characters with ${e.domain}'s verified address ${e.account.address}, the address-poisoning pattern.`);
  return null;
}

function hit(e: VerifiedEntry, rule: LookalikeRule, detail: string): LookalikeHit {
  return { lookalikeOf: e.domain, resembles: e.account.address, rule, detail };
}

/**
 * Returns a hit if the account imitates a verified account and is not itself verified for anyone.
 * Deterministic and offline: it only compares strings against the registry's account list.
 */
export function detectLookalike(account: ParsedAccount, entries: VerifiedEntry[]): LookalikeHit | null {
  const exact = entries.some((e) => e.account.namespace === account.namespace && e.account.address === account.address);
  if (exact) return null;
  switch (account.namespace) {
    case "near":
      return detectNear(account, entries);
    case "eip155":
      return detectEvm(account, entries);
    case "solana":
      return detectSolana(account, entries);
  }
}
