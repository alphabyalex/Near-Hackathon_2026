/**
 * All money is Circle's USDC on NEAR. The token account is one config value: WARDLINE_USDC_ACCOUNT,
 * testnet by default. Set it to USDC_MAINNET to switch networks.
 */

import { readEnv } from "./legacy-env.js";

export const USDC_TESTNET = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
export const USDC_MAINNET = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export const USDC = { symbol: "USDC", decimals: 6 } as const;

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

/** The USDC token contract for this deployment. */
export const usdcAccount = (env: Env = processEnv()): string => readEnv("WARDLINE_USDC_ACCOUNT", env) ?? USDC_TESTNET;

/** The token every payable, budget and pool uses. */
export const usdcToken = (env: Env = processEnv()) => ({ ...USDC, contract_id: usdcAccount(env) });
