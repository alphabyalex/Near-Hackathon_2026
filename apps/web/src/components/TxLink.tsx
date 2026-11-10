import { TX } from "../brand";
import { NEAR_NETWORK } from "../config";

/** A NEAR transaction hash: base58, 43 or 44 characters. Simulated ids ("sim-...") are not. */
export const isTxHash = (hash: string | null | undefined): hash is string => typeof hash === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash);

export const explorerUrl = (hash: string): string => `https://${NEAR_NETWORK === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${hash}`;

/**
 * A quiet "View transaction" link to NearBlocks when the row came from a chain transaction. A simulated
 * id has nowhere to link to, so it is a short label (full id on hover), never mistaken for a chain hash.
 */
export function TxLink({ hash, plain = true }: { hash: string | null | undefined; plain?: boolean }) {
  if (!hash) return null;
  const id: string = hash;
  if (!isTxHash(hash)) return plain ? <span className="tx-id" title={id}>{TX.simulated(id.slice(-8))}</span> : null;
  return (
    <a className="tx-link" href={explorerUrl(hash)} target="_blank" rel="noreferrer" title={hash} aria-label={TX.label(hash)}>
      {TX.view}
    </a>
  );
}
