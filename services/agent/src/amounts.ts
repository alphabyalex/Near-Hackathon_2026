import { decimalToAtomic } from "./money.js";

/** Pulls the invoice total out of free text. Used by RulesBaseline only, never by the LLM harness. */
export interface InvoiceTotal {
  atomic: bigint;
  currency: string | null;
}

const CURRENCY = String.raw`REDL|USDC|USDT|USD|EUR|GBP|CAD|AUD|JPY|CHF|\$|€|£|¥`;
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const MONEY = new RegExp(`(?<![\\w.,-])(?:(${CURRENCY})\\s*)?(${NUMBER})(?![\\d-])(?:\\s*(${CURRENCY})(?![a-z]))?`, "gi");

const LABEL_GAP = String.raw`[^0-9\n]{0,24}$`;
const STRONG_LABEL = new RegExp(`(grand total|total due|amount due|balance due|total amount|amount payable|invoice total|please pay)${LABEL_GAP}`, "i");
const WEAK_LABEL = new RegExp(`(?<!sub[- ])\\b(total|amount)\\b${LABEL_GAP}`, "i");

/** Dollar-denominated labels are read as the REDL test token. Other currencies are a mismatch. */
const SAME_UNIT = new Set(["redl", "usd", "$"]);
export const isForeignCurrency = (currency: string | null): boolean => currency !== null && !SAME_UNIT.has(currency.toLowerCase());

/** Returns null when the text has no readable total, or conflicting ones. Callers treat that as a mismatch. */
export function findInvoiceTotal(text: string): InvoiceTotal | null {
  const strong: InvoiceTotal[] = [];
  const weak: InvoiceTotal[] = [];
  const unlabeled: InvoiceTotal[] = [];

  for (const match of text.matchAll(MONEY)) {
    const raw = match[2] ?? "";
    const currency = match[1] ?? match[3] ?? null;
    const atomic = decimalToAtomic(raw);
    if (atomic === null) continue;
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const before = text.slice(lineStart, match.index);
    const token = { atomic, currency };
    // "Total 25 cases" is a count, not money: an unmarked number needs a separator to count.
    const looksLikeMoney = currency !== null || /[.,]/.test(raw);
    if (STRONG_LABEL.test(before) && looksLikeMoney) strong.push(token);
    else if (WEAK_LABEL.test(before) && looksLikeMoney) weak.push(token);
    else if (currency !== null) unlabeled.push(token);
  }

  const single = (group: InvoiceTotal[]): InvoiceTotal | null => (new Set(group.map((t) => t.atomic)).size === 1 ? group[group.length - 1]! : null);
  if (strong.length > 0) return single(strong);
  if (weak.length > 0) return single(weak);
  // No labels at all: line items are smaller than the total, so the largest amount is the total.
  return unlabeled.reduce<InvoiceTotal | null>((max, t) => (max === null || t.atomic > max.atomic ? t : max), null);
}
