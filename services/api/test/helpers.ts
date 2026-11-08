import type { OwnerAuthConfig } from "../src/auth.js";

/** Owner auth switched off, as on a localhost-only dashboard. For tests of the flows behind it. */
export const LOCAL_AUTH: OwnerAuthConfig = {
  enabled: false,
  owners: new Set(),
  approvers: new Set(),
  sessionTtlMs: 30 * 60_000,
  secureCookie: false,
  network: "testnet",
  keyCallsPerDay: 10_000,
};

export const authWith = (overrides: Partial<OwnerAuthConfig>): OwnerAuthConfig => ({ ...LOCAL_AUTH, enabled: true, ...overrides });
