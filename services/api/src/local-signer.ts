/**
 * The local test signer: lets the browser act as one of the testnet cast accounts on this machine, so
 * Join, vote, redeem and execute can be checked end to end without a browser wallet. Every action is a
 * real NEAR testnet transaction, signed with that account's key from the local credential store.
 *
 * Three guards, all required, checked when the API starts (it refuses to start otherwise):
 *   1. WARDLINE_LOCAL_SIGNER=1
 *   2. the API is bound to 127.0.0.1 (never a public interface)
 *   3. the network is testnet, in near mode, and not a production process
 * It signs only for cast accounts listed in data/testnet/setup.json, and only these pool and USDC calls,
 * and answers only requests with x-wardline-local-signer: 1 from a loopback origin.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { z } from "zod";
import { actions, makeProvider, makeSigner } from "@wardline/vault-client";
import { activityPaths, makeRpc, rowFromChain, type RowFields } from "./activity/log.js";
import { repoNear } from "./chain/index.js";
import type { Deps } from "./service.js";

const LOOPBACK = "127.0.0.1";
const TGAS = 10n ** 12n;

export class LocalSignerRefused extends Error {}

/** The pool writes times as "<nanoseconds>ns". */
const nsToIso = (t: string) => (/^\d+ns$/.test(t) ? new Date(Number(BigInt(t.slice(0, -2)) / 1_000_000n)).toISOString() : t);

/** Returns whether the signer is on. Throws LocalSignerRefused when it is asked for but a guard fails. */
export function localSignerFromEnv(env: Record<string, string | undefined>, host: string, chainMode: "sim" | "near"): boolean {
  if (env.WARDLINE_LOCAL_SIGNER !== "1") return false;
  if (host !== LOOPBACK) throw new LocalSignerRefused(`WARDLINE_LOCAL_SIGNER=1 needs the API bound to ${LOOPBACK}, not ${host}. Unset WARDLINE_BIND_PUBLIC.`);
  const network = env.WARDLINE_NEAR_NETWORK ?? repoNear().network;
  if (network !== "testnet") throw new LocalSignerRefused(`WARDLINE_LOCAL_SIGNER=1 is for NEAR testnet only, not ${network}.`);
  if (chainMode !== "near") throw new LocalSignerRefused("WARDLINE_LOCAL_SIGNER=1 needs WARDLINE_CHAIN_MODE=near: it sends real testnet transactions.");
  if (env.NODE_ENV === "production") throw new LocalSignerRefused("WARDLINE_LOCAL_SIGNER=1 is never allowed in production.");
  return true;
}

const Account = z.string().regex(/^[a-z0-9_-]+\.wardline-labs\.testnet$/);
const Atomic = z.string().regex(/^[1-9][0-9]{0,15}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deposit"), account: Account, amount: Atomic }),
  z.object({ action: z.literal("withdraw"), account: Account, amount: Atomic }),
  z.object({ action: z.literal("redeem"), account: Account, id: z.string().min(1).max(200) }),
  z.object({ action: z.literal("vote"), account: Account, id: z.number().int().min(0), support: z.enum(["for", "against"]) }),
  z.object({ action: z.literal("execute"), account: Account, id: z.number().int().min(0) }),
]);

interface Paths {
  credentials: string;
  setup: string;
}

function defaultPaths(env: Record<string, string | undefined>): Paths {
  const secrets = env.WARDLINE_SECRETS_DIR ?? join(homedir(), ".wardline", "testnet");
  return { credentials: join(secrets, "credentials.json"), setup: join(activityPaths(env).log, "..", "setup.json") };
}

/** Cast accounts this signer may act as: in setup.json, with a key on this machine, and not a treasury. */
function castAccounts(paths: Paths): Map<string, string> {
  const keys = existsSync(paths.credentials) ? ((JSON.parse(readFileSync(paths.credentials, "utf8")) as { accounts?: Record<string, string> }).accounts ?? {}) : {};
  const cast = existsSync(paths.setup) ? ((JSON.parse(readFileSync(paths.setup, "utf8")) as { accounts?: string[] }).accounts ?? []) : [];
  const out = new Map<string, string>();
  for (const a of cast) if (keys[a] && !/-dao\./.test(a)) out.set(a, keys[a]);
  return out;
}

export function registerLocalSigner(app: Hono, deps: Deps, env: Record<string, string | undefined> = process.env, paths: Paths = defaultPaths(env)): void {
  const contracts = deps.ai.contracts;
  const rpcUrl = env.WARDLINE_NEAR_RPC_URL ?? env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
  const provider = makeProvider(rpcUrl);
  const rpc = makeRpc([rpcUrl, "https://rpc.testnet.near.org"]);

  // Only this machine's pages: a custom header (so a cross-site request needs a preflight it never gets)
  // and, when a browser sends one, a loopback Origin.
  app.use("/v1/local-signer/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return c.json({ error: "FORBIDDEN", message: "The local test signer only answers pages served from this machine." }, 403);
    if (c.req.method !== "GET" && c.req.header("x-wardline-local-signer") !== "1") return c.json({ error: "FORBIDDEN", message: "Send x-wardline-local-signer: 1." }, 403);
    return next();
  });

  app.get("/v1/local-signer", (c) => c.json({ signer: "local test signer", network: "testnet", accounts: [...castAccounts(paths).keys()].sort() }));

  app.post("/v1/local-signer/mutual", async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Bad request." }, 400);
    const req = parsed.data;
    const key = castAccounts(paths).get(req.account);
    if (!key) return c.json({ error: "NOT_A_CAST_ACCOUNT", message: `The local test signer has no key for ${req.account}.` }, 403);
    const signer = makeSigner(provider, req.account, key);
    const [receiverId, method, args, deposit] =
      req.action === "deposit" ? [contracts.token, "ft_transfer_call", { receiver_id: contracts.pool, amount: req.amount, msg: "" }, 1n]
      : req.action === "withdraw" ? [contracts.pool, "request_redeem", { amount: req.amount }, 0n]
      : req.action === "redeem" ? [contracts.pool, "redeem", { account: req.account, id: req.id }, 0n]
      : req.action === "vote" ? [contracts.pool, "vote", { id: req.id, support: req.support }, 0n]
      : [contracts.pool, "execute", { id: req.id }, 0n];
    let out: { transaction: { hash: string }; status: { SuccessValue?: string; Failure?: unknown } };
    try {
      out = (await signer.account.signAndSendTransaction({ receiverId, actions: [actions.functionCall(method, args, 100n * TGAS, deposit)], waitUntil: "FINAL" })) as unknown as typeof out;
    } catch (error) {
      return c.json({ error: "REFUSED", message: (error as Error).message.slice(0, 400) }, 409);
    }
    if (out.status.Failure !== undefined) return c.json({ error: "REFUSED", message: JSON.stringify(out.status.Failure).slice(0, 400), tx: out.transaction.hash }, 409);
    const raw = out.status.SuccessValue ? Buffer.from(out.status.SuccessValue, "base64").toString("utf8") : "";
    const value = raw ? (JSON.parse(raw) as Record<string, string> | string) : null;
    const tx = out.transaction.hash;

    // The same row rules as the batch: built from RPC, appended to the log, served after the next audit.
    const usd = (a: string) => (Number(a) / 1e6).toFixed(2);
    const fields: RowFields | null =
      req.action === "deposit" ? { actor: req.account, community: "mutual", kind: "deposit", amount: req.amount, model: null, outcome: "paid", side: "above", reason: null, text: `${req.account.split(".")[0]} deposited ${usd(req.amount)} USDC and received WARD` }
      : req.action === "withdraw" ? { actor: req.account, community: "mutual", kind: "redeem", amount: req.amount, model: null, outcome: "opened", side: "above", reason: null, text: `${req.account.split(".")[0]} asked to redeem ${usd(req.amount)} WARD` }
      : req.action === "redeem" ? { actor: req.account, community: "mutual", kind: "redeem", amount: typeof value === "object" && value ? (value.usdc ?? null) : null, model: null, outcome: "paid", side: "above", reason: null, text: `${req.account.split(".")[0]} redeemed WARD for USDC` }
      : req.action === "vote" ? { actor: req.account, community: "mutual", kind: "vote", amount: null, model: null, outcome: "voted", side: "above", reason: null, text: `${req.account.split(".")[0]} voted ${req.support} on proposal ${req.id}` }
      : { actor: req.account, community: "mutual", kind: "proposal", amount: null, model: null, outcome: "executed", side: "above", reason: null, text: `Proposal ${req.id} passed and was executed` };
    try {
      const row = await rowFromChain(rpc, tx, req.account, fields);
      appendFileSync(activityPaths(env).log, `${JSON.stringify(row)}\n`, "utf8");
    } catch {
      // The transaction stands; the row waits for the batch writer's rules. Nothing is invented here.
    }

    const position = await deps.ai.chain.pool.getPosition(req.account);
    const proposal = req.action === "vote" || req.action === "execute" ? await deps.ai.chain.governance.getProposal(req.id) : undefined;
    const extra = typeof value === "object" && value ? value : {};
    return c.json({ action: req.action, tx, explorer_url: `https://testnet.nearblocks.io/txns/${tx}`, ...("ward" in extra ? { ward: extra.ward } : {}), ...("usdc" in extra ? { usdc: extra.usdc } : {}), ...("available_at" in extra ? { id: extra.id, available_at: nsToIso(extra.available_at!) } : {}), position, ...(proposal ? { proposal } : {}) });
  });
}
