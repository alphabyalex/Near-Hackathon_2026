import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, baseEncode, type Action, type KeyPairString, type Provider, type SignedTransaction } from "near-api-js";
import { TransactionRefusedError, VaultExecutionError, VaultOutcomeUnknownError } from "./errors.js";

export const GAS_PAYMENT = 100_000_000_000_000n;
export const GAS_ADMIN = 30_000_000_000_000n;
export const ONE_YOCTO = 1n;

const DEFAULT_FINAL_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface CallSpec {
  contract_id: string;
  method: string;
  args: object;
  deposit?: bigint;
  gas?: bigint;
}

export interface FinalOutcome {
  tx_hash: string;
  /** JSON-decoded final return value of the transaction, or null if it returned nothing. */
  value: unknown;
  /** Each receipt's executor and whether it failed, in execution order. */
  receipts: Array<{ executor_id: string; failed: boolean; logs: string[] }>;
  raw: unknown;
}

export interface SignerHandle {
  account_id: string;
  account: Account;
  public_key: string;
}

export interface TransportOptions {
  final_timeout_ms?: number | undefined;
  poll_interval_ms?: number | undefined;
}

export function makeProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider({ url: rpcUrl });
}

export function makeSigner(provider: Provider, accountId: string, privateKey: string): SignerHandle {
  const keyPair = KeyPair.fromString(privateKey as KeyPairString);
  const signer = new KeyPairSigner(keyPair);
  return {
    account_id: accountId,
    account: new Account(accountId, provider, signer),
    public_key: keyPair.getPublicKey().toString(),
  };
}

export async function viewCall<T>(provider: Provider, contractId: string, method: string, args: object = {}): Promise<T> {
  const result = await provider.callFunction({ contractId, method, args: args as Record<string, unknown>, blockQuery: { finality: "final" } });
  return result as T;
}

function decodeSuccessValue(value: string): unknown {
  if (value === "") return null;
  const text = Buffer.from(value, "base64").toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function panicCode(failure: unknown): string | null {
  const match = /E_[A-Z_]+/.exec(JSON.stringify(failure) ?? "");
  return match ? match[0] : null;
}

/** Turns a final RPC response into an outcome, or throws if the transaction's final status failed. */
export function readFinalOutcome(response: unknown): FinalOutcome {
  const outcome = response as {
    status: { SuccessValue?: string; Failure?: unknown };
    transaction: { hash: string };
    transaction_outcome?: { id: string };
    receipts_outcome?: Array<{
      outcome: { executor_id: string; logs: string[]; status: { Failure?: unknown } };
    }>;
  };
  const tx_hash = outcome.transaction.hash;
  const receipts = (outcome.receipts_outcome ?? []).map((receipt) => ({
    executor_id: receipt.outcome.executor_id,
    failed: receipt.outcome.status.Failure !== undefined,
    logs: receipt.outcome.logs,
  }));
  if (outcome.status.Failure !== undefined) {
    const code = panicCode(outcome.status.Failure);
    throw new VaultExecutionError(`Transaction ${tx_hash} failed: ${code ?? JSON.stringify(outcome.status.Failure)}`, tx_hash, code, outcome.status.Failure);
  }
  return {
    tx_hash,
    value: decodeSuccessValue(outcome.status.SuccessValue ?? ""),
    receipts,
    raw: response,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isFinal(response: unknown): boolean {
  const status = (response as { status?: { SuccessValue?: string; Failure?: unknown } }).status;
  return status !== undefined && (status.SuccessValue !== undefined || status.Failure !== undefined);
}

/**
 * Only errors that prove this exact transaction can never run. A key that does not permit the call is
 * the main case. Nonce and expiry errors are deliberately not here: a library or RPC retry of a
 * transaction that already landed reports a bad nonce, so those are not proof that nothing happened.
 */
const REFUSALS = [
  "ReceiverMismatch",
  "MethodNameMismatch",
  "DepositWithFunctionCall",
  "RequiresFullAccess",
  "AccessKeyNotFound",
  "NotEnoughAllowance",
  "InvalidSignature",
  "NotEnoughBalance",
  "LackBalanceForState",
];

export function refusalReason(error: unknown): string | null {
  const text = `${(error as { name?: string })?.name ?? ""} ${(error as Error)?.message ?? String(error)} ${JSON.stringify(error) ?? ""}`;
  return REFUSALS.find((reason) => text.includes(reason)) ?? null;
}

type Raced<T> = { kind: "value"; value: T } | { kind: "error"; error: unknown } | { kind: "deadline" };

/** Waits for `promise`, but never past `deadline`. A late result is dropped, never left unhandled. */
async function untilDeadline<T>(promise: Promise<T>, deadline: number): Promise<Raced<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Raced<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "deadline" }), Math.max(0, deadline - Date.now()));
  });
  const settled = promise.then(
    (value): Raced<T> => ({ kind: "value", value }),
    (error: unknown): Raced<T> => ({ kind: "error", error }),
  );
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return result;
}

/**
 * Signs one call, sends it, and returns only once the transaction and all its receipts are final.
 * A network error or RPC timeout does not mean failure: the transaction may still land, so this keeps
 * asking by hash until it has an answer, and otherwise throws `VaultOutcomeUnknownError`.
 */
export async function callFinal(signer: SignerHandle, call: CallSpec, options: TransportOptions = {}): Promise<FinalOutcome> {
  const deadline = Date.now() + (options.final_timeout_ms ?? DEFAULT_FINAL_TIMEOUT_MS);
  const pollMs = options.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  const provider = signer.account.provider;

  const action: Action = actions.functionCall(call.method, call.args, call.gas ?? GAS_ADMIN, call.deposit ?? 0n);
  const signed = await signer.account.createSignedTransaction({ receiverId: call.contract_id, actions: [action] });
  const tx_hash = hashOf(signed);

  let lastError: unknown = null;
  const sent = await untilDeadline(provider.sendTransactionUntil(signed, "FINAL"), deadline);
  if (sent.kind === "value" && isFinal(sent.value)) return readFinalOutcome(sent.value);
  if (sent.kind === "error") {
    const reason = refusalReason(sent.error);
    if (reason) throw new TransactionRefusedError(`NEAR refused the transaction: ${reason}`, reason, sent.error);
    lastError = sent.error;
  }

  while (Date.now() < deadline) {
    const status = await untilDeadline(
      provider.viewTransactionStatus({
        txHash: tx_hash,
        accountId: signer.account_id,
        waitUntil: "FINAL",
      }),
      deadline,
    );
    if (status.kind === "value" && isFinal(status.value)) return readFinalOutcome(status.value);
    if (status.kind === "error") lastError = status.error;
    if (status.kind !== "deadline") await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  throw new VaultOutcomeUnknownError(`No final outcome for ${tx_hash} before the deadline`, tx_hash, lastError);
}

/** A NEAR transaction hash is the base58 of sha256 over the borsh-encoded transaction. */
export function hashOf(signed: SignedTransaction): string {
  return baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());
}
