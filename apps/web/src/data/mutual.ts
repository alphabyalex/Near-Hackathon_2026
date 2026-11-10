/** The Mutual: summary, positions, votes and every wallet-signed request. */
import { executeProposal as postExecute, getMutual as fetchMutual, getPosition as fetchPosition, getVoteWeight as fetchWeight, poolChallenge, poolSubmit, type PoolRequest } from "../api/ai";
import { apiGet } from "../api/client";
import { API_BASE, LOCAL_SIGNER } from "../config";
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
  if (walletId === "local-signer") return localSigner(body);
  const ch = await poolChallenge(body);
  let signed;
  try {
    signed = await signNep413(walletId, { message: ch.message, recipient: ch.recipient, nonce: fromBase64(ch.nonce) }, body.account);
  } catch (error) {
    throw walletError(error);
  }
  return poolSubmit({ nonce: ch.nonce, publicKey: signed.publicKey, signature: signed.signature });
}

type LocalAction = PoolRequest | { account: string; action: "execute"; id: number };
type LocalResult = Awaited<ReturnType<typeof poolSubmit>> & { tx: string; explorer_url: string };

/**
 * The local test signer (dev server only): the local API sends the transaction as a testnet cast
 * account. Same result shape as a wallet-signed request, plus the transaction hash.
 */
async function localSigner(body: LocalAction): Promise<LocalResult> {
  if (!LOCAL_SIGNER) throw new Error("The local test signer is off in this build.");
  if (body.action === "propose") throw new Error("Open proposals from the batch or a wallet; the local test signer votes, executes, joins and redeems.");
  const res = await fetch(`${API_BASE}/v1/local-signer/mutual`, { method: "POST", headers: { "content-type": "application/json", "x-wardline-local-signer": "1" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as LocalResult & { message?: string };
  if (!res.ok) throw new Error(json.message ?? `The local test signer answered HTTP ${res.status}.`);
  return json;
}

/** The accounts the local test signer can act as. Empty when it is off. */
export async function localSignerAccounts(): Promise<string[]> {
  if (!LOCAL_SIGNER) return [];
  return (await apiGet<{ accounts: string[] }>("/v1/local-signer")).accounts;
}

/**
 * Executes a passed proposal. Through the local test signer when that is the connected wallet (on
 * testnet anyone executes on the pool contract); otherwise the API's own route (sim mode).
 */
export async function executeAs(connected: { account: string; wallet: NearWalletId } | null, id: number) {
  if (connected?.wallet === "local-signer") return localSigner({ account: connected.account, action: "execute", id });
  return postExecute(id);
}
