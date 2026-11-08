import { ChainId } from "@wardline/schemas";
import { base58 } from "@scure/base";

/** Bad caller input: a malformed account, chain or domain. Never treated as a verdict. */
export class InvalidPayeeInputError extends Error {
  override readonly name = "InvalidPayeeInputError";
}

export interface ParsedAccount {
  namespace: string;
  reference: string;
  address: string;
  chain: string;
  caip10: string;
}

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$/;
const NEAR_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const GENERIC_ADDRESS = /^[-.%a-zA-Z0-9]{1,128}$/;

/** A bare hostname, lowercased. Rejects schemes, ports, paths and IP literals. */
export function normalizeDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN.test(domain)) throw new InvalidPayeeInputError(`Not a domain name: ${input}`);
  return domain;
}

export function normalizeChain(input: string): string {
  const chain = input.trim();
  if (!ChainId.safeParse(chain).success) throw new InvalidPayeeInputError(`Not a CAIP-2 chain id: ${input}`);
  return chain;
}

function normalizeAddress(namespace: string, address: string, original: string): string {
  switch (namespace) {
    case "near": {
      const id = address.toLowerCase();
      if (!NEAR_ACCOUNT.test(id)) throw new InvalidPayeeInputError(`Not a NEAR account id: ${original}`);
      return id;
    }
    case "eip155":
      if (!EVM_ADDRESS.test(address)) throw new InvalidPayeeInputError(`Not an EVM address: ${original}`);
      return address.toLowerCase();
    case "solana": {
      let bytes: Uint8Array;
      try {
        bytes = base58.decode(address);
      } catch {
        throw new InvalidPayeeInputError(`Not a Solana address: ${original}`);
      }
      if (bytes.length !== 32) throw new InvalidPayeeInputError(`Not a Solana address: ${original}`);
      return address;
    }
    default:
      if (!GENERIC_ADDRESS.test(address)) throw new InvalidPayeeInputError(`Not a CAIP-10 account: ${original}`);
      return address;
  }
}

/** Parses a CAIP-10 account, or a bare NEAR id, into its normalized form. */
export function parseAccount(input: string, network = "testnet"): ParsedAccount {
  const trimmed = input.trim();
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const address = normalizeAddress("near", trimmed, input);
    return { namespace: "near", reference: network, address, chain: `near:${network}`, caip10: `near:${network}:${address}` };
  }
  const [namespace, reference, address] = parts;
  if (parts.length !== 3 || !namespace || !reference || !address) {
    throw new InvalidPayeeInputError(`Not a CAIP-10 account: ${input}`);
  }
  const chain = normalizeChain(`${namespace}:${reference}`);
  const normalized = normalizeAddress(namespace, address, input);
  return { namespace, reference, address: normalized, chain, caip10: `${chain}:${normalized}` };
}

export const normalizeAccount = (input: string, network = "testnet"): string => parseAccount(input, network).caip10;

export const chainOf = (caip10: string): string => caip10.split(":").slice(0, 2).join(":");
