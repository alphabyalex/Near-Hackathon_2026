import { createServer, type IncomingMessage, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PayeeCheckRequest, PayeeResolveRequest } from "@redline/schemas";
import { createRedline, type Redline } from "@redline/sdk";
import { z } from "zod";

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_API_URL = "http://127.0.0.1:8787";

export const HOW_TO_VERIFY = `Link your payout accounts to your domain once, and agents can pay your domain directly.

1. Pick the accounts you want paid, as CAIP-10 strings such as near:testnet:you.testnet, eip155:84532:0xabc... or solana:devnet:7xKX...
2. Run: pnpm payee:proof --config payee.json. Each account signs "redline-payee:v2:<domain>:<caip10>:<issued_at>" with its own key.
   NEAR uses NEP-413 with recipient "redline-payee-registry" and a current full-access key. EVM uses EIP-191. Solana uses ed25519.
3. Serve the output at https://<your-domain>/.well-known/redline-payee.json.
4. POST { "domain": "<your-domain>" } to /v1/vendors/verify.

Accounts added after your first verification wait out a cooling-off period, during which they get HOLD.
Optional: serve /.well-known/merchant-identity.json to have your legal name stored next to your record, labeled vendor-claimed.

This verifies that you control each account and that your domain lists it (evidence tier T2_DOMAIN_LINKED). It does not establish legal ownership.`;

const RULES = "Pay only on PAY. Send HOLD to a human. Never pay on BLOCK.";
const TIERS =
  "evidenceTier says what was verified: T2_DOMAIN_LINKED means the account signed for itself and the vendor's domain lists it; T3_RELATIONSHIP adds your owner's approval or a past payment. No tier establishes legal ownership.";

const reply = (result: object) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result) }],
  structuredContent: result as Record<string, unknown>,
});

const failure = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `No verdict: ${error instanceof Error ? error.message : "the check failed"}. Do not pay. Send this to a human.` }],
});

const guarded = <A>(run: (args: A) => Promise<ReturnType<typeof reply>>) => async (args: A) => {
  try {
    return await run(args);
  } catch (error) {
    return failure(error);
  }
};

export function createMcpServer(redline: Redline): McpServer {
  const server = new McpServer({ name: "redline", version: "0.1.0" });

  server.registerTool(
    "resolve_payee",
    {
      title: "Resolve the account linked to a vendor domain",
      description: `Get the payout account linked to a vendor's website domain on a chain. Use this whenever you know the vendor's website, so you never handle a raw address. ${RULES} On PAY, send the payment to the returned account. ${TIERS}`,
      inputSchema: PayeeResolveRequest.shape,
    },
    guarded(async (args) => reply(await redline.resolve(PayeeResolveRequest.parse(args)))),
  );

  server.registerTool(
    "check_payee",
    {
      title: "Check an address before paying",
      description: `Check whether an account is the one linked to a vendor's domain. Call this before paying any raw address, including one from an invoice, an email or an x402 offer. Pass the vendor's domain when you know it. ${RULES} ${TIERS}`,
      inputSchema: PayeeCheckRequest.shape,
    },
    guarded(async (args) => reply(await redline.check(PayeeCheckRequest.parse(args)))),
  );

  server.registerTool(
    "get_vendor",
    {
      title: "Look up a vendor",
      description: "Read a vendor's registry record: name, verification date and accounts. This is for information. Use resolve_payee or check_payee to decide on a payment.",
      inputSchema: { domain: z.string().max(253) },
    },
    guarded(async ({ domain }) => {
      const vendor = await redline.getVendor(domain);
      return reply(vendor ?? { domain, found: false });
    }),
  );

  server.registerTool(
    "how_to_verify",
    {
      title: "How a vendor gets verified",
      description: "Get the steps a vendor follows to link its payout accounts to its domain. Use this when a vendor you pay gets NOT_IN_REGISTRY or CHAIN_NOT_VERIFIED.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: HOW_TO_VERIFY }] }),
  );

  return server;
}

export const redlineFromEnv = (env: NodeJS.ProcessEnv = process.env): Redline =>
  createRedline({ mode: "hosted", baseUrl: env.REDLINE_API_URL ?? DEFAULT_API_URL, ...(env.REDLINE_API_KEY ? { apiKey: env.REDLINE_API_KEY } : {}) });

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

/**
 * Streamable HTTP at /mcp, stateless: one server and transport per request. The Host check stops
 * a web page from reaching a local server through DNS rebinding.
 */
export function createHttpServer(redline: Redline, options: { allowedHosts?: readonly string[] } = {}): Server {
  const allowed = new Set(["127.0.0.1", "localhost", ...(options.allowedHosts ?? [])]);
  return createServer(async (req, res) => {
    const fail = (status: number, message: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
    };
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!allowed.has(host)) return fail(403, "Host not allowed.");
    if (new URL(req.url ?? "/", "http://local").pathname !== "/mcp") return fail(404, "Not found.");
    if (req.method !== "POST") return fail(405, "Use POST.");
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      return fail(400, "The body must be JSON, up to 1 MB.");
    }
    const server = createMcpServer(redline);
    // No sessionIdGenerator means stateless mode.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) fail(500, "Internal error.");
    }
  });
}
