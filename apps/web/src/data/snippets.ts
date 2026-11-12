import { DEVELOPERS } from "../brand";
import type { CodeTab } from "../components/CodeTabs";
import { PAYEE_REGISTRY, SNIPPET_API_URL, SNIPPET_MCP_URL } from "../config";

/** Every snippet shows a real URL: configured, hosted, local, or the named placeholder (see config.ts). */
export function snippets(apiUrl: string, mcpUrl: string) {
  const shellBase = apiUrl;
  const tsBase = JSON.stringify(apiUrl);
  const jsBase = JSON.stringify(`${apiUrl}/v1/ai`);
  const pyBase = JSON.stringify(`${apiUrl}/v1/ai`);
  return {
    openaiJs: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: ${jsBase},
  apiKey: process.env.WARDLINE_METER_KEY,
});

const { data, response } = await client.chat.completions
  .create({
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    messages: [{ role: "user", content: "Summarize this invoice." }],
  })
  .withResponse();
// verified, or the call was refunded
console.log(response.headers.get("x-wardline-proof"));`,
    openaiPy: `import os
from openai import OpenAI

client = OpenAI(
    base_url=${pyBase},
    api_key=os.environ["WARDLINE_METER_KEY"],
)

raw = client.chat.completions.with_raw_response.create(
    model="deepseek-ai/DeepSeek-V4.1-Flash-1017",
    messages=[{"role": "user", "content": "Summarize this invoice."}],
)
print(raw.headers["x-wardline-proof"])  # verified, or the call was refunded
reply = raw.parse()`,
    openaiCurl: `curl -si ${shellBase}/v1/ai/chat/completions \\
  -H "authorization: Bearer $WARDLINE_METER_KEY" \\
  -H 'content-type: application/json' \\
  -d '{"model":"deepseek-ai/DeepSeek-V4.1-Flash-1017",
       "messages":[{"role":"user","content":"Summarize this invoice."}]}'

# x-wardline-proof: verified, or the call was refunded`,
    mcp: JSON.stringify({ mcpServers: { wardline: { type: "http", url: mcpUrl } } }, null, 2),
    resolve: `curl -s ${shellBase}/v1/resolve \\
  -H 'content-type: application/json' \\
  -d '{"domain":"northwind.example","chain":"near:testnet"}'`,
    check: `curl -s ${shellBase}/v1/check \\
  -H 'content-type: application/json' \\
  -d '{"payee":"near:testnet:northw1nd.testnet",
       "vendor":{"domain":"northwind.example"}}'`,
    hosted: `import { createWardline, assertPayable } from "@wardline/sdk";

const wardline = createWardline({
  mode: "hosted",
  baseUrl: ${tsBase},
  apiKey: process.env.WARDLINE_API_KEY, // check-only key for agents
});

const result = await wardline.resolve({ domain: "northwind.example", chain: "near:testnet" });
assertPayable(result, { minTier: "T2_DOMAIN_LINKED" }); // throws on HOLD or BLOCK
// pay result.account`,
    direct: `import { createWardline, assertPayable } from "@wardline/sdk";

const wardline = createWardline({
  mode: "direct",
  nearRpcUrl: "https://test.rpc.fastnear.com",
  registryAccount: ${JSON.stringify(PAYEE_REGISTRY)},
});

const result = await wardline.check({
  payee: "eip155:84532:0x...",
  vendor: { domain: "northwind.example" },
});
assertPayable(result);`,
    x402: `import { createWardline } from "@wardline/sdk";
import { withWardline } from "@wardline/x402-guard";
import { wrapFetchWithPayment } from "@x402/fetch";

const wardline = createWardline({ mode: "hosted", baseUrl: ${tsBase} });

// The guard sits inside the payment wrapper, so it sees every 402 first.
const pay = wrapFetchWithPayment(withWardline(fetch, { wardline }), x402Client);`,
  };
}

/** The one-line plug-in (the OpenAI base URL change) in JavaScript, Python and curl. Home reuses it. */
export function pluginSnippets(apiUrl: string = SNIPPET_API_URL): { js: string; py: string; curl: string } {
  const s = snippets(apiUrl, SNIPPET_MCP_URL);
  return { js: s.openaiJs, py: s.openaiPy, curl: s.openaiCurl };
}

/** The line each snippet hinges on, for CodeTabs' highlight. */
export const ONE_LINE = {
  openaiJs: "baseURL:",
  openaiPy: "base_url=",
  openaiCurl: "/v1/ai/chat/completions",
  mcp: '"url":',
  mcpUrl: [1],
  check: "/v1/check",
  resolve: "/v1/resolve",
  x402: "withWardline(fetch",
  hosted: "assertPayable(result,",
  direct: "assertPayable(result);",
} as const satisfies Record<string, string | readonly number[]>;

/** The plug-in as CodeTabs tabs, ready for <CodeTabs tabs={pluginTabs()} label="..." />. */
export function pluginTabs(apiUrl: string = SNIPPET_API_URL): CodeTab[] {
  const p = pluginSnippets(apiUrl);
  return [
    { id: "js", label: DEVELOPERS.tabs.js, code: p.js, highlight: ONE_LINE.openaiJs },
    { id: "py", label: DEVELOPERS.tabs.py, code: p.py, highlight: ONE_LINE.openaiPy },
    { id: "curl", label: DEVELOPERS.tabs.curl, code: p.curl, highlight: ONE_LINE.openaiCurl },
  ];
}

export type DeveloperPathId = keyof typeof DEVELOPERS.paths;
export const DEVELOPER_PATHS: readonly DeveloperPathId[] = ["ai", "vendors", "app"];

/** All eight integrations, sorted into the three things people build. llms.txt is linked from every path. */
export function developerTabs(apiUrl: string = SNIPPET_API_URL, mcpUrl: string = SNIPPET_MCP_URL): Record<DeveloperPathId, CodeTab[]> {
  const s = snippets(apiUrl, mcpUrl);
  const t = DEVELOPERS.tabs;
  const n = DEVELOPERS.notes;
  return {
    ai: [
      { id: "js", label: t.js, code: s.openaiJs, highlight: ONE_LINE.openaiJs, note: n.openai },
      { id: "py", label: t.py, code: s.openaiPy, highlight: ONE_LINE.openaiPy, note: n.openai },
      { id: "curl", label: t.curl, code: s.openaiCurl, highlight: ONE_LINE.openaiCurl, note: n.openai },
    ],
    vendors: [
      { id: "mcp", label: t.mcp, code: s.mcp, highlight: ONE_LINE.mcp, note: n.mcp },
      { id: "mcp-url", label: t.mcpUrl, code: mcpUrl, highlight: [...ONE_LINE.mcpUrl], note: n.mcpUrl },
      { id: "check", label: t.check, code: s.check, highlight: ONE_LINE.check, note: n.check },
      { id: "resolve", label: t.resolve, code: s.resolve, highlight: ONE_LINE.resolve, note: n.resolve },
      { id: "x402", label: t.x402, code: s.x402, highlight: ONE_LINE.x402, note: n.x402 },
    ],
    app: [
      { id: "hosted", label: t.hosted, code: s.hosted, highlight: ONE_LINE.hosted, note: n.hosted },
      { id: "direct", label: t.direct, code: s.direct, highlight: ONE_LINE.direct, note: n.direct },
      { id: "curl", label: t.curl, code: s.resolve, highlight: ONE_LINE.resolve, note: n.curl },
    ],
  };
}
