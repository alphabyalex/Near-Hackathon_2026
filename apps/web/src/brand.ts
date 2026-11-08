/**
 * Product name, tagline and every line of marketing copy. A rebrand is a change to this file only.
 * Rules: short, specific lines. No em dashes, no hype words. Never claim legal ownership: we verify
 * control of an account and its link to a domain, at a stated trust level. Never claim we prove token
 * counts: a TEE signature shows which attested model signed the exact response bytes. The pool is
 * protocol-backed coverage.
 */

import type { EvidenceTier } from "@wardline/schemas";
import repo from "../../../repo.config.json";

const NAME = "Wardline";

export const BRAND = {
  name: NAME,
  tagline: "AI that only pays on proof.",
  metaDescription: "AI that only pays on proof. The right party, for the model you actually got, up to what you allowed.",
  homeLabel: `${NAME} home`,
  /** Source repository. Lives in repo.config.json at the root; the GitHub rename to "wardline" is a one-line change there. */
  repoUrl: repo.url,
} as const;

export const NAV = [
  { page: "try", label: "Try it" },
  { page: "demo", label: "Demo" },
  { page: "mutual", label: "Mutual" },
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
  heroLead: "AI that only pays",
  heroRest: "on proof",
  sub: "The right party, for the model you actually got, up to what you allowed. And if we're wrong, the Mutual pays you back.",
  primary: "Watch it refuse a swapped model",
  secondary: "Plug in one line",
  featuresLabel: "What it does",
  features: [
    ["Proof of delivery", "A model call is paid only when NEAR AI's TEE signs that exact response for the model you asked for. Anything else is refunded."],
    ["Proof of payee", `Pay a business by its website name. ${NAME} returns the account that site linked, at a stated trust level.`],
    ["Hard cap", "Spending comes from a deposit, and each member has an allowance. A leaked key stops at its limit."],
    ["Wardline Mutual", "Protocol-backed coverage. If a Wardline approval was wrong, the pool pays you back, and our own stake pays first."],
    ["Social Money", "A group funds one AI budget from its Sputnik DAO or Trezu treasury, and votes on allowances and payouts."],
    ["One-line plug-in", `Change your OpenAI client's base URL. Every call is reserved, checked, then paid or refunded.`],
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
  title: "Five ways an AI bill goes wrong, and what happens instead.",
  lede: "Each scene runs the real gateway, payee check or pool code against simulated contracts and recorded NEAR AI traffic.",
  run: "Run",
  replay: "Replay",
  running: "Running",
  scenes: {
    plugin: {
      name: "One-line plug-in",
      line: "Point the OpenAI client at Wardline. Calls are paid with receipts.",
      steps: [
        "The app changes one line: baseURL becomes <wardline>/v1/ai.",
        "Each call reserves the most it can cost, then goes to NEAR AI byte for byte.",
        `NEAR AI's TEE signs model, request hash and response hash. ${NAME} checks it, then pays.`,
      ],
    },
    swap: {
      name: "Swapped model",
      line: "A provider says DeepSeek and serves something cheaper.",
      steps: [
        "cheapai takes a request for DeepSeek V4.1 Flash.",
        "It returns GLM-5.3 Flash's answer, with that model's real NEAR AI signature.",
        `The signature names the wrong model. ${NAME} pays nothing and refunds the hold.`,
      ],
    },
    leak: {
      name: "Leaked key",
      line: "A member's key leaks and gets hammered.",
      steps: [
        "40 requests arrive at once on ci-agent's key.",
        "Each must reserve its cost against that member's allowance first.",
        "A second leaked key runs into the budget's deposit, the hard cap.",
      ],
    },
    invoice: {
      name: "Bank details changed",
      line: "An email swaps in a look-alike NEAR account.",
      steps: [
        "Email from billing@northwind.example: our bank details changed.",
        "New payout account in the email: northw1nd.testnet",
        `The agent extracts the payee and asks ${NAME} before paying.`,
      ],
    },
    mutual: {
      name: "Wrong approval",
      line: `${NAME} said PAY, and it was wrong.`,
      steps: [
        `${NAME} answered PAY for brightwater-pay.testnet at domain linked.`,
        "brightwater.example reports its key was stolen before that answer.",
        "The claim is paid at once. Our first-loss stake takes the loss.",
      ],
    },
  },
  labels: {
    claimed: "Asked for",
    proven: "Signature names",
    noneProven: "No signature",
    paid: "Paid",
    refunded: "Refunded",
    reserved: "Held",
    settlement: "Settlement",
    refund: "Refund transaction",
    reply: "Reply",
    spentOf: (spent: string, cap: string) => `Spent ${spent} of ${cap} WUSD`,
    refusedCount: (n: number) => `${n} requests refused with 402`,
    burst: (paid: number, refused: number) => `${paid} paid, ${refused} refused`,
    junior: "First-loss (Wardline)",
    senior: "Senior LPs",
    before: "Before",
    after: "After",
    claim: "Claim",
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
  lede: "One base URL for AI calls. MCP for agents, HTTP for anything, the SDK for TypeScript.",
  unsetTitle: "Set your API URL",
  unsetBody: "These snippets use $WARDLINE_API_URL until the site is built with VITE_WARDLINE_API_URL.",
  unsetMcp: "Set VITE_WARDLINE_MCP_URL to show your MCP endpoint here.",
  openai: "OpenAI client, one line",
  openaiLine: "Use any OpenAI-compatible client with a meter key. Each call is paid only on a verified model signature, and every response carries X-Wardline-Proof.",
  openaiJs: "JavaScript",
  openaiPy: "Python",
  mcp: "MCP server",
  mcpLine: "Streamable HTTP. Tools: resolve_payee, check_payee, get_vendor, how_to_verify, get_ai_spend.",
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
    group: "Group",
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
  meterTitle: "Meter keys",
  meterLede: "One key per budget member, for the OpenAI-compatible gateway at /v1/ai. Only its hash is kept.",
  member: "Member",
  models: "Models",
  allModels: "All routed models",
  createMeter: "Create meter key",
} as const;

export const AI = {
  title: "AI spend",
  verified: "Verified calls",
  refused: "Refused and refunded",
  spent: "Spent",
  refunded: "Refunded",
  series: "Spend per day",
  seriesNote: "Verified calls only. Refused calls are refunded in full.",
  empty: "No metered calls yet. Create a meter key and point an OpenAI client at /v1/ai.",
} as const;

export const GROUP = {
  title: "Group",
  lede: "One shared AI budget, funded and governed by the group's DAO.",
  budget: "Shared AI budget",
  deposit: "Deposit (hard cap)",
  spent: "Spent",
  held: "Held for calls in flight",
  left: "Left",
  period: "Allowances reset each",
  dao: "Controlled by",
  members: "Members",
  allowance: "Allowance",
  used: "Used",
  calls: "Calls",
  callsEmpty: "No calls yet.",
  col: { time: "Time", member: "Member", claimed: "Model asked for", proven: "Model proven", result: "Result", amount: "Paid", refund: "Refunded" },
  verified: "verified",
  refused: "refused",
  failed: "failed",
  proposals: "DAO proposals",
  proposalsEmpty: "No proposals.",
  payouts: "Payouts awaiting vote",
  payoutsLede: "Every pending treasury transfer runs through the payee check before anyone votes.",
  payoutsEmpty: "No payouts waiting for a vote.",
  flagged: "Flagged",
  clear: "Payee checked",
  voteIn: "Vote in your DAO app.",
  models: "Attested models",
  modelsLede: "A call is paid only if its signer is attested for the model asked for.",
} as const;

export const POOL = {
  label: "Wardline Mutual",
  title: "If we approve the wrong payment, the pool pays you back.",
  lede: "Protocol-backed coverage, funded by LPs and by a fee on every proven call.",
  loseFirstTitle: "We lose first.",
  loseFirst: [
    "Every claim is paid from the first-loss tranche, our own stake, before any senior LP is touched.",
    "Senior LPs earn the coverage fee taken from each settled call.",
    "Claims above a set size wait for a vote of the pool's DAO. Smaller ones pay at once.",
  ],
  stats: {
    tvl: "Total value locked",
    junior: "First-loss (Wardline)",
    senior: "Senior (LPs)",
    sharePrice: "Senior share price",
    fees: "Fees earned",
    claims: "Claims paid",
    capacity: "Largest claim it can pay",
  },
  trancheLabel: "Who pays a claim first",
  deposit: "Deposit",
  withdraw: "Withdraw",
  account: "Your NEAR account",
  amount: "Amount (WUSD)",
  shares: "Shares",
  sign: "Sign with wallet",
  signing: "Waiting for your wallet",
  wait: (days: number) => `Withdrawals unlock ${days} days after you ask, so coverage cannot vanish during a claim.`,
  position: "Your position",
  noPosition: "No position yet.",
  pending: "Unlocks",
  claims: "Claims",
  claimsEmpty: "No claims yet.",
  col: { filed: "Filed", subject: "Approval", amount: "Amount", junior: "From first-loss", senior: "From senior", status: "Status" },
  modeSim: "Simulated pool. Deposits are signed by your wallet and applied to the simulation.",
} as const;
