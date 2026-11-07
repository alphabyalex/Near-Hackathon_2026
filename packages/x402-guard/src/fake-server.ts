import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";
import canonicalize from "canonicalize";

export type FakeServerMode = "honest" | "malicious";

export interface FakeServerOptions {
  mode: FakeServerMode;
  /** The website this server stands in for. */
  domain: string;
  /** The vendor's real EVM payout address. */
  realPayTo: string;
  network?: string;
  asset?: string;
  amount?: string;
  /** Also sign offers with the site's did:web key. Malicious mode then signs the swapped address with it. */
  signOffers?: boolean;
  /** Clock for offer expiry, in Unix seconds. */
  nowSeconds?: () => number;
}

export interface FakeServer {
  readonly url: string;
  readonly resourceUrl: string;
  readonly payTo: string;
  /** Every simulated payment the server received. No funds or facilitator are involved. */
  readonly payments: { payTo: string }[];
  /** A fetch that sends https://<domain>/... to this local server. */
  fetch: typeof fetch;
  listen(): Promise<void>;
  close(): Promise<void>;
}

/** Same first 4 and last 4 hex characters, different middle: what address poisoning looks like. */
export function lookalikeAddress(real: string): string {
  const middle = real.slice(6, -4).replace(/[0-9a-f]/g, (c) => ((Number.parseInt(c, 16) + 1) % 16).toString(16));
  return `${real.slice(0, 6)}${middle}${real.slice(-4)}`;
}

const encodeJson = (value: unknown): string => {
  const text = canonicalize(value);
  if (text === undefined) throw new Error("not JSON");
  return base64urlnopad.encode(new TextEncoder().encode(text));
};

/** A local stand-in for a paid API, for tests and walkthroughs. It never touches a chain. */
export function createFakeX402Server(options: FakeServerOptions): FakeServer {
  const network = options.network ?? "eip155:84532";
  const asset = options.asset ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const amount = options.amount ?? "10000";
  const payTo = options.mode === "honest" ? options.realPayTo : lookalikeAddress(options.realPayTo);
  const resourceUrl = `https://${options.domain}/paid/report`;
  const secret = ed25519.utils.randomSecretKey();
  const did = `did:web:${options.domain}`;
  const kid = `${did}#key-1`;
  const payments: { payTo: string }[] = [];
  let server: Server | null = null;
  let base = "";

  const didDocument = () => ({
    id: did,
    verificationMethod: [
      {
        id: kid,
        type: "JsonWebKey2020",
        controller: did,
        publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: base64urlnopad.encode(ed25519.getPublicKey(secret)) },
      },
    ],
  });

  const signedOffer = () => {
    const validUntil = (options.nowSeconds?.() ?? Math.floor(Date.now() / 1000)) + 300;
    const signingInput = `${encodeJson({ alg: "EdDSA", kid })}.${encodeJson({ version: 1, resourceUrl, scheme: "exact", network, asset, payTo, amount, validUntil })}`;
    const signature = base64urlnopad.encode(ed25519.sign(new TextEncoder().encode(signingInput), secret));
    return { format: "jws", acceptIndex: 0, signature: `${signingInput}.${signature}` };
  };

  const paymentRequired = () => ({
    x402Version: 2,
    error: "Payment required",
    resource: { url: resourceUrl, description: "Quarterly report", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network, amount, asset, payTo, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } }],
    extensions: options.signOffers ? { "offer-receipt": { info: { offers: [signedOffer()] } } } : {},
  });

  return {
    get url() {
      return base;
    },
    resourceUrl,
    payTo,
    payments,
    fetch: (input, init) => {
      const original = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const local = `${base}${original.pathname}${original.search}`;
      return globalThis.fetch(input instanceof Request ? new Request(local, input) : local, init);
    },
    listen: () =>
      new Promise((resolve) => {
        server = createServer((req, res) => {
          const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
            res.writeHead(status, { "content-type": "application/json", ...headers });
            res.end(JSON.stringify(body));
          };
          if (req.url === "/.well-known/did.json") return json(200, didDocument());
          if (req.url !== "/paid/report") return json(404, { error: "NOT_FOUND" });
          const signature = req.headers["payment-signature"];
          if (typeof signature === "string") {
            // A real x402 client sends the chosen option under `accepted`. The fake payer sends payTo directly.
            const payment = JSON.parse(Buffer.from(signature, "base64").toString()) as { payTo?: string; accepted?: { payTo: string } };
            payments.push({ payTo: payment.accepted?.payTo ?? payment.payTo ?? "" });
            return json(200, { report: "Q3 figures" });
          }
          const required = paymentRequired();
          return json(402, required, { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString("base64") });
        });
        server.listen(0, "127.0.0.1", () => {
          base = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
          resolve();
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        const running = server;
        server = null;
        if (!running) return resolve();
        running.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** A stand-in for an x402 payment wrapper: on 402 it pays the first option and retries. No funds move. */
export function fakePayingFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const first = await inner(input, init);
    if (first.status !== 402) return first;
    const { accepts } = (await first.json()) as { accepts: { payTo: string }[] };
    const choice = accepts[0];
    if (!choice) throw new Error("Nothing to pay.");
    return inner(input, { ...init, headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify({ payTo: choice.payTo })).toString("base64") } });
  };
}
