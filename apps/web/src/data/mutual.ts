/** The Mutual: summary, positions, votes and every wallet-signed request. */
import { executeProposal as postExecute, getMutual as fetchMutual, getPosition as fetchPosition, getVoteWeight as fetchWeight, poolChallenge, poolSubmit, type PoolRequest } from "../api/ai";
import { apiGet } from "../api/client";
import { fromBase64, signNep413, type NearWalletId } from "../wallets/near";
import { walletError } from "./errors";

export type { MutualSummary, PoolPosition, PoolView, MutualProposalView, ClaimView, WardPricePoint } from "../api/ai";

export const getMutual = fetchMutual;
export const getPosition = fetchPosition;
export const getVoteWeight = fetchWeight;
export const executeProposal = postExecute;

export interface MemberVote {
  id: number;
  support: "for" | "against";
  weight: string;
}

export const getVotes = (account: string) => apiGet<{ account: string; votes: MemberVote[] }>(`/v1/mutual/votes/${encodeURIComponent(account)}`);

/**
 * Signs a Mutual request (deposit, redeem, vote, propose) with the account's own NEAR wallet. The
 * API refuses bad input before anything is signed; a wallet failure comes back as a WalletError.
 */
export async function signMutual(walletId: NearWalletId, body: PoolRequest) {
  const ch = await poolChallenge(body);
  let signed;
  try {
    signed = await signNep413(walletId, { message: ch.message, recipient: ch.recipient, nonce: fromBase64(ch.nonce) }, body.account);
  } catch (error) {
    throw walletError(error);
  }
  return poolSubmit({ nonce: ch.nonce, publicKey: signed.publicKey, signature: signed.signature });
}
