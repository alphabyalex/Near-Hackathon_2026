import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRedline, seedEvmAddress, verifyReceipt, type Redline } from "@redline/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api/src/app.js";
import { bootstrap } from "../../api/src/bootstrap.js";
import { createHttpServer, createMcpServer, redlineFromEnv } from "../src/index.js";

const DOMAIN = "northwind.com";

function apiBackedRedline(): { redline: Redline; app: ReturnType<typeof createApp> } {
  const app = createApp(bootstrap(":memory:"));
  return {
    app,
    redline: createRedline({
      mode: "hosted",
      baseUrl: "http://api.local",
      fetch: ((input: string | URL | Request, init?: RequestInit) => app.request(String(input), init)) as typeof fetch,
    }),
  };
}

const parse = <T>(result: unknown): T => {
  const { content } = result as { content: { text: string }[] };
  return JSON.parse(content[0]?.text ?? "null") as T;
};

describe("MCP tools over the in-memory client", () => {
  let client: Client;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const backed = apiBackedRedline();
    app = backed.app;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(backed.redline).connect(serverSide);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
  });

  afterEach(() => client.close());

  it("lists the four tools, and their descriptions carry the payment rules", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_payee", "get_vendor", "how_to_verify", "resolve_payee"]);
    const describe_ = (name: string) => tools.find((t) => t.name === name)?.description ?? "";
    expect(describe_("resolve_payee")).toContain("whenever you know the vendor's website");
    expect(describe_("check_payee")).toContain("before paying any raw address");
    for (const name of ["resolve_payee", "check_payee"]) {
      expect(describe_(name)).toContain("Pay only on PAY");
      expect(describe_(name)).toContain("HOLD to a human");
      expect(describe_(name)).toContain("Never pay on BLOCK");
    }
  });

  it("uses no restricted wording in tool text", async () => {
    const { tools } = await client.listTools();
    const howTo = await client.callTool({ name: "how_to_verify", arguments: {} });
    const text = JSON.stringify([tools, howTo]).toLowerCase();
    const emDash = String.fromCodePoint(0x2014);
    for (const word of ["hackathon", "demo", "no value", "disclaimer", "guaranteed", emDash]) expect(text).not.toContain(word);
  });

  it("resolve_payee returns the verified account with a checkable receipt", async () => {
    const result = await client.callTool({ name: "resolve_payee", arguments: { domain: DOMAIN, chain: "eip155:84532" } });
    const body = parse<Parameters<typeof verifyReceipt>[0] & { verdict: string; account: string }>(result);
    expect(body).toMatchObject({ verdict: "PAY", account: `eip155:84532:${seedEvmAddress(DOMAIN)}` });
    const { public_key: key } = (await (await app.request("/.well-known/redline-attestor.json")).json()) as { public_key: string };
    expect(verifyReceipt(body, key)).toBe(true);
  });

  it("check_payee BLOCKs a look-alike", async () => {
    const result = await client.callTool({ name: "check_payee", arguments: { payee: "northw1nd.testnet", vendor: { domain: DOMAIN } } });
    expect(parse<{ verdict: string; reasons: { code: string }[] }>(result)).toMatchObject({ verdict: "BLOCK", reasons: [{ code: "LOOKALIKE_ACCOUNT" }] });
  });

  it("get_vendor finds a vendor and reports one it cannot find", async () => {
    expect(parse(await client.callTool({ name: "get_vendor", arguments: { domain: DOMAIN } }))).toMatchObject({ domain: DOMAIN, name: "Northwind Trading" });
    expect(parse(await client.callTool({ name: "get_vendor", arguments: { domain: "not-listed.com" } }))).toEqual({ domain: "not-listed.com", found: false });
  });

  it("how_to_verify gives the signed message", async () => {
    const result = await client.callTool({ name: "how_to_verify", arguments: {} });
    expect(JSON.stringify(result)).toContain("redline-payee:v2:");
  });

  it("gives an error and no verdict when the API refuses", async () => {
    const result = (await client.callTool({ name: "check_payee", arguments: { payee: "eip155:1:0x123" } })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("Do not pay");
    expect(JSON.stringify(result)).not.toContain('"verdict"');
  });

  it("gives an error and no verdict when the API is down", async () => {
    const down = createRedline({ mode: "hosted", baseUrl: "http://api.local", fetch: (() => Promise.reject(new Error("connection refused"))) as typeof fetch });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(down).connect(serverSide);
    const other = new Client({ name: "test", version: "1.0.0" });
    await other.connect(clientSide);
    const result = (await other.callTool({ name: "resolve_payee", arguments: { domain: DOMAIN, chain: "near:testnet" } })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    await other.close();
  });
});

describe("Streamable HTTP at /mcp", () => {
  let http: Server;
  let base: string;

  beforeEach(async () => {
    http = createHttpServer(apiBackedRedline().redline);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise((resolve) => http.close(resolve)));

  it("serves tools to a real HTTP client", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const result = await client.callTool({ name: "resolve_payee", arguments: { domain: DOMAIN, chain: "near:testnet" } });
    expect(parse(result)).toMatchObject({ verdict: "PAY", account: "near:testnet:northwind.testnet" });
    await client.close();
  });

  it("refuses other paths, other methods, bad JSON and a foreign Host", async () => {
    expect((await fetch(`${base}/other`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "POST", body: "{" })).status).toBe(400);
    const { request } = await import("node:http");
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/mcp`, { method: "POST", headers: { host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end("{}");
    });
    expect(status).toBe(403);
  });
});

describe("configuration", () => {
  it("reads the API URL from REDLINE_API_URL", async () => {
    expect(redlineFromEnv({ REDLINE_API_URL: "http://127.0.0.1:9" }).mode).toBe("hosted");
  });

  it("has a server.json the MCP registry can read, matching the package", () => {
    const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8")) as Record<string, unknown> & { description: string; name: string; version: string };
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string; mcpName: string };
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(server.packages)).toContain(pkg.name);
  });
});
