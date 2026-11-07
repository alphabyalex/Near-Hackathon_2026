import { normalizeDomain, RedlineBlockedError, type Redline } from "@redline/sdk";
import type { PayeeCheckResult, PayeeReason } from "@redline/schemas";
import { z } from "zod";
import { verifyDidWebJws, type DidDocument, type DidResolver } from "./did-web.js";

export { parseDidWeb, verifyDidWebJws, type DidDocument, type DidResolver, type DidWebIdentity, type Jwk } from "./did-web.js";

const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const OFFER_RECEIPT_EXTENSION = "offer-receipt";
const DID_TIMEOUT_MS = 5_000;

const Requirement = z.looseObject({
  network: z.string(),
  payTo: z.string(),
  asset: z.string().optional(),
  amount: z.string().optional(),
  scheme: z.string().optional(),
});
type Requirement = z.infer<typeof Requirement>;

const PaymentRequired = z.looseObject({
  accepts: z.array(Requirement),
  extensions: z.record(z.string(), z.unknown()).optional(),
  resource: z.unknown().optional(),
});
type PaymentRequired = z.infer<typeof PaymentRequired>;

const OfferExtension = z.object({ info: z.object({ offers: z.array(z.looseObject({ format: z.string(), signature: z.string() })) }) });

const OfferPayload = z.looseObject({
  resourceUrl: z.string(),
  network: z.string(),
  payTo: z.string(),
  asset: z.string().optional(),
  amount: z.string().optional(),
  scheme: z.string().optional(),
  validUntil: z.number().optional(),
});
type OfferPayload = z.infer<typeof OfferPayload>;

const NETWORK_NAMES: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  ethereum: "eip155:1",
  sepolia: "eip155:11155111",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
  arbitrum: "eip155:42161",
  optimism: "eip155:10",
  avalanche: "eip155:43114",
  solana: "solana:mainnet",
  "solana-devnet": "solana:devnet",
  near: "near:mainnet",
  "near-testnet": "near:testnet",
};

/** x402 names Solana clusters by genesis hash. The registry uses the short names. */
const SOLANA_GENESIS: Record<string, string> = {
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "solana:devnet",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana:mainnet",
};

/** Maps an x402 network to a CAIP-2 chain id. Throws on a network it does not know. */
export function networkToChain(network: string): string {
  const named = NETWORK_NAMES[network];
  if (named) return named;
  const genesis = SOLANA_GENESIS[network];
  if (genesis) return genesis;
  if (/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(network)) return network;
  throw new Error(`Unknown x402 network: ${network}`);
}

export interface GuardOptions {
  redline: Pick<Redline, "check">;
  /** Payer id passed to the check, so a changed payee raises PAYEE_CHANGED. */
  payer?: string;
  /** How to fetch a DID document. Defaults to HTTPS through the wrapped fetch. */
  resolveDid?: DidResolver;
  now?: () => Date;
}

const hostOf = (url: string): string => normalizeDomain(new URL(url).hostname);

function defaultDidResolver(baseFetch: typeof fetch): DidResolver {
  return async ({ documentUrl }) => {
    const response = await baseFetch(documentUrl, { signal: AbortSignal.timeout(DID_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`The DID document answered ${response.status}.`);
    return (await response.json()) as DidDocument;
  };
}

const sameTerms = (offer: OfferPayload, requirement: Requirement): boolean =>
  offer.network === requirement.network &&
  offer.payTo === requirement.payTo &&
  (offer.asset === undefined || offer.asset === requirement.asset) &&
  (offer.amount === undefined || offer.amount === requirement.amount) &&
  (offer.scheme === undefined || offer.scheme === requirement.scheme);

interface VerifiedOffer {
  domain: string;
  payload: OfferPayload;
}

/** Verifies every did:web signed offer. EIP-712 offers name no website, so they cannot supply a domain. */
async function verifiedOffers(required: PaymentRequired, requestUrl: string, resolve: DidResolver, now: Date): Promise<VerifiedOffer[]> {
  const extension = required.extensions?.[OFFER_RECEIPT_EXTENSION];
  if (extension === undefined) return [];
  const { info } = OfferExtension.parse(extension);
  const verified: VerifiedOffer[] = [];
  for (const offer of info.offers) {
    if (offer.format !== "jws") continue;
    const { domain, payload } = await verifyDidWebJws(offer.signature, resolve);
    const parsed = OfferPayload.parse(payload);
    if (new URL(parsed.resourceUrl).hostname !== new URL(requestUrl).hostname) {
      throw new Error("This signed offer is for a different resource.");
    }
    if (parsed.validUntil !== undefined && parsed.validUntil * 1000 < now.getTime()) {
      throw new Error("This signed offer has expired.");
    }
    verified.push({ domain, payload: parsed });
  }
  return verified;
}

async function checkRequirement(requirement: Requirement, requestUrl: string, offers: VerifiedOffer[], options: GuardOptions): Promise<PayeeCheckResult> {
  const chain = networkToChain(requirement.network);
  const domain = offers.find((o) => sameTerms(o.payload, requirement))?.domain ?? hostOf(requestUrl);
  const amount = requirement.amount && /^\d+$/.test(requirement.amount) ? { amount: requirement.amount } : {};
  return options.redline.check({
    payee: `${chain}:${requirement.payTo}`,
    vendor: { domain },
    source: "x402",
    ...amount,
    ...(requirement.asset ? { asset: requirement.asset } : {}),
    ...(options.payer ? { payer: options.payer } : {}),
  });
}

function decodeHeader(value: string): PaymentRequired {
  return PaymentRequired.parse(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))));
}

const encodeHeader = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
};

async function readPaymentRequired(response: Response): Promise<{ header: PaymentRequired | null; body: PaymentRequired | null }> {
  const headerValue = response.headers.get(PAYMENT_REQUIRED_HEADER);
  const header = headerValue ? decodeHeader(headerValue) : null;
  const text = await response.clone().text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A body that is not JSON is fine when the header carries the requirements. The caller stops if neither does.
  }
  const parsed = PaymentRequired.safeParse(json);
  return { header, body: parsed.success ? parsed.data : null };
}

const requirementKey = (r: Requirement): string => JSON.stringify([r.network, r.payTo, r.asset ?? null, r.amount ?? null, r.scheme ?? null]);

function blocked(results: PayeeCheckResult[]): RedlineBlockedError {
  const worst = results.find((r) => r.verdict === "BLOCK") ?? results.find((r) => r.verdict !== "PAY");
  const reasons: PayeeReason[] = results.filter((r) => r.verdict !== "PAY").flatMap((r) => r.reasons);
  const why = reasons.map((r) => r.code).join(", ") || "no reasons";
  return new RedlineBlockedError(`Redline stopped this x402 payment: ${worst?.verdict ?? "HOLD"} (${why}).`, { verdict: worst?.verdict ?? null, reasons });
}

const failClosed = (error: unknown): RedlineBlockedError =>
  error instanceof RedlineBlockedError
    ? error
    : new RedlineBlockedError(`Redline could not confirm this x402 payment, so it is stopped: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error });

/**
 * Decides one 402. Any BLOCK stops it. Otherwise the payer only sees options that got PAY, and if
 * none did it stops. Header and body are both read, since a client may pay from either.
 */
async function guardResponse(response: Response, requestUrl: string, options: GuardOptions, baseFetch: typeof fetch): Promise<Response> {
  const { header, body } = await readPaymentRequired(response);
  const sources = [header, body].filter((s): s is PaymentRequired => s !== null);
  const requirements = new Map<string, Requirement>();
  for (const source of sources) for (const r of source.accepts) requirements.set(requirementKey(r), r);
  if (requirements.size === 0) throw new Error("The 402 response has no payment requirements.");

  const resolve = options.resolveDid ?? defaultDidResolver(baseFetch);
  const now = (options.now ?? (() => new Date()))();
  const offers = (await Promise.all(sources.map((s) => verifiedOffers(s, requestUrl, resolve, now)))).flat();

  const entries = [...requirements.entries()];
  const results = await Promise.all(entries.map(([, r]) => checkRequirement(r, requestUrl, offers, options)));
  if (results.some((r) => r.verdict === "BLOCK")) throw blocked(results);
  const approved = new Set(entries.filter((_, i) => results[i]?.verdict === "PAY").map(([key]) => key));
  if (approved.size === 0) throw blocked(results);
  if (approved.size === entries.length) return response;

  const keep = <T extends PaymentRequired>(source: T): T => ({ ...source, accepts: source.accepts.filter((r) => approved.has(requirementKey(r))) });
  const headers = new Headers(response.headers);
  if (header) headers.set(PAYMENT_REQUIRED_HEADER, encodeHeader(keep(header)));
  headers.delete("content-length");
  return new Response(body ? JSON.stringify(keep(body)) : await response.text(), { status: 402, statusText: response.statusText, headers });
}

const urlOf = (input: RequestInfo | URL): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** The part of an x402Client this needs: its hook runs before a payment is created. */
export interface X402ClientLike {
  onBeforePaymentCreation(hook: (context: HookContext) => Promise<{ abort: true; reason: string } | void>): unknown;
}

export interface HookContext {
  selectedRequirements: unknown;
  paymentRequired?: unknown;
}

function resourceUrl(paymentRequired: unknown): string {
  const resource = (paymentRequired as { resource?: unknown } | undefined)?.resource;
  const url = typeof resource === "string" ? resource : (resource as { url?: unknown } | undefined)?.url;
  if (typeof url !== "string") throw new Error("This payment does not say which resource it is for.");
  return url;
}

function guardFetch(baseFetch: typeof fetch, options: GuardOptions): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 402) return response;
    try {
      return await guardResponse(response, urlOf(input), options, baseFetch);
    } catch (error) {
      throw failClosed(error);
    }
  };
}

function guardClient<T extends X402ClientLike>(client: T, options: GuardOptions): T {
  client.onBeforePaymentCreation(async (context) => {
    try {
      const requirement = Requirement.parse(context.selectedRequirements);
      const url = resourceUrl(context.paymentRequired);
      const parsed = PaymentRequired.safeParse(context.paymentRequired);
      const resolve = options.resolveDid ?? defaultDidResolver(globalThis.fetch.bind(globalThis));
      const offers = parsed.success ? await verifiedOffers(parsed.data, url, resolve, (options.now ?? (() => new Date()))()) : [];
      const result = await checkRequirement(requirement, url, offers, options);
      if (result.verdict === "PAY") return;
      return { abort: true, reason: blocked([result]).message };
    } catch (error) {
      return { abort: true, reason: failClosed(error).message };
    }
  });
  return client;
}

/**
 * Pass a fetch and get a fetch: put it inside your x402 wrapper, for example
 * wrapFetchWithPayment(withRedline(fetch, { redline }), client), so the guard sees each 402 first.
 * Or pass an x402Client and it registers an onBeforePaymentCreation hook. Either way, it pays only on PAY.
 */
export function withRedline(target: typeof fetch, options: GuardOptions): typeof fetch;
export function withRedline<T extends X402ClientLike>(target: T, options: GuardOptions): T;
export function withRedline(target: typeof fetch | X402ClientLike, options: GuardOptions): typeof fetch | X402ClientLike {
  if (typeof target === "function") return guardFetch(target, options);
  if (typeof target?.onBeforePaymentCreation === "function") return guardClient(target, options);
  throw new TypeError("withRedline needs a fetch function or an x402 client.");
}
