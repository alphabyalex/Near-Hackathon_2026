/** The docs' structure: the groups in the sidebar, in order, and the pages in each. A slug is the page's file name. */
export interface NavGroup {
  title: string;
  pages: readonly string[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { title: "Introduction", pages: ["introduction", "how-it-works", "glossary"] },
  { title: "The Mutual", pages: ["deposit-and-ward", "fees-and-yield", "loss-coverage", "redeem-and-sell-wait"] },
  { title: "Groups", pages: ["groups-and-budgets", "tiers-and-reputation"] },
  { title: "Governance", pages: ["governance"] },
  { title: "Build", pages: ["quickstart", "proof-headers-and-errors", "payee-checks", "sdk-and-x402", "mcp-server", "api-reference"] },
  { title: "Security", pages: ["spending-cap", "limits-and-risks", "contracts"] },
];

/** Every page in reading order: what Previous and Next walk. */
export const READING_ORDER: readonly string[] = NAV_GROUPS.flatMap((g) => g.pages);

export const groupOf = (slug: string): NavGroup | undefined => NAV_GROUPS.find((g) => g.pages.includes(slug));

/** The routes people start from, shown as cards on the docs home. */
export const START_HERE: readonly { slug: string; title: string; line: string }[] = [
  { slug: "quickstart", title: "Build with the gateway", line: "Point an OpenAI client at Wardline and pay only for answers that prove themselves." },
  { slug: "deposit-and-ward", title: "Back the Mutual", line: "Deposit USDC, hold WARD, and earn from every proven payment." },
  { slug: "groups-and-budgets", title: "Run a group", line: "Fund a shared AI budget, give each member an allowance, and build a record." },
  { slug: "payee-checks", title: "Check a payee", line: "Know who an account belongs to before your agent pays it." },
];
