/**
 * The Mutual on NEAR testnet, signed by the member's own wallet through NEAR Connect. Every action is a
 * real transaction to the pool contract (or to the USDC contract, with the pool as receiver). No signed
 * message, and nothing goes through the API's pool: the API reads the chain afterwards like anyone.
 *
 * Everything that needs the network (balances, storage registration, WARD before) is read by
 * planDeposit before the click, so the click goes straight to the wallet and its window is not blocked.
 */
import { apiGet } from "../api/client";
import type { MutualAction, PoolPosition } from "../api/ai";
import { POOL_CONTRACT } from "../config";
import { sendTransactions, type FunctionCall, type SentTransaction } from "../wallets/near";
import { ftBalance, spendableNear, storageBalance, view } from "./chain";

const TGAS = 1_000_000_000_000n;
/** NEP-145 registration on the pool, for WARD. storage_balance_bounds says 0.00125 NEAR. */
export const STORAGE_DEPOSIT = "1250000000000000000000";
/** About what a deposit costs in gas and storage, with room to spare. Below this we stop before signing. */
export const MIN_NEAR_FOR_FEES = 50_000_000_000_000_000_000_000n; // 0.05 NEAR
/** The same msg the local test signer sends: an empty one mints WARD for the sender. */
export const DEPOSIT_MSG = "";

/** A check that failed before anything was signed. code feeds <Problem>; have and need are for the hint. */
export class PreflightError extends Error {
  constructor(
    readonly code: "INSUFFICIENT_USDC" | "INSUFFICIENT_NEAR",
    message: string,
    readonly have: string,
    readonly need: string,
  ) {
    super(message);
  }
}

let contracts: Promise<{ pool: string; token: string }> | null = null;
/** The pool and the USDC contract, from the API (GET /v1/pool), which reads them from its config. */
export function poolContracts(): Promise<{ pool: string; token: string }> {
  contracts ??= apiGet<{ contract: string; token: string }>("/v1/pool").then((v) => ({ pool: v.contract || POOL_CONTRACT, token: v.token }));
  contracts.catch(() => {
    contracts = null;
  });
  return contracts;
}

export interface DepositPlan {
  account: string;
  amount: string;
  usdc: bigint;
  near: bigint;
  wardBefore: bigint;
  registered: boolean;
  calls: FunctionCall[];
  /** The first check that failed, or null when the wallet can sign. */
  problem: PreflightError | null;
}

/** Reads balances and registration and builds the transactions. Run it before the click. */
export async function planDeposit(account: string, amount: string): Promise<DepositPlan> {
  const { pool, token } = await poolContracts();
  const [usdc, near, wardBefore, storage] = await Promise.all([ftBalance(token, account).catch(() => 0n), spendableNear(account), ftBalance(pool, account).catch(() => 0n), storageBalance(pool, account)]);
  const registered = storage !== null;
  const calls: FunctionCall[] = [];
  if (!registered) calls.push({ receiverId: pool, methodName: "storage_deposit", args: { account_id: account, registration_only: true }, gas: (10n * TGAS).toString(), deposit: STORAGE_DEPOSIT });
  calls.push({ receiverId: token, methodName: "ft_transfer_call", args: { receiver_id: pool, amount, msg: DEPOSIT_MSG }, gas: (100n * TGAS).toString(), deposit: "1" });
  const need = BigInt(amount);
  const problem =
    usdc < need ? new PreflightError("INSUFFICIENT_USDC", "Not enough USDC in this wallet for that deposit.", usdc.toString(), amount)
    : near < MIN_NEAR_FOR_FEES ? new PreflightError("INSUFFICIENT_NEAR", "You need about 0.05 NEAR for network fees.", near.toString(), MIN_NEAR_FOR_FEES.toString())
    : null;
  return { account, amount, usdc, near, wardBefore, registered, calls, problem };
}

export interface WalletPoolResult {
  action: string;
  tx: string;
  ward?: string | undefined;
  usdc?: string | undefined;
  id?: string | undefined;
  available_at?: string | undefined;
  position?: PoolPosition | undefined;
  proposal?: { id: number } | undefined;
}

/** The pool writes times as "<nanoseconds>ns" or as nanoseconds. */
const nsToIso = (t: unknown): string | undefined => {
  const s = String(t ?? "");
  const m = /^(\d+)(ns)?$/.exec(s);
  return m ? new Date(Number(BigInt(m[1]!) / 1_000_000n)).toISOString() : s || undefined;
};

const position = (pool: string, account: string) => view<PoolPosition>(pool, "get_position", { account }).catch(() => undefined);

/**
 * Sends the planned deposit from the wallet, then reads WARD again: what the member received is the
 * difference, read from the chain. If the pool kept no USDC, says so.
 */
export async function sendDeposit(plan: DepositPlan): Promise<WalletPoolResult> {
  if (plan.problem) throw plan.problem;
  const { pool } = await poolContracts();
  const sent = await sendTransactions(plan.account, plan.calls);
  const transfer = sent[sent.length - 1]!;
  // ft_transfer_call returns the USDC the receiver kept.
  if (transfer.value !== null && String(transfer.value) === "0") throw Object.assign(new Error("The pool returned your USDC, so no WARD was minted."), { tx: transfer.hash });
  const wardAfter = await ftBalance(pool, plan.account);
  return { action: "deposit", tx: transfer.hash, ward: (wardAfter - plan.wardBefore).toString(), position: await position(pool, plan.account) };
}

export type WalletPoolAction =
  | { action: "withdraw"; amount: string }
  | { action: "redeem"; id: string }
  | { action: "vote"; id: number; support: "for" | "against" }
  | { action: "propose"; description: string; proposal: MutualAction }
  | { action: "execute"; id: number };

/** The pool call for each action: the same methods and arguments as the local test signer. */
export function poolCall(pool: string, account: string, a: WalletPoolAction): FunctionCall {
  const call = (methodName: string, args: object): FunctionCall => ({ receiverId: pool, methodName, args, gas: (50n * TGAS).toString(), deposit: "0" });
  switch (a.action) {
    case "withdraw":
      return call("request_redeem", { amount: a.amount });
    case "redeem":
      return { ...call("redeem", { account, id: a.id }), gas: (100n * TGAS).toString() };
    case "vote":
      return call("vote", { id: a.id, support: a.support });
    case "propose":
      return call("propose", { description: a.description, action: a.proposal });
    case "execute":
      return call("execute", { id: a.id });
  }
}

/** Vote, redeem, propose and execute: one real transaction from the wallet. */
export async function sendPoolAction(account: string, a: WalletPoolAction): Promise<WalletPoolResult> {
  const { pool } = await poolContracts();
  const [sent] = (await sendTransactions(account, [poolCall(pool, account, a)])) as [SentTransaction];
  const value = (sent.value ?? {}) as Record<string, unknown>;
  const base: WalletPoolResult = { action: a.action, tx: sent.hash };
  if (a.action === "withdraw") return { ...base, id: String(value.id ?? ""), available_at: nsToIso(value.available_at), position: await position(pool, account) };
  if (a.action === "redeem") return { ...base, usdc: String(value.usdc ?? "0"), position: await position(pool, account) };
  if (a.action === "propose") return { ...base, proposal: { id: typeof sent.value === "number" ? sent.value : Number(value.id ?? 0) } };
  if (a.action === "vote" || a.action === "execute") return { ...base, proposal: { id: a.id } };
  return base;
}
