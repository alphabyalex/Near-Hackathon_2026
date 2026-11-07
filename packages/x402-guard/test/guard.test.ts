import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { base64urlnopad } from "@scure/base";
import { createMemoryRegistry, createRedline, RedlineBlockedError, seedEvmAddress, STUB_VENDORS, type Redline } from "@redline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeX402Server, fakePayingFetch, lookalikeAddress, type FakeServer } from "../src/fake-server.js";
import { networkToChain, parseDidWeb, verifyDidWebJws, withRedline, type DidDocument } from "../src/index.js";

const DOMAIN = "northwind.com";
const REAL = seedEvmAddress(DOMAIN);

const redline: Redline = createRedline({
  mode: "direct",
  nearRpcUrl: "https://rpc.invalid",
  registryAccount: "registry.invalid",
  registry: createMemoryRegistry({ vendors: STUB_VENDORS }),
});

let server: FakeServer;
const start = async (options: Partial<Parameters<typeof createFakeX402Server>[0]> = {}) => {
  server = createFakeX402Server({ mode: "honest", domain: DOMAIN, realPayTo: REAL, ...options });
  await server.listen();
  return server;
};

afterEach(() => server?.close());

const requirement = { scheme: "exact", network: "eip155:84532", amount: "10000", asset: "0xusdc", payTo: REAL };

const respond402 = (body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 402, headers });

const guardAgainst = (response: () => Response, options: Partial<Parameters<typeof withRedline>[1]> = {}) =>
  withRedline((async () => response()) as typeof fetch, { redline, ...options });

describe("honest and malicious servers", () => {
  it("lets an honest server get paid", async () => {
    await start({ mode: "honest" });
    const pay = fakePayingFetch(withRedline(server.fetch, { redline }));
    const response = await pay(server.resourceUrl);
    expect(response.status).toBe(200);
    expect(server.payments).toEqual([{ payTo: REAL }]);
  });

  it("blocks a malicious server that swapped payTo to a look-alike, and nothing is paid", async () => {
    await start({ mode: "malicious" });
    expect(server.payTo).not.toBe(REAL);
    expect(server.payTo.slice(0, 6)).toBe(REAL.slice(0, 6));
    const pay = fakePayingFetch(withRedline(server.fetch, { redline }));
    const error = (await pay(server.resourceUrl).catch((e: unknown) => e)) as RedlineBlockedError;
    expect(error).toBeInstanceOf(RedlineBlockedError);
    expect(error.verdict).toBe("BLOCK");
    expect(error.reasons.map((r) => r.code)).toContain("LOOKALIKE_ACCOUNT");
    expect(server.payments).toEqual([]);
  });

  it("the same malicious server is paid without the guard, which is the gap", async () => {
    await start({ mode: "malicious" });
    const response = await fakePayingFetch(server.fetch)(server.resourceUrl);
    expect(response.status).toBe(200);
    expect(server.payments).toEqual([{ payTo: lookalikeAddress(REAL) }]);
  });

  it("passes other responses through without a check", async () => {
    await start();
    const check = vi.fn();
    const guarded = withRedline(server.fetch, { redline: { check } as never });
    expect((await guarded(`https://${DOMAIN}/.well-known/did.json`)).status).toBe(200);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("signed offers", () => {
  it("pays on a valid did:web offer for the verified account", async () => {
    await start({ mode: "honest", signOffers: true });
    const response = await fakePayingFetch(withRedline(server.fetch, { redline }))(server.resourceUrl);
    expect(response.status).toBe(200);
  });

  it("still blocks when the website's own key signs the swapped address", async () => {
    await start({ mode: "malicious", signOffers: true });
    const check = vi.spyOn(redline, "check");
    const error = (await fakePayingFetch(withRedline(server.fetch, { redline }))(server.resourceUrl).catch((e: unknown) => e)) as RedlineBlockedError;
    expect(error).toBeInstanceOf(RedlineBlockedError);
    expect(error.verdict).toBe("BLOCK");
    expect(check).toHaveBeenCalled();
    expect(server.payments).toEqual([]);
    check.mockRestore();
  });

  const encode = (value: unknown) => base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(value)));
  const secret = ed25519.utils.randomSecretKey();
  const did = "did:web:northwind.com";
  const kid = `${did}#key-1`;
  const docFor = (key: Uint8Array = ed25519.getPublicKey(secret)): DidDocument => ({
    id: did,
    verificationMethod: [{ id: kid, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: base64urlnopad.encode(key) } }],
  });
  const offerFor = (payload: Record<string, unknown>, signKey: Uint8Array = secret, header: Record<string, unknown> = { alg: "EdDSA", kid }) => {
    const input = `${encode(header)}.${encode(payload)}`;
    return { format: "jws", signature: `${input}.${base64urlnopad.encode(ed25519.sign(new TextEncoder().encode(input), signKey))}` };
  };
  const offerPayload = { version: 1, resourceUrl: `https://${DOMAIN}/x`, ...requirement, validUntil: 9_999_999_999 };
  const required = (offer: unknown, accepts: unknown[] = [requirement]) => ({ x402Version: 2, accepts, extensions: { "offer-receipt": { info: { offers: [offer] } } } });
  const request = (body: unknown, doc: DidDocument = docFor(), url = `https://${DOMAIN}/x`) =>
    guardAgainst(() => respond402(body), { resolveDid: async () => doc })(url);

  it("takes the domain from the offer's did:web key, not the request host", async () => {
    const check = vi.spyOn(redline, "check");
    const body = required(offerFor({ ...offerPayload, resourceUrl: "https://cdn.fastpay.io/x" }));
    const response = await request(body, docFor(), "https://cdn.fastpay.io/x");
    expect(response.status).toBe(402);
    expect(check.mock.calls[0]?.[0]).toMatchObject({ vendor: { domain: DOMAIN }, source: "x402", payee: `eip155:84532:${REAL}` });
    check.mockRestore();
  });

  it.each<[string, () => unknown, DidDocument?]>([
    ["a key the site does not publish", () => required(offerFor(offerPayload, ed25519.utils.randomSecretKey()))],
    ["a tampered payload", () => {
      const offer = offerFor(offerPayload);
      const [header, , signature] = offer.signature.split(".");
      return required({ ...offer, signature: `${header}.${encode({ ...offerPayload, amount: "1" })}.${signature}` });
    }],
    ["an alg of none", () => required(offerFor(offerPayload, secret, { alg: "none", kid }))],
    ["a missing kid", () => required(offerFor(offerPayload, secret, { alg: "EdDSA" }))],
    ["a kid that is not did:web", () => required(offerFor(offerPayload, secret, { alg: "EdDSA", kid: "did:pkh:eip155:1:0xabc#key-1" }))],
    ["an expired offer", () => required(offerFor({ ...offerPayload, validUntil: 1 }))],
    ["an offer replayed from another resource", () => required(offerFor({ ...offerPayload, resourceUrl: "https://elsewhere.com/x" }))],
    ["a malformed offer extension", () => ({ x402Version: 2, accepts: [requirement], extensions: { "offer-receipt": { info: "nope" } } })],
    ["a DID document for another identifier", () => required(offerFor(offerPayload)), { ...docFor(), id: "did:web:evil.com" }],
    ["a DID document without the key", () => required(offerFor(offerPayload)), { id: did, verificationMethod: [] }],
  ])("fails closed on %s", async (_name, body, doc) => {
    await expect(request(body(), doc)).rejects.toBeInstanceOf(RedlineBlockedError);
  });

  it("fails closed when the DID document cannot be fetched", async () => {
    const guarded = guardAgainst(() => respond402(required(offerFor(offerPayload))), { resolveDid: () => Promise.reject(new Error("offline")) });
    await expect(guarded(`https://${DOMAIN}/x`)).rejects.toBeInstanceOf(RedlineBlockedError);
  });

  it("verifies an ES256 JWS", async () => {
    const key = p256.utils.randomSecretKey();
    const point = p256.getPublicKey(key, false);
    const doc: DidDocument = {
      id: did,
      verificationMethod: [{ id: "#key-1", publicKeyJwk: { kty: "EC", crv: "P-256", x: base64urlnopad.encode(point.slice(1, 33)), y: base64urlnopad.encode(point.slice(33)) } }],
    };
    const input = `${encode({ alg: "ES256", kid })}.${encode({ a: 1 })}`;
    const compact = `${input}.${base64urlnopad.encode(p256.sign(new TextEncoder().encode(input), key))}`;
    await expect(verifyDidWebJws(compact, async () => doc)).resolves.toEqual({ domain: DOMAIN, payload: { a: 1 } });
    await expect(verifyDidWebJws(`${input}.${base64urlnopad.encode(new Uint8Array(64))}`, async () => doc)).rejects.toThrow();
  });

  it("parses did:web forms", () => {
    expect(parseDidWeb("did:web:northwind.com#key-1")).toEqual({ did: "did:web:northwind.com", domain: DOMAIN, documentUrl: "https://northwind.com/.well-known/did.json" });
    expect(parseDidWeb("did:web:localhost%3A4021#k").documentUrl).toBe("https://localhost:4021/.well-known/did.json");
    expect(parseDidWeb("did:web:localhost%3A4021#k").domain).toBe("localhost");
    expect(parseDidWeb("did:web:northwind.com:api:v1").documentUrl).toBe("https://northwind.com/api/v1/did.json");
    expect(() => parseDidWeb("did:pkh:eip155:1:0xabc")).toThrow();
  });
});

describe("fails closed", () => {
  const url = `https://${DOMAIN}/x`;

  it.each<[string, () => Response]>([
    ["a body that is not JSON", () => respond402("<html>pay me</html>")],
    ["no requirements", () => respond402({ x402Version: 2 })],
    ["empty accepts", () => respond402({ accepts: [] })],
    ["an empty body and no header", () => respond402("")],
    ["a bad header", () => respond402("", { "PAYMENT-REQUIRED": "!!!notbase64" })],
    ["an unknown network", () => respond402({ accepts: [{ ...requirement, network: "Not A Network" }] })],
    ["an invalid address", () => respond402({ accepts: [{ ...requirement, payTo: "0x123" }] })],
  ])("on %s", async (_name, response) => {
    await expect(guardAgainst(response)(url)).rejects.toBeInstanceOf(RedlineBlockedError);
  });

  it("when the check itself throws", async () => {
    const guarded = withRedline((async () => respond402({ accepts: [requirement] })) as typeof fetch, { redline: { check: () => Promise.reject(new Error("api down")) } });
    const error = (await guarded(url).catch((e: unknown) => e)) as RedlineBlockedError;
    expect(error).toBeInstanceOf(RedlineBlockedError);
    expect(error.verdict).toBeNull();
    expect(error.message).toContain("api down");
  });

  it("when the request host is not a usable domain", async () => {
    await expect(guardAgainst(() => respond402({ accepts: [requirement] }))("http://127.0.0.1:3000/x")).rejects.toBeInstanceOf(RedlineBlockedError);
  });

  it("on a HOLD", async () => {
    const error = (await guardAgainst(() => respond402({ accepts: [requirement] }))("https://not-listed.com/x").catch((e: unknown) => e)) as RedlineBlockedError;
    expect(error).toBeInstanceOf(RedlineBlockedError);
    expect(error.verdict).toBe("HOLD");
    expect(error.reasons[0]?.code).toBe("NOT_IN_REGISTRY");
  });

  it("does not catch a network failure as a verdict, since nothing was offered", async () => {
    const guarded = withRedline((() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch, { redline });
    await expect(guarded(url)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("several payment options", () => {
  const url = `https://${DOMAIN}/x`;
  const poisoned = { ...requirement, payTo: lookalikeAddress(REAL) };
  const unverified = { ...requirement, network: "eip155:1", payTo: `0x${"77".repeat(20)}` };

  it("stops everything if any option is a BLOCK, even with a good one first", async () => {
    await expect(guardAgainst(() => respond402({ accepts: [requirement, poisoned] }))(url)).rejects.toMatchObject({ verdict: "BLOCK" });
  });

  it("removes options that got HOLD, so the payer can only choose a PAY", async () => {
    const response = await guardAgainst(() => respond402({ accepts: [unverified, requirement] }))(url);
    expect(response.status).toBe(402);
    expect(((await response.json()) as { accepts: unknown[] }).accepts).toEqual([requirement]);
  });

  it("checks the header too, because a client may pay from it instead of the body", async () => {
    const header = Buffer.from(JSON.stringify({ accepts: [poisoned] })).toString("base64");
    await expect(guardAgainst(() => respond402({ accepts: [requirement] }, { "PAYMENT-REQUIRED": header }))(url)).rejects.toMatchObject({ verdict: "BLOCK" });
  });

  it("filters the header as well as the body", async () => {
    const header = Buffer.from(JSON.stringify({ accepts: [unverified, requirement] })).toString("base64");
    const response = await guardAgainst(() => respond402({ accepts: [unverified, requirement] }, { "PAYMENT-REQUIRED": header }))(url);
    const decoded = JSON.parse(Buffer.from(response.headers.get("PAYMENT-REQUIRED") ?? "", "base64").toString()) as { accepts: unknown[] };
    expect(decoded.accepts).toEqual([requirement]);
  });
});

describe("networkToChain", () => {
  it.each([
    ["base-sepolia", "eip155:84532"],
    ["eip155:84532", "eip155:84532"],
    ["solana-devnet", "solana:devnet"],
    ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "solana:devnet"],
    ["near-testnet", "near:testnet"],
  ])("maps %s to %s", (network, chain) => {
    expect(networkToChain(network)).toBe(chain);
  });

  it("rejects an unknown name", () => {
    expect(() => networkToChain("moonbase")).toThrow(/Unknown/);
  });
});

describe("x402 client hook", () => {
  let hook: (context: { selectedRequirements: unknown; paymentRequired?: unknown }) => Promise<{ abort: true; reason: string } | void>;
  const client = {
    onBeforePaymentCreation(registered: typeof hook) {
      hook = registered;
      return client;
    },
  };
  const paymentRequired = { accepts: [requirement], resource: { url: `https://${DOMAIN}/x` } };

  beforeEach(() => {
    expect(withRedline(client, { redline })).toBe(client);
  });

  it("allows a PAY", async () => {
    await expect(hook({ selectedRequirements: requirement, paymentRequired })).resolves.toBeUndefined();
  });

  it("aborts a look-alike", async () => {
    const result = await hook({ selectedRequirements: { ...requirement, payTo: lookalikeAddress(REAL) }, paymentRequired });
    expect(result).toMatchObject({ abort: true });
    expect(result?.reason).toContain("LOOKALIKE_ACCOUNT");
  });

  it("aborts when it cannot tell which site the payment is for", async () => {
    await expect(hook({ selectedRequirements: requirement })).resolves.toMatchObject({ abort: true });
  });
});

describe("withRedline", () => {
  it("rejects anything that is neither a fetch nor a client", () => {
    expect(() => withRedline({} as never, { redline })).toThrow(TypeError);
  });
});
