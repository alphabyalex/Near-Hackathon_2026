/**
 * Read-only NEAR RPC from the browser: balances and registrations a wallet needs checked before it
 * signs. Tries each endpoint in NEAR_RPC_URLS. Never signs anything.
 */
import { NEAR_RPC_URLS } from "../config";

type RpcFetch = (url: string, init: RequestInit) => Promise<Response>;
let rpcFetch: RpcFetch = (url, init) => fetch(url, init);

/** Tests only: answer RPC calls without the network (null restores fetch). */
export function setRpcFetch(next: RpcFetch | null): void {
  rpcFetch = next ?? ((url, init) => fetch(url, init));
}

async function query<T>(params: Record<string, unknown>): Promise<T> {
  let last: unknown = null;
  for (const url of NEAR_RPC_URLS) {
    try {
      const res = await rpcFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "wardline", method: "query", params: { finality: "final", ...params } }) });
      const body = (await res.json()) as { result?: T & { error?: string }; error?: { cause?: { name?: string }; data?: string; message?: string } };
      if (body.result && !body.result.error) return body.result;
      const err: { cause?: { name?: string }; data?: string; message?: string } = body.error ?? { message: body.result?.error ?? "" };
      // An answer about the account or contract is final; a busy endpoint is not.
      if (err.cause?.name === "UNKNOWN_ACCOUNT") throw Object.assign(new Error(`${String(params.account_id)} does not exist on NEAR.`), { final: true, code: "UNKNOWN_ACCOUNT" });
      if (body.result?.error || err.cause?.name === "NO_CONTRACT_CODE") throw Object.assign(new Error(String(body.result?.error ?? err.message)), { final: true });
      last = new Error(err.data ?? err.message ?? "The NEAR RPC refused the request.");
    } catch (error) {
      if ((error as { final?: boolean }).final) throw error;
      last = error;
    }
  }
  throw Object.assign(new Error(`No NEAR RPC endpoint answered. ${last instanceof Error ? last.message : ""}`.trim()), { code: "CHAIN_UNAVAILABLE" });
}

const toBase64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** A contract view call, decoded from JSON. */
export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const result = await query<{ result: number[] }>({ request_type: "call_function", account_id: contract, method_name: method, args_base64: toBase64(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
}

/** NEAR the account can spend now: its balance minus what storage locks. In yoctoNEAR. */
export async function spendableNear(account: string): Promise<bigint> {
  const a = await query<{ amount: string; locked: string; storage_usage: number }>({ request_type: "view_account", account_id: account });
  const storageCost = BigInt(a.storage_usage) * 10_000_000_000_000_000_000n; // 1e19 yoctoNEAR per byte
  const free = BigInt(a.amount) - storageCost;
  return free > 0n ? free : 0n;
}

export const ftBalance = async (token: string, account: string): Promise<bigint> => BigInt(await view<string>(token, "ft_balance_of", { account_id: account }));

export const storageBalance = (contract: string, account: string) => view<{ total: string; available: string } | null>(contract, "storage_balance_of", { account_id: account });
