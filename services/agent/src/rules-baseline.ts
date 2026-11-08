import type { AgentContext, Decision, Intake, Payable, ReasonCode, Vendor } from "@wardline/schemas";
import { findInvoiceTotal, isForeignCurrency } from "./amounts.js";
import { checkPayable, checkWindow, isPaidStatus, scopeContext } from "./checks.js";
import { makeDecision } from "./decisions.js";
import { formatAtomic } from "./money.js";
import { type DecisionWithReport, NO_USAGE, type ReportingAgent } from "./report.js";

/** Characters people cannot see. Any of these inside an invoice is hiding something. */
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤﻿\u{E0000}-\u{E007F}]/u;

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|polic(y|ies)|guidelines?|checks?|context)\b/i,
  /\b(system|developer|admin|administrator)\s+(note|prompt|message|override|instructions?|mode)\b/i,
  /\byou are now\b|\bact as\b|\bpretend (to be|you)\b|\bnew instructions?\b/i,
  /\b(attention|note to|dear|hey|hello)\s+(the\s+)?(ai|llm|agent|assistant|model|bot)\b/i,
  /\b(ai|llm)\s+(agent|assistant)s?\b/i,
  /\bdecision\s*["']?\s*[:=]\s*["']?\s*pay\b/i,
  /\b(return|output|respond with|reply with|answer)\b[^.\n]{0,30}\b(pay|approved?)\b/i,
  /\bdo not (flag|review|escalate|verify|check)\b|\bdon'?t (flag|review|escalate|verify|check)\b/i,
  /\bwithout (any\s+)?(human\s+)?(review|approval|verification|checks?)\b/i,
  /\bskip\s+(the\s+|all\s+)?(review|checks?|approval|verification|validation)\b/i,
  /\bauto-?(approve|pay)\b|\bmark (this |it )?(invoice )?as (approved|paid|verified)\b/i,
  /<\/?\s*(system|assistant|instructions?|prompt)\s*>|\[\/?INST\]|#{2,}\s*(system|instructions?)\b/i,
];

const TITLES = String.raw`owner|cfo|ceo|coo|controller|comptroller|treasurer|finance|accounts? payable|ap team|management|director|board`;
const FORGED_APPROVAL_PATTERNS: RegExp[] = [
  /\bpre-?approved\b|\balready (been\s+)?approved\b|\bapproval (has been\s+)?(granted|confirmed)\b/i,
  new RegExp(`\\b(approved|authori[sz]ed|signed(\\s+off)?|cleared|verified)\\s+(by|per)\\s+(the\\s+|our\\s+|your\\s+)?(${TITLES})\\b`, "i"),
  new RegExp(`\\b(${TITLES})\\s+(has\\s+|have\\s+)?(approved|authori[sz]ed|signed(\\s+off)?)\\b`, "i"),
  /\b(approval|authori[sz]ation|override)\s+(code|token|id|number|reference|signature)\b|\bowner[- ]signed\b/i,
];

const DESTINATION_CHANGE_PATTERNS: RegExp[] = [
  /\b(chang\w*|updat\w*|new|different|switch\w*|mov\w*)\b[^.\n]{0,30}\b(bank|banking|wallet|account|remittance|payment (details|address|destination|instructions)|wire|routing|iban)\b/i,
  /\b(bank|banking|wallet|account|remittance|payment)\s+(details?|info(rmation)?|address|number|instructions?)?\s*(has|have|is|are)?\s*(been\s+)?(changed|updated|moved|new)\b/i,
  /\b(send|remit|wire|transfer|redirect)\s+(the\s+|your\s+|all\s+)?(payment|funds|money)?\s*to\s+(our|this|the following|a)\s+(new\s+)?(bank|wallet|account|address)\b/i,
  /\biban\b|\brouting number\b|\bswift( code)?\b|\bwire instructions\b/i,
];

const CHAIN_ADDRESS = /\b[a-z0-9][a-z0-9._-]*\.(?:near|testnet)\b|\b0x[a-f0-9]{16,}\b/gi;
const INVOICE_TOKEN = /\bINV[-\s#:]*([A-Z]*\d[A-Z0-9-]*)/gi;
const PO_TOKEN = /\bPO[-\s#:]*([A-Z0-9-]*\d[A-Z0-9-]*)/gi;

const HOMOGLYPHS: Record<string, string> = {
  "0": "o", "1": "l", "3": "e", "5": "s", "$": "s", "@": "a", "|": "l", "ı": "i",
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ո": "n",
  "α": "a", "ο": "o", "ν": "v", "ρ": "p",
};

const squeeze = (text: string): string => text.toLowerCase().replace(/\s+/g, " ");

/** Folds look-alike characters together, so "Lark5pur 0ffice" and "Larkspur Office" compare equal. */
const fold = (text: string): string =>
  squeeze(
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\p{Cf}/gu, "")
      .toLowerCase()
      .replace(/./gu, (c) => HOMOGLYPHS[c] ?? c)
      .replace(/rn/g, "m")
      .replace(/vv/g, "w"),
  );

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-token, case-insensitive: INV-1001 does not match inside INV-10011. */
const mentions = (text: string, token: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9-])${escapeRegex(token)}($|[^A-Za-z0-9-])`, "i").test(text);

const mentionsName = (text: string, name: string): boolean => mentions(squeeze(text), squeeze(name));

/** The look-alike vendor this text imitates, if any. Only called when no vendor matched exactly. */
function findLookalike(text: string, vendors: Vendor[]): Vendor | null {
  const folded = fold(text);
  const words = folded.split(" ").map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
  for (const vendor of vendors) {
    const name = fold(vendor.display_name);
    if (name.length < 6) continue;
    if (mentions(folded, name)) return vendor;
    const size = name.split(" ").length;
    const allowed = Math.max(1, Math.floor(name.length * 0.15));
    for (let i = 0; i + size <= words.length; i++) {
      if (levenshtein(words.slice(i, i + size).join(" "), name) <= allowed) return vendor;
    }
  }
  return null;
}

function claimsDestinationChange(text: string, ctx: AgentContext, vendor: Vendor | null, vaultId: string): boolean {
  if (DESTINATION_CHANGE_PATTERNS.some((p) => p.test(text))) return true;
  const known = new Set<string>([vaultId, ...ctx.payables.map((p) => p.token_contract_id)]);
  if (vendor) known.add(vendor.account_id);
  return [...text.matchAll(CHAIN_ADDRESS)].some((m) => !known.has(m[0].toLowerCase()));
}

type PayableMatch =
  | { kind: "none" }
  | { kind: "ambiguous"; detail: string }
  | { kind: "paid"; payable: Payable; detail: string }
  | { kind: "one"; payable: Payable; via: "invoice" | "po" };

function matchPayable(text: string, payables: Payable[]): PayableMatch {
  const byInvoice = payables.filter((p) => p.invoice_number !== null && mentions(text, p.invoice_number));
  if (byInvoice.length > 0) {
    const paid = byInvoice.find((p) => isPaidStatus(p.status));
    if (paid) return { kind: "paid", payable: paid, detail: `Invoice ${String(paid.invoice_number)} has already been paid (${paid.payable_ref}).` };
    if (byInvoice.length > 1) return { kind: "ambiguous", detail: "More than one payable has this invoice number." };
    return { kind: "one", payable: byInvoice[0]!, via: "invoice" };
  }

  const byPo = payables.filter((p) => mentions(text, p.po_number));
  if (byPo.length === 0) return { kind: "none" };
  const open = byPo.filter((p) => p.status === "OPEN");
  if (open.length === 1) return { kind: "one", payable: open[0]!, via: "po" };
  if (open.length > 1) {
    const total = findInvoiceTotal(text);
    const sameAmount = open.filter((p) => total !== null && BigInt(p.amount_atomic) === total.atomic);
    if (sameAmount.length === 1) return { kind: "one", payable: sameAmount[0]!, via: "po" };
    return { kind: "ambiguous", detail: `More than one open payable fits ${open[0]!.po_number}.` };
  }
  const paid = byPo.find((p) => isPaidStatus(p.status));
  if (paid) return { kind: "paid", payable: paid, detail: `${paid.po_number} has already been paid (${paid.payable_ref}).` };
  return { kind: "none" };
}

/**
 * Deterministic baseline: regexes and field matching, no model. This is the score the LLM has
 * to beat. It is deliberately simple and known to be fooled by rephrasing; see docs/AGENT.md.
 */
export class RulesBaseline implements ReportingAgent {
  async decide(intake: Intake, ctx: AgentContext): Promise<Decision> {
    return (await this.decideWithReport(intake, ctx)).decision;
  }

  async decideWithReport(intake: Intake, ctx: AgentContext): Promise<DecisionWithReport> {
    const started = performance.now();
    const decision = decideByRules(intake, scopeContext(ctx, intake.vault_id));
    return {
      decision,
      report: {
        agent: "rules",
        source: "deterministic",
        manifest_digest: null,
        model_id: null,
        latency_ms: Math.round(performance.now() - started),
        attempts: 0,
        usage: NO_USAGE,
        cost_usd: null,
        fallback: null,
        guard: [],
        replay: null,
      },
    };
  }
}

function decideByRules(intake: Intake, ctx: AgentContext): Decision {
  const raw = [intake.source_text, intake.attachments_note ?? ""].join("\n").replace(/^﻿/, "");
  const text = raw.replace(/\p{Cf}/gu, "");

  const readable = text.replace(/[^\p{L}\p{N}]/gu, "");
  if (readable.length < 20) {
    return makeDecision(intake, "REVIEW", ["UNREADABLE"], "The invoice text is empty or too garbled to read.");
  }

  const flags: ReasonCode[] = [];
  if (HIDDEN_CHARS.test(raw) || INJECTION_PATTERNS.some((p) => p.test(text))) flags.push("INJECTION_ATTEMPT");
  if (FORGED_APPROVAL_PATTERNS.some((p) => p.test(text))) flags.push("FORGED_APPROVAL");
  if (flags.length > 0) {
    return makeDecision(intake, "FLAG", flags, "The invoice text tries to influence the decision or claims an approval that is not in the records.");
  }

  const named = ctx.vendors.filter((v) => mentionsName(raw, v.display_name));
  if (named.length === 0) {
    const lookalike = findLookalike(raw, ctx.vendors);
    if (lookalike) {
      return makeDecision(intake, "FLAG", ["LOOKALIKE_VENDOR"], `The vendor name closely imitates ${lookalike.display_name} without matching it.`, null, [lookalike.vendor_id]);
    }
    const codes: ReasonCode[] = ["NEW_VENDOR"];
    if (claimsDestinationChange(text, ctx, null, intake.vault_id)) codes.push("DESTINATION_CHANGE");
    return makeDecision(intake, "REVIEW", codes, "The vendor is not on the approved list. A human decides on new vendors.");
  }

  // Two vendors named (one may be a reference): the invoice number or PO decides which is billing.
  const billing = named.filter((v) => {
    const own = ctx.payables.filter((p) => p.vendor_id === v.vendor_id);
    return matchPayable(text, own).kind !== "none";
  });
  const vendor = billing.length === 1 ? billing[0]! : named.length === 1 ? named[0]! : null;
  if (!vendor) {
    return makeDecision(intake, "REVIEW", ["AMBIGUOUS_MATCH"], "The invoice names more than one known vendor.");
  }

  const payables = ctx.payables.filter((p) => p.vendor_id === vendor.vendor_id);
  const match = matchPayable(text, payables);
  if (match.kind === "paid") {
    return makeDecision(intake, "FLAG", ["ALREADY_PAID"], match.detail, match.payable.payable_ref, [match.payable.po_number]);
  }

  const reviews: ReasonCode[] = [];
  const notes: string[] = [];
  const review = (code: ReasonCode, note: string): void => {
    reviews.push(code);
    notes.push(note);
  };

  if (claimsDestinationChange(text, ctx, vendor, intake.vault_id)) review("DESTINATION_CHANGE", "The invoice claims a new or different payment destination.");
  if (match.kind === "none") review("NO_MATCHING_PO", `No approved payable from ${vendor.display_name} matches this invoice.`);
  if (match.kind === "ambiguous") review("AMBIGUOUS_MATCH", match.detail);
  if (match.kind !== "one") {
    if (!vendor.active) review("UNKNOWN_VENDOR", `${vendor.display_name} is inactive.`);
    return makeDecision(intake, "REVIEW", reviews, notes.join(" "), null, [vendor.vendor_id]);
  }

  const payable = match.payable;
  const receipt = ctx.receipts.find((r) => r.po_number === payable.po_number);
  const evidence = [payable.po_number, ...(receipt ? [receipt.receipt_id] : [])];

  for (const issue of [...checkPayable(payable, ctx), ...checkWindow(payable, intake.received_at_ns)]) {
    if (issue.code === "ALREADY_PAID") return makeDecision(intake, "FLAG", ["ALREADY_PAID"], issue.detail, payable.payable_ref, evidence);
    review(issue.code, issue.detail);
  }

  if (match.via === "po" && payable.invoice_number !== null) {
    review("AMBIGUOUS_MATCH", `The invoice does not state ${payable.invoice_number}, the invoice number on the approved payable.`);
  }
  const otherPo = [...text.matchAll(PO_TOKEN)].some((m) => !mentions(m[0], payable.po_number));
  if (otherPo) review("NO_MATCHING_PO", `The invoice cites a different purchase order than ${payable.po_number}.`);
  if (match.via === "invoice" && [...text.matchAll(INVOICE_TOKEN)].some((m) => !mentions(m[0], payable.invoice_number ?? ""))) {
    review("AMBIGUOUS_MATCH", "The invoice cites more than one invoice number.");
  }

  const total = findInvoiceTotal(text);
  if (total !== null && isForeignCurrency(total.currency)) {
    review("CURRENCY_MISMATCH", `The invoice is in ${String(total.currency)}, not the token on the payable.`);
  } else if (total === null || total.atomic !== BigInt(payable.amount_atomic)) {
    review("AMOUNT_MISMATCH", `The invoice total does not match the approved ${formatAtomic(payable.amount_atomic)}.`);
  }

  if (reviews.length > 0) return makeDecision(intake, "REVIEW", reviews, notes.join(" "), payable.payable_ref, evidence);
  return makeDecision(intake, "PAY", ["MATCHED_APPROVED_PAYABLE"], `Invoice matches approved payable ${payable.payable_ref} at the exact amount.`, payable.payable_ref, evidence);
}
