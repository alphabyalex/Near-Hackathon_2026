/**
 * The wallets the picker shows, in order, with their official logos (bundled in public/wallets, from
 * each wallet's NEAR Connect manifest icon, never recolored or redrawn).
 *
 * Only wallets that sign in and send transactions on NEAR testnet through NEAR Connect are listed.
 * Left out, with the reason (see docs/status/alexander.md, A14):
 * - HOT Wallet: its executor refuses testnet ("HOT Wallet not supported on testnet").
 * - MyNearWallet: on testnet its executor opens testnet.mynearwallet.com, which its manifest doesn't
 *   allow, so NEAR Connect answers "Permission denied".
 * - Unity Wallet and WalletConnect: NEAR Connect drops both unless it is given a WalletConnect client,
 *   which needs a Reown project id. None is configured.
 * - Never shown: NEAR Mobile, NEAR CLI, OKX, Hana, Trezu, Ethereum wallets, Phantom, MetaMask.
 */

declare global {
  interface Window {
    meteorCom?: unknown;
    meteorComV2?: unknown;
    nightly?: { near?: unknown };
  }
}

export interface WalletInfo {
  /** NEAR Connect manifest id: a click connects to exactly this wallet, with no selection modal. */
  id: string;
  name: string;
  logo: string;
  /** "main" is the grid; "more" sits under More wallets, collapsed. */
  group: "main" | "more";
  /** Has a phone app, so it comes first on phones. */
  mobileApp: boolean;
  /** Its browser extension is in this browser. */
  installed?: () => boolean;
}

export const WALLETS: readonly WalletInfo[] = [
  { id: "meteor-wallet", name: "Meteor", logo: "/wallets/meteor.svg", group: "main", mobileApp: true, installed: () => typeof window !== "undefined" && Boolean(window.meteorCom || window.meteorComV2) },
  { id: "intear-wallet", name: "Intear", logo: "/wallets/intear.svg", group: "main", mobileApp: false },
  { id: "nightly-wallet", name: "Nightly", logo: "/wallets/nightly.png", group: "main", mobileApp: false, installed: () => typeof window !== "undefined" && Boolean(window.nightly?.near) },
  { id: "ledger", name: "Ledger", logo: "/wallets/ledger.svg", group: "more", mobileApp: false },
];

/** Manifest ids the picker must never offer, whatever NEAR Connect's manifest says. */
export const NEVER_SHOWN = ["near-mobile", "near-cli", "okx-wallet", "hana-wallet", "trezu-wallet", "ethereum-wallets", "hot-wallet", "mynearwallet", "unity-wallet", "wallet-connect"] as const;

/** Where a new member creates a wallet: Meteor's and Intear's own sign-up pages. */
export const SIGN_UP = [
  { name: "Meteor", href: "https://wallet.meteorwallet.app" },
  { name: "Intear", href: "https://wallet.intear.tech" },
] as const;

export interface Ordering {
  /** Ids whose extension is installed in this browser. */
  installed: ReadonlySet<string>;
  /** A phone or a touch-first screen. */
  mobile: boolean;
}

/** Installed wallets first; on phones, wallets with a phone app next. Otherwise the catalog order. */
export function orderWallets(list: readonly WalletInfo[], o: Ordering): WalletInfo[] {
  const rank = (w: WalletInfo) => (o.installed.has(w.id) ? 0 : o.mobile && w.mobileApp ? 1 : 2);
  return list.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).map((x) => x.w);
}

export function installedIds(list: readonly WalletInfo[] = WALLETS): Set<string> {
  return new Set(list.filter((w) => w.installed?.()).map((w) => w.id));
}

export const isMobile = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 600px), (pointer: coarse)").matches;

export const walletName = (id: string | undefined | null): string | null => WALLETS.find((w) => w.id === id)?.name ?? null;
