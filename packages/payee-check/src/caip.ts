/**
 * CAIP-10 account ids: "<namespace>:<reference>:<address>".
 * Supported namespaces: near, eip155, solana. A bare NEAR account id is accepted and normalized
 * to near:<network>:<id>. Everything is validated before any check runs.
 */

export type Namespace = "near" | "eip155" | "solana";

export interface ParsedAccount {
  namespace: Namespace;
  /** Chain reference: NEAR network, EVM chain id, or Solana cluster. */
  reference: string;
  /** Normalized address: lowercase for NEAR and EVM, unchanged for Solana (base58 is case-sensitive). */
  address: string;
  /** CAIP-2 chain id, "<namespace>:<reference>". */
  chainId: string;
}

export class AccountParseError extends Error {
  constructor(
    public readonly input: string,
    message: string,
  ) {
    super(`Invalid account "${input.length > 80 ? `${input.slice(0, 80)}...` : input}": ${message}`);
    this.name = "AccountParseError";
  }
}

const NEAR_NETWORKS = new Set(["mainnet", "testnet", "sandbox", "localnet"]);
/** NEAR account id rules from nomicon: 2 to 64 chars, lowercase, parts joined by "." with "-" or "_" inside. */
const NEAR_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
/** CAIP-2 references for Solana are the first 32 chars of the genesis hash. We map them to cluster names. */
const SOLANA_GENESIS: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "mainnet",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": "testnet",
};
const SOLANA_CLUSTERS = new Set(["mainnet", "devnet", "testnet"]);

export interface ParseOptions {
  /** Network for a bare NEAR id without a .near or .testnet suffix. Default "testnet". */
  defaultNearNetwork?: string;
}

/** Decoded byte length of a base58 string, or null if it is not base58. */
export function base58ByteLength(s: string): number | null {
  if (!BASE58.test(s)) return null;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(alphabet.indexOf(ch));
  let bytes = 0;
  while (n > 0n) {
    n >>= 8n;
    bytes += 1;
  }
  let leadingZeros = 0;
  while (s[leadingZeros] === "1") leadingZeros += 1;
  return bytes + leadingZeros;
}

export function isValidNearAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && NEAR_ID.test(id);
}

function parseNear(input: string, reference: string, address: string): ParsedAccount {
  if (!NEAR_NETWORKS.has(reference)) throw new AccountParseError(input, `unknown NEAR network "${reference}" (expected testnet, mainnet, sandbox or localnet)`);
  const id = address.toLowerCase();
  if (!isValidNearAccountId(id)) throw new AccountParseError(input, "not a valid NEAR account id (2 to 64 chars of a-z, 0-9, and - _ . separators)");
  return { namespace: "near", reference, address: id, chainId: `near:${reference}` };
}

function parseEvm(input: string, reference: string, address: string): ParsedAccount {
  if (!/^[1-9]\d{0,31}$/.test(reference)) throw new AccountParseError(input, `EVM chain reference must be a decimal chain id, got "${reference}"`);
  if (!EVM_ADDRESS.test(address)) throw new AccountParseError(input, "EVM address must be 0x followed by 40 hex characters");
  return { namespace: "eip155", reference, address: address.toLowerCase(), chainId: `eip155:${reference}` };
}

function parseSolana(input: string, reference: string, address: string): ParsedAccount {
  const cluster = SOLANA_CLUSTERS.has(reference) ? reference : SOLANA_GENESIS[reference];
  if (!cluster) throw new AccountParseError(input, `unknown Solana cluster "${reference}" (expected mainnet, devnet, testnet or a CAIP-2 genesis reference)`);
  if (address.length < 32 || address.length > 44 || base58ByteLength(address) !== 32)
    throw new AccountParseError(input, "Solana address must be base58 encoding exactly 32 bytes");
  return { namespace: "solana", reference: cluster, address, chainId: `solana:${cluster}` };
}

/** Parses and normalizes an account. Throws AccountParseError with a specific message on bad input. */
export function parseAccount(raw: string, opts: ParseOptions = {}): ParsedAccount {
  if (typeof raw !== "string") throw new AccountParseError(String(raw), "must be a string");
  const input = raw.trim();
  if (input.length === 0) throw new AccountParseError(raw, "empty");
  if (input.length > 160) throw new AccountParseError(raw, "longer than 160 characters");

  const parts = input.split(":");
  if (parts.length === 1) {
    const id = input.toLowerCase();
    const network = id.endsWith(".near") ? "mainnet" : id.endsWith(".testnet") ? "testnet" : (opts.defaultNearNetwork ?? "testnet");
    return parseNear(input, network, id);
  }
  if (parts.length !== 3) throw new AccountParseError(raw, 'expected CAIP-10 "<namespace>:<reference>:<address>" or a bare NEAR account id');
  const [namespace, reference, address] = parts as [string, string, string];
  if (!/^[-a-z0-9]{3,8}$/.test(namespace)) throw new AccountParseError(raw, `malformed namespace "${namespace}"`);
  if (!/^[-_a-zA-Z0-9]{1,32}$/.test(reference)) throw new AccountParseError(raw, `malformed chain reference "${reference}"`);
  if (address.length === 0) throw new AccountParseError(raw, "missing address");
  switch (namespace) {
    case "near":
      return parseNear(raw, reference, address);
    case "eip155":
      return parseEvm(raw, reference, address);
    case "solana":
      return parseSolana(raw, reference, address);
    default:
      throw new AccountParseError(raw, `unsupported namespace "${namespace}" (supported: near, eip155, solana)`);
  }
}

export function formatAccount(a: Pick<ParsedAccount, "namespace" | "reference" | "address">): string {
  return `${a.namespace}:${a.reference}:${a.address}`;
}

/** parseAccount then formatAccount. */
export function normalizeAccount(raw: string, opts?: ParseOptions): string {
  return formatAccount(parseAccount(raw, opts));
}

/** For data we did not receive from the caller (registry, history): null instead of throwing. */
export function tryParseAccount(raw: string, opts?: ParseOptions): ParsedAccount | null {
  try {
    return parseAccount(raw, opts);
  } catch {
    return null;
  }
}

export function parseChainId(raw: string): { namespace: Namespace; reference: string; chainId: string } {
  const m = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})$/.exec(raw.trim());
  if (!m) throw new AccountParseError(raw, 'expected a CAIP-2 chain id "<namespace>:<reference>"');
  const [, namespace, reference] = m as unknown as [string, string, string];
  if (namespace === "near") {
    if (!NEAR_NETWORKS.has(reference)) throw new AccountParseError(raw, `unknown NEAR network "${reference}"`);
    return { namespace, reference, chainId: `near:${reference}` };
  }
  if (namespace === "eip155") {
    if (!/^[1-9]\d{0,31}$/.test(reference)) throw new AccountParseError(raw, "EVM chain reference must be a decimal chain id");
    return { namespace, reference, chainId: `eip155:${reference}` };
  }
  if (namespace === "solana") {
    const cluster = SOLANA_CLUSTERS.has(reference) ? reference : SOLANA_GENESIS[reference];
    if (!cluster) throw new AccountParseError(raw, `unknown Solana cluster "${reference}"`);
    return { namespace, reference: cluster, chainId: `solana:${cluster}` };
  }
  throw new AccountParseError(raw, `unsupported namespace "${namespace}"`);
}

export class DomainParseError extends Error {
  constructor(
    public readonly input: string,
    message: string,
  ) {
    super(`Invalid domain "${input}": ${message}`);
    this.name = "DomainParseError";
  }
}

/** Lowercases, strips a scheme, path and trailing dot. Does not strip "www.": that is a different name. */
export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split(/[/?#]/)[0] ?? "";
  d = d.replace(/\.$/, "");
  if (d.includes(":")) throw new DomainParseError(raw, "ports are not part of a vendor domain");
  if (d.length < 3 || d.length > 253) throw new DomainParseError(raw, "length must be 3 to 253");
  const labels = d.split(".");
  if (labels.length < 2) throw new DomainParseError(raw, "needs at least one dot");
  for (const l of labels)
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) throw new DomainParseError(raw, `bad label "${l}"`);
  return d;
}
