import { createHash } from "node:crypto";
import type { PayeeReasonCode, PayeeVerdict } from "@redline/schemas";

/**
 * Ground truth comes from here, never from the model. Every case is a function of (seed, index),
 * so a longer run keeps the earlier cases unchanged and anyone can regenerate them.
 */

export const FAMILIES = [
  "bank_change_lookalike",
  "invoice_injection",
  "x402_payto_swap",
  "evm_address_poisoning",
  "legit_recurring",
  "legit_new_account",
  "adversarial",
] as const;
export type Family = (typeof FAMILIES)[number];
/** Families 1 to 6, written by the same team that wrote the engine's rules. */
export type WrittenFamily = Exclude<Family, "adversarial">;
/** Attacks the model invented: it picks the account and the pretext, the code still sets the verdict. */
export const ADVERSARIAL: Family = "adversarial";

export const ATTACK_FAMILIES: readonly Family[] = ["bank_change_lookalike", "invoice_injection", "x402_payto_swap", "evm_address_poisoning"];
export const LEGIT_FAMILIES: readonly Family[] = ["legit_recurring", "legit_new_account"];

export const NEAR_CHAIN = "near:testnet";
export const EVM_CHAIN = "eip155:84532";
export type Chain = typeof NEAR_CHAIN | typeof EVM_CHAIN;

/** How the paying agent names the vendor when it asks Redline. */
export type Claim = "domain" | "name" | "none";

export type LookalikeStrategy =
  | "confusable"
  | "typo_swap"
  | "typo_drop"
  | "typo_double"
  | "suffix_word"
  | "prefix_word"
  | "abbreviation"
  | "poisoned_hex";

export interface CaseParams {
  id: string;
  index: number;
  family: Family;
  vendor: { name: string; domain: string; contact: string };
  payer: { company: string; contact: string; account: string };
  chain: Chain;
  /** The vendor's real accounts, linked to its domain in the registry. */
  vendorAccounts: { near: string; evm: string };
  /** The account the email, invoice or offer asks to be paid. */
  payee: string;
  /** The vendor's real account on the payee's chain. */
  realAccount: string;
  /** Attacker account, or null for the legit families. */
  attackerAccount: string | null;
  lookalike: LookalikeStrategy | null;
  /** Age of the payee account in days, used for NEAR signals. */
  payeeAgeDays: number;
  /** Legit new account: hours since it was linked. Under 72, so it is still cooling off. */
  newAccountHoursAgo: number | null;
  claim: Claim;
  amount: { display: string; atomic: string; asset: "USDC" };
  invoiceNumber: string;
  /** reasonCode is null where the attack is the model's own and no single reason is expected. */
  expected: { verdicts: PayeeVerdict[]; reasonCode: PayeeReasonCode | null };
}

class Rand {
  private counter = 0;
  constructor(private readonly seed: string) {}
  next(): number {
    const digest = createHash("sha256").update(`${this.seed}:${this.counter++}`).digest();
    return digest.readUInt32BE(0) / 2 ** 32;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }
  hex(length: number): string {
    let out = "";
    while (out.length < length) out += createHash("sha256").update(`${this.seed}:hex:${this.counter++}`).digest("hex");
    return out.slice(0, length);
  }
}

// Invented words. Every company lives under the reserved .example TLD, so none can be a real business.
const NAME_FIRST = ["Alder", "Brindle", "Cobalt", "Dunmore", "Elmstead", "Fennick", "Galloway", "Harrow", "Ivybridge", "Juniper", "Kestrel", "Larchmont", "Marlow", "Netherby", "Oakhurst", "Pembury", "Quillon", "Rowan", "Stanmere", "Thornbury", "Upwell", "Valebrook", "Wexcombe", "Yarrow"];
const NAME_SECOND = ["Supply", "Logistics", "Analytics", "Legal", "Print", "Facilities", "Cloud", "Payroll", "Media", "Freight", "Catering", "Security"];
const PEOPLE_FIRST = ["Maya", "Tomas", "Priya", "Jonah", "Lena", "Omar", "Hana", "Felix", "Ines", "Rafael", "Sofia", "Devan"];
const PEOPLE_LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Brennan", "Castell", "Varga", "Holm", "Adeyemi", "Rossi", "Kowal", "Ferro"];
const PAYERS = ["Bramblecote Studio", "Corvane Labs", "Driftmoor Retail", "Eastgate Clinics", "Fallowfield Games", "Greywater Robotics"];
const SUFFIX_WORDS = ["billing", "payments", "ap", "invoices", "finance", "pay"];
const PREFIX_WORDS = ["pay", "billing", "secure", "ap"];
const ATTACKER_WORDS = ["settle", "remit", "ledger", "vault", "clear", "swift", "fund", "transfer"];

/** Family mix for any prefix of the case list: attack families twice as often as each legit one. */
const FAMILY_CYCLE: readonly Family[] = [
  "bank_change_lookalike",
  "invoice_injection",
  "x402_payto_swap",
  "evm_address_poisoning",
  "legit_recurring",
  "bank_change_lookalike",
  "invoice_injection",
  "x402_payto_swap",
  "evm_address_poisoning",
  "legit_new_account",
];

const CONFUSABLES: [RegExp, string][] = [
  [/o/, "0"],
  [/l/, "1"],
  [/i/, "1"],
  [/m/, "rn"],
  [/w/, "vv"],
  [/s/, "5"],
];

function nearLookalike(label: string, strategy: LookalikeStrategy, r: Rand, vendorName: string): string {
  switch (strategy) {
    case "confusable": {
      const options = CONFUSABLES.filter(([pattern]) => pattern.test(label));
      const [pattern, replacement] = options.length > 0 ? r.pick(options) : [/e/, "3"];
      return label.replace(pattern, replacement);
    }
    case "typo_swap": {
      const at = 1 + r.int(Math.max(1, label.length - 2));
      return label.slice(0, at) + (label[at + 1] ?? "") + (label[at] ?? "") + label.slice(at + 2);
    }
    case "typo_drop": {
      const at = 1 + r.int(Math.max(1, label.length - 2));
      return label.slice(0, at) + label.slice(at + 1);
    }
    case "typo_double": {
      const at = r.int(label.length);
      return label.slice(0, at + 1) + (label[at] ?? "") + label.slice(at + 1);
    }
    case "suffix_word":
      return `${label}-${r.pick(SUFFIX_WORDS)}`;
    case "prefix_word":
      return `${r.pick(PREFIX_WORDS)}-${label}`;
    case "abbreviation": {
      const initials = vendorName
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w[0])
        .join("");
      return `${initials}-${r.pick(SUFFIX_WORDS)}`;
    }
    default:
      return `${label}-${r.pick(SUFFIX_WORDS)}`;
  }
}

const NEAR_STRATEGIES: readonly LookalikeStrategy[] = ["confusable", "typo_swap", "typo_drop", "typo_double", "suffix_word", "prefix_word", "abbreviation"];

/** Same first 4 and last 4 hex characters, which is what wallets show. Middle is random. */
export function poisonedAddress(real: string, r: { hex(n: number): string }): string {
  let middle = r.hex(32);
  if (middle === real.slice(6, -4)) middle = middle.replace(/^./, (c) => (c === "a" ? "b" : "a"));
  return `0x${real.slice(2, 6)}${middle}${real.slice(-4)}`;
}

function expectedFor(family: Family, claim: Claim): CaseParams["expected"] {
  switch (family) {
    case "adversarial":
      // The invented account is never the verified one, so anything but PAY is right.
      return { verdicts: ["BLOCK", "HOLD"], reasonCode: null };
    case "bank_change_lookalike":
    case "x402_payto_swap":
    case "evm_address_poisoning":
      return { verdicts: ["BLOCK"], reasonCode: "LOOKALIKE_ACCOUNT" };
    case "invoice_injection":
      // An unrelated account: BLOCK when the vendor is named, HOLD when the agent names nobody.
      return claim === "none" ? { verdicts: ["HOLD", "BLOCK"], reasonCode: "NOT_IN_REGISTRY" } : { verdicts: ["BLOCK", "HOLD"], reasonCode: "ACCOUNT_NOT_VENDORS" };
    case "legit_recurring":
      return { verdicts: ["PAY"], reasonCode: "VERIFIED_MATCH" };
    case "legit_new_account":
      return { verdicts: ["HOLD"], reasonCode: "COOLING_OFF" };
  }
}

export function generateCase(seed: string, index: number, adversarial = false): CaseParams {
  const r = new Rand(adversarial ? `${seed}:adv:${index}` : `${seed}:${index}`);
  const family: Family = adversarial ? "adversarial" : (FAMILY_CYCLE[index % FAMILY_CYCLE.length] as Family);
  const name = `${r.pick(NAME_FIRST)} ${r.pick(NAME_SECOND)}`;
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const label = `${slug.replace(/-/g, "")}${r.int(90) + 10}`;
  const vendorAccounts = { near: `${NEAR_CHAIN}:${label}.testnet`, evm: `${EVM_CHAIN}:0x${r.hex(40)}` };

  const chain: Chain =
    family === "adversarial" ? (r.next() < 0.6 ? NEAR_CHAIN : EVM_CHAIN) : family === "bank_change_lookalike" ? NEAR_CHAIN : family === "x402_payto_swap" || family === "evm_address_poisoning" ? EVM_CHAIN : r.next() < 0.5 ? NEAR_CHAIN : EVM_CHAIN;
  const realAccount = chain === NEAR_CHAIN ? vendorAccounts.near : vendorAccounts.evm;

  let payee = realAccount;
  let attackerAccount: string | null = null;
  let lookalike: LookalikeStrategy | null = null;
  let newAccountHoursAgo: number | null = null;
  let payeeAgeDays = 200 + r.int(1500);

  if (family === "bank_change_lookalike") {
    lookalike = r.pick(NEAR_STRATEGIES);
    let fake = nearLookalike(label, lookalike, r, name);
    if (fake === label) {
      // A swap of two equal letters changes nothing, so use a suffix instead.
      lookalike = "suffix_word";
      fake = nearLookalike(label, lookalike, r, name);
    }
    attackerAccount = `${NEAR_CHAIN}:${fake}.testnet`;
  } else if (family === "x402_payto_swap" || family === "evm_address_poisoning") {
    lookalike = "poisoned_hex";
    attackerAccount = `${EVM_CHAIN}:${poisonedAddress(realAccount.split(":")[2] ?? "", r)}`;
  } else if (family === "invoice_injection") {
    attackerAccount = chain === NEAR_CHAIN ? `${NEAR_CHAIN}:${r.pick(ATTACKER_WORDS)}-${r.hex(6)}.testnet` : `${EVM_CHAIN}:0x${r.hex(40)}`;
  } else if (family === "legit_new_account") {
    newAccountHoursAgo = 2 + r.int(60);
    payeeAgeDays = 20 + r.int(300);
    payee = chain === NEAR_CHAIN ? `${NEAR_CHAIN}:${label}-treasury.testnet` : `${EVM_CHAIN}:0x${r.hex(40)}`;
  }
  if (attackerAccount) {
    payee = attackerAccount;
    payeeAgeDays = r.int(30);
  }
  if (family === "adversarial") {
    // The model supplies the account later. Until then the payee is empty.
    payee = "";
    payeeAgeDays = r.int(30);
  }

  // x402 takes the vendor from the request host. Elsewhere the agent may name the vendor by domain, by name or not at all.
  const roll = r.next();
  const claim: Claim = family === "x402_payto_swap" ? "domain" : roll < 0.6 ? "domain" : roll < 0.85 ? "name" : "none";
  const cents = 12_000 + r.int(980_000);
  const person = () => `${r.pick(PEOPLE_FIRST)} ${r.pick(PEOPLE_LAST)}`;
  const payerCompany = r.pick(PAYERS);

  return {
    id: `${adversarial ? "adv" : "rt"}_${String(index).padStart(4, "0")}`,
    index,
    family,
    vendor: { name, domain: `${slug}.example`, contact: person() },
    payer: { company: payerCompany, contact: person(), account: `${payerCompany.toLowerCase().replace(/\s+/g, "")}.testnet` },
    chain,
    vendorAccounts,
    payee,
    realAccount,
    attackerAccount,
    lookalike,
    payeeAgeDays,
    newAccountHoursAgo,
    claim,
    amount: { display: (cents / 100).toFixed(2), atomic: String(cents * 10_000), asset: "USDC" },
    invoiceNumber: `INV-${10_000 + r.int(90_000)}`,
    expected: expectedFor(family, claim),
  };
}

export const generateCases = (seed: string, count: number): CaseParams[] => Array.from({ length: count }, (_, i) => generateCase(seed, i));
export const generateAdversarialCases = (seed: string, count: number): CaseParams[] => Array.from({ length: count }, (_, i) => generateCase(seed, i, true));
