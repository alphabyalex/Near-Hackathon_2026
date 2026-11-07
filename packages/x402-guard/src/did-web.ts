import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58, base64urlnopad } from "@scure/base";

export interface DidWebIdentity {
  did: string;
  /** Bare hostname, without any port. */
  domain: string;
  documentUrl: string;
}

/** Parses did:web:<host>[:path...][#fragment]. Port colons are percent-encoded, as the method requires. */
export function parseDidWeb(didUrl: string): DidWebIdentity {
  const did = didUrl.split("#")[0] ?? "";
  const [method, name, encodedHost, ...path] = did.split(":");
  if (method !== "did" || name !== "web" || !encodedHost) throw new Error(`Not a did:web identifier: ${didUrl}`);
  const host = decodeURIComponent(encodedHost);
  if (!/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host)) throw new Error(`Bad did:web host: ${didUrl}`);
  const domain = (host.split(":")[0] ?? "").toLowerCase();
  const suffix = path.length > 0 ? `/${path.map(decodeURIComponent).join("/")}/did.json` : "/.well-known/did.json";
  return { did, domain, documentUrl: `https://${host}${suffix}` };
}

export interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
}

interface VerificationMethod {
  id?: string;
  publicKeyJwk?: Jwk;
  publicKeyMultibase?: string;
}

export interface DidDocument {
  id?: string;
  verificationMethod?: VerificationMethod[];
}

export type DidResolver = (identity: DidWebIdentity) => Promise<DidDocument>;

const ED25519_MULTICODEC = [0xed, 0x01];

function keyFromMethod(method: VerificationMethod): Jwk | { multibaseEd25519: Uint8Array } {
  if (method.publicKeyJwk) return method.publicKeyJwk;
  if (method.publicKeyMultibase?.startsWith("z")) {
    const bytes = base58.decode(method.publicKeyMultibase.slice(1));
    if (bytes.length === 34 && bytes[0] === ED25519_MULTICODEC[0] && bytes[1] === ED25519_MULTICODEC[1]) {
      return { multibaseEd25519: bytes.slice(2) };
    }
  }
  throw new Error("Unsupported key in the DID document.");
}

function verifyJwsSignature(alg: string, key: Jwk | { multibaseEd25519: Uint8Array }, signature: Uint8Array, message: Uint8Array): boolean {
  if ("multibaseEd25519" in key) return alg === "EdDSA" && ed25519.verify(signature, message, key.multibaseEd25519);
  const x = key.x ? base64urlnopad.decode(key.x) : null;
  if (!x) return false;
  if (alg === "EdDSA" && key.kty === "OKP" && key.crv === "Ed25519") return ed25519.verify(signature, message, x);
  const y = key.y ? base64urlnopad.decode(key.y) : null;
  if (!y || key.kty !== "EC") return false;
  const point = Uint8Array.of(0x04, ...x, ...y);
  if (alg === "ES256" && key.crv === "P-256") return p256.verify(signature, message, point, { lowS: false });
  if (alg === "ES256K" && key.crv === "secp256k1") return secp256k1.verify(signature, message, point, { lowS: false });
  return false;
}

export interface VerifiedJws {
  domain: string;
  payload: unknown;
}

/**
 * Verifies a compact JWS whose `kid` is a did:web URL: resolves the DID document, finds that key
 * in verificationMethod, and checks the signature. Throws on any failure.
 */
export async function verifyDidWebJws(compact: string, resolve: DidResolver): Promise<VerifiedJws> {
  const [encodedHeader, encodedPayload, encodedSignature] = compact.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Not a compact JWS.");
  const decode = (part: string): unknown => JSON.parse(new TextDecoder().decode(base64urlnopad.decode(part)));
  const header = decode(encodedHeader) as { alg?: unknown; kid?: unknown };
  if (typeof header.alg !== "string" || typeof header.kid !== "string") throw new Error("The JWS header needs alg and kid.");

  const identity = parseDidWeb(header.kid);
  const document = await resolve(identity);
  if (document.id !== identity.did) throw new Error("The DID document is for a different identifier.");
  const fragment = header.kid.includes("#") ? `#${header.kid.split("#")[1]}` : null;
  const method = document.verificationMethod?.find((m) => m.id === header.kid || (fragment !== null && m.id === fragment));
  if (!method) throw new Error("The signing key is not listed in the DID document.");

  const message = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  if (!verifyJwsSignature(header.alg, keyFromMethod(method), base64urlnopad.decode(encodedSignature), message)) {
    throw new Error("The offer signature does not verify.");
  }
  return { domain: identity.domain, payload: decode(encodedPayload) };
}
