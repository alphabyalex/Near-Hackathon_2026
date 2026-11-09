import { TX } from "../brand";
import { NEAR_NETWORK } from "../config";

/** A NEAR transaction hash: base58, 43 or 44 characters. Simulated ids ("sim-...") are not. */
export const isTxHash = (hash: string | null | undefined): hash is string => typeof hash === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash);

export const explorerUrl = (hash: string): string => `https://${NEAR_NETWORK === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${hash}`;

/**
 * A quiet link to the transaction on NearBlocks when the row came from one. A simulated id is shown
 * as plain text, so it is never mistaken for a chain transaction.
 */
export function TxLink({ hash, plain = true }: { hash: string | null | undefined; plain?: boolean }) {
  if (!hash) return null;
  if (!isTxHash(hash)) return plain ? <span className="tx-id">{hash}</span> : null;
  return (
    <a className="tx-link" href={explorerUrl(hash)} target="_blank" rel="noreferrer" title={hash} aria-label={TX.label(hash)}>
      {TX.view}
    </a>
  );
}
