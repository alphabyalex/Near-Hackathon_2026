/**
 * Product name, tagline and every line of marketing copy. A rebrand is a change to this file only.
 * Rules: short, specific lines. No em dashes. Never claim legal ownership: we verify control of an
 * account and its link to a domain, at a stated trust level.
 */

import type { EvidenceTier } from "@wardline/schemas";
import repo from "../../../repo.config.json";

const NAME = "Wardline";

export const BRAND = {
  name: NAME,
  tagline: "Payment authority for AI agents.",
  metaDescription: "Your agent can read every invoice. It can never choose where the money goes.",
  homeLabel: `${NAME} home`,
  /** Source repository. Lives in repo.config.json at the root; the GitHub rename to "wardline" is a one-line change there. */
  repoUrl: repo.url,
} as const;

export const NAV = [
  { page: "try", label: "Try it" },
  { page: "demo", label: "Demo" },
  { page: "connect", label: "Connect" },
  { page: "verify", label: "Verify" },
  { page: "about", label: "About" },
] as const;

export const FOOTER = {
  owner: "Owner sign-in",
  vault: "The vault",
  llms: "llms.txt",
} as const;

export const HOME = {
  heroLead: "Your agent can read every invoice.",
  heroRest: "It can never choose where the money goes",
  sub: `Pay a business by its website name. ${BRAND.name} returns the account that site linked and checks it before money moves.`,
  primary: "See a scam get blocked",
  secondary: "Try a check",
  featuresLabel: "What it does",
  features: [
    ["Pay by reference", `Pay northwind.example, not a pasted address. ${BRAND.name} resolves the account the domain linked.`],
    ["Payee Proof", "Each account signs for itself and is listed by its domain. Every answer states its trust level."],
    ["Vendor change control", "A new payout account waits out a cooldown and needs a second person's signature."],
    ["Release Guard", "Payments are bound to the tested agent's manifest digest. A changed agent cannot release funds."],
    ["x402 guard", "Wraps your x402 client. A swapped payTo is stopped before anything is signed."],
    ["Private mode", "Direct mode runs every check in your own process. Your payee list never leaves it."],
  ],
  resultsLabel: "Red-team results",
  resultsTitle: "Scam payees, thrown at the checks.",
} as const;

export const TRY = {
  label: "Try it",
  title: "Check a payee before you pay.",
  lede: "Live answers from the API, with a signed receipt you can verify here in your browser.",
  resolveTab: "Resolve a domain",
  checkTab: "Check an address",
  domain: "Vendor domain",
  chain: "Chain",
  address: "Payout address",
  addressHint: "CAIP-10 or a bare NEAR account",
  vendorDomain: "Vendor domain (optional)",
  resolveButton: "Resolve",
  checkButton: "Check",
  examples: "Examples",
} as const;

export const RESULT = {
  verdicts: {
    PAY: "Safe to pay.",
    HOLD: "Hold. Send it to a person.",
    BLOCK: "Do not pay.",
  },
  reasons: "Why",
  receipt: "Signed receipt",
  verify: "Verify signature",
  verifying: "Checking",
  verified: "Signature valid. Signed by the key published at /.well-known/wardline-attestor.json.",
  notVerified: "Signature does not match the published key. Treat this answer as unsigned.",
  noReceipt: "No receipt. Treat this answer as unsigned.",
  account: "Account",
} as const;

export const TIERS: Record<EvidenceTier, { short: string; verified: string; notEstablished: string }> = {
  T0_NONE: { short: "Not verified", verified: "Nothing for this vendor and account.", notEstablished: "Anything." },
  T1_WALLET_CONTROL: { short: "Wallet control", verified: "The account signed our challenge, so someone holds its key.", notEstablished: "Any link to the vendor or its domain." },
  T2_DOMAIN_LINKED: {
    short: "Domain linked",
    verified: "The account signed for itself, and the vendor's domain serves a file listing it.",
    notEstablished: "Legal ownership. Whoever controls both the website and the key can link an account.",
  },
  T3_RELATIONSHIP: {
    short: "Your relationship",
    verified: "Domain linked, and your owner approved this account or you paid it before.",
    notEstablished: "That the approval or earlier payment was right. It is your own history.",
  },
  T4_EXTERNAL_KYB: { short: "External KYB", verified: "Reserved for an outside business-verification provider.", notEstablished: "Never issued today." },
};

export const DEMO = {
  label: "Demo",
  title: "Four ways money gets misdirected.",
  lede: "Each scene replays the attack, then asks the live API.",
  run: "Run",
  replay: "Replay",
  scenes: {
    bank: {
      name: "Bank details changed",
      line: "An email swaps in a look-alike NEAR account.",
      steps: [
        "Email from billing@northwind.example: our bank details changed.",
        "New payout account in the email: northw1nd.testnet",
        `The agent extracts the payee and asks ${BRAND.name} before paying.`,
      ],
    },
    x402: {
      name: "Swapped x402 offer",
      line: "A paid API answers 402 with someone else's payTo.",
      steps: [
        "The agent calls a paid endpoint on fernhill.example.",
        "The 402 offer names a payTo that Fernhill never linked.",
        "The x402 guard checks payTo against fernhill.example before signing.",
      ],
    },
    poison: {
      name: "Address poisoning",
      line: "A near-identical EVM address planted in the wallet history.",
      steps: [
        "A tiny transfer lands from an address that starts and ends like Larkspur's.",
        "The agent copies the address from recent history.",
        `${BRAND.name} compares it with the accounts larkspur.example linked.`,
      ],
    },
    resolve: {
      name: "Pay by name",
      line: "The agent is told to pay northwind.example.",
      steps: [
        "Instruction: pay northwind.example for invoice 55187.",
        `The agent never handles an address. It asks ${BRAND.name} to resolve the domain.`,
        `${BRAND.name} returns the account Northwind linked, with a signed receipt.`,
      ],
    },
  },
  comparisonLabel: "First payment to a vendor",
  comparisonTitle: `No record of the vendor yet. The agent alone, then with ${BRAND.name}.`,
  agentAlone: "AI agent alone",
  withWardline: `AI agent with ${BRAND.name}`,
  scamsThrough: "scams paid",
  onFileNote: "When the agent already had the vendor's account on file:",
} as const;

export const CONNECT = {
  label: "Connect",
  title: `Put ${BRAND.name} in front of every payment.`,
  lede: "MCP for agents, HTTP for anything, the SDK for TypeScript.",
  unsetTitle: "Set your API URL",
  unsetBody: "These snippets use $WARDLINE_API_URL until the site is built with VITE_WARDLINE_API_URL.",
  unsetMcp: "Set VITE_WARDLINE_MCP_URL to show your MCP endpoint here.",
  mcp: "MCP server",
  mcpLine: "Streamable HTTP. Tools: resolve_payee, check_payee, get_vendor, how_to_verify.",
  resolve: "Resolve a domain",
  check: "Check an address",
  sdkHosted: "SDK, hosted",
  sdkDirect: "SDK, direct",
  sdkDirectLine: "Runs every check in your process. Nothing is sent to us.",
  x402: "x402 guard",
  llms: "For agents that read docs",
  llmsLine: "Everything above, as plain text.",
  copy: "Copy",
  copied: "Copied",
} as const;

export const VERIFY = {
  label: "Verify your business",
  title: "Link your payout accounts to your domain.",
  lede: "Each wallet signs for itself. Your website lists them. Payers see the trust level that reached.",
  steps: ["Business", "Wallets", "Host the file", "Check"],
  domain: "Your domain",
  displayName: "Display name",
  next: "Next",
  back: "Back",
  near: "NEAR",
  evm: "EVM",
  solana: "Solana",
  nearAccount: "NEAR account",
  connectSign: "Connect and sign",
  signedCount: (n: number) => (n === 1 ? "1 account signed" : `${n} accounts signed`),
  remove: "Remove",
  download: "Download wardline-payee.json",
  hostTitle: "Host it at",
  hostRules: ["Serve it over HTTPS as application/json.", "No redirects. The file must be at this exact path.", "Signatures are valid for a year. Re-sign to add or remove accounts."],
  checkButton: "Check my domain",
  fetches: `${BRAND.name} fetches`,
  fetchesRest: "and verifies every signature in it.",
  reached: "Trust level reached",
  pendingNote: "A new account on a domain that is already linked waits out a cooldown before anyone can pay it.",
} as const;

export const ABOUT = {
  label: "About",
  title: `Agents can pay bills. ${BRAND.name} decides where the money may go.`,
  flow: [
    ["Invoice", "Arrives as untrusted text."],
    ["Agent", "PAY, REVIEW or FLAG."],
    ["Payee check", "Account against the domain."],
    ["Vault", "Checks every limit."],
    ["Settled", "Or queued for you."],
  ],
  exampleLabel: "A real decision",
  trustLabel: "Trust levels",
  trustTitle: "What each level verifies, and what it does not.",
  trustNote: "PAY needs at least domain linked. An email from the same domain is never extra evidence.",
  pieces: [
    ["Payee Proof", "Accounts that signed for themselves, listed by their domain."],
    ["Vault", "One NEAR contract per business. One-method agent key."],
    ["Evidence", "Who tested which agent version, on which suite, with what result."],
  ],
} as const;

export const OWNER = {
  signInTitle: "Sign in",
  signInLede: "Owners and approvers sign a one-time challenge with their NEAR wallet.",
  account: "NEAR account",
  chooseWallet: "Choose a wallet",
  signing: "Waiting for your wallet",
  signOut: "Sign out",
  tabs: {
    overview: "Overview",
    invoices: "Invoices",
    review: "Review Desk",
    keys: "API keys",
    evaluation: "Evaluation",
    controls: "Controls",
  },
} as const;

export const DESK = {
  title: "Review Desk",
  lede: "Holds and vendor account changes. Each approval is signed by your wallet.",
  empty: "Nothing waiting.",
  endpointChange: "Vendor account change",
  payeeHold: "Payee on hold",
  oldAccount: "Paid today",
  newAccount: "Requested",
  noPrevious: "No earlier account",
  cooldown: "Cooldown",
  cooldownOver: "Cooldown over",
  atStake: "At stake",
  payables: "Payables",
  requestedBy: "Requested by",
  approve: "Approve and sign",
  reject: "Reject",
  signHint: "Your wallet signs the vault, vendor, revision, account and a 5 minute expiry.",
  decidedTitle: "Decided",
  decidedEmpty: "No decisions yet.",
} as const;

export const KEYS = {
  title: "API keys",
  lede: "One payer per key. Give agents check-only keys. Record from the system that settles payments.",
  payer: "Payer",
  label: "Label",
  scope: "Scope",
  checkOnly: "Check only",
  checkRecord: "Check and record",
  create: "Create key",
  once: "Copy this key now. Only its hash is kept.",
  revoke: "Revoke",
  revoked: "Revoked",
  empty: "No keys yet.",
} as const;
