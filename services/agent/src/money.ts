import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "./agent-config.js";

const UNIT = 10n ** BigInt(TOKEN_DECIMALS);

/** "1250000000" becomes "1,250.00 USDC". Shown to the model so it never does atomic-unit math. */
export function formatAtomic(atomic: string): string {
  const value = BigInt(atomic);
  const whole = (value / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (value % UNIT).toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${fraction} ${TOKEN_SYMBOL}`;
}

/** "1,250.00" becomes 1250000000n. Returns null if it has more precision than the token. */
export function decimalToAtomic(decimal: string): bigint | null {
  const [whole = "0", fraction = ""] = decimal.replace(/,/g, "").split(".");
  if (fraction.length > TOKEN_DECIMALS && !/^0*$/.test(fraction.slice(TOKEN_DECIMALS))) return null;
  return BigInt(whole) * UNIT + BigInt(fraction.slice(0, TOKEN_DECIMALS).padEnd(TOKEN_DECIMALS, "0"));
}

/** Nanosecond timestamp string to ISO 8601, shown to the model. */
export const nsToIso = (ns: string): string => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
