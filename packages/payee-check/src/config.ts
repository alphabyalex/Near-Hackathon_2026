/** Every threshold the engine and signals use, in one place. */
export const PAYEE_CHECK_CONFIG = {
  /** NEW_ACCOUNT fires when the account is younger than this. */
  newAccountDays: 30,
  /** Window for RECENT_FULL_ACCESS_KEY and RECENT_CODE_CHANGE. */
  recentWindowDays: 7,
  defaultNearNetwork: "testnet",

  rpc: {
    timeoutMs: 8_000,
    /** Retries after the first attempt, on network errors, timeouts and HTTP 5xx only. */
    retries: 1,
    /** Starting guess for NEAR block time. Calibrated against real block timestamps on each window lookup. */
    nearBlockTimeSecondsGuess: 1.0,
    /** If a historical height has no block (skipped height), try this many neighbours. */
    skippedHeightProbes: 3,
    /** Lowest height the creation search starts from: genesis of each network. */
    genesisHeight: { testnet: 42_376_888, mainnet: 9_820_210, sandbox: 0, localnet: 0 } as Record<string, number>,
  },

  cache: {
    /** Creation block never changes. */
    creationTtlMs: Number.POSITIVE_INFINITY,
    /** Keys, code hash, current account state and the 7-day-ago height. */
    recentTtlMs: 10 * 60 * 1000,
    lruMaxEntries: 2_000,
  },

  lookalike: {
    nearEditDistance: 2,
    evmEditDistance: 3,
    prefixChars: 4,
    suffixChars: 4,
    /** Vendor name tokens shorter than this are ignored by the bait-word rule. */
    minTokenLength: 3,
    /** Names shorter than this are ignored by the edit-distance rule (too many false hits). */
    minNameLengthForEditDistance: 5,
    baitWords: [
      "billing",
      "pay",
      "payment",
      "payments",
      "invoice",
      "invoices",
      "finance",
      "ap",
      "accounts",
      "support",
      "official",
      "secure",
      "team",
      "hq",
      "new",
    ],
  },
} as const;

export type PayeeCheckConfig = typeof PAYEE_CHECK_CONFIG;
