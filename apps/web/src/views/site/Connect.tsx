import { CONNECT } from "../../brand";
import { CodeBlock } from "../../components/CodeBlock";
import { API_URL, MCP_URL } from "../../config";

/** Every snippet uses the configured URL, or a variable the reader sets. */
export function snippets(apiUrl: string | null, mcpUrl: string | null) {
  const shellBase = apiUrl ?? "$WARDLINE_API_URL";
  const tsBase = apiUrl ? JSON.stringify(apiUrl) : "process.env.WARDLINE_API_URL!";
  const jsBase = apiUrl ? JSON.stringify(`${apiUrl}/v1/ai`) : "`${process.env.WARDLINE_API_URL}/v1/ai`";
  const pyBase = apiUrl ? JSON.stringify(`${apiUrl}/v1/ai`) : 'os.environ["WARDLINE_API_URL"] + "/v1/ai"';
  return {
    openaiJs: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: ${jsBase}, // the one line
  apiKey: process.env.WARDLINE_METER_KEY,
});

const { data, response } = await client.chat.completions
  .create({ model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", messages: [{ role: "user", content: "Summarize this invoice." }] })
  .withResponse();
console.log(response.headers.get("x-wardline-proof")); // verified, or the call was refunded`,
    openaiPy: `import os
from openai import OpenAI

client = OpenAI(
    base_url=${pyBase},  # the one line
    api_key=os.environ["WARDLINE_METER_KEY"],
)

raw = client.chat.completions.with_raw_response.create(
    model="deepseek-ai/DeepSeek-V4.1-Flash-1017",
    messages=[{"role": "user", "content": "Summarize this invoice."}],
)
print(raw.headers["x-wardline-proof"])  # verified, or the call was refunded
reply = raw.parse()`,
    mcp: mcpUrl ? JSON.stringify({ mcpServers: { wardline: { type: "http", url: mcpUrl } } }, null, 2) : null,
    resolve: `curl -s ${shellBase}/v1/resolve \\
  -H 'content-type: application/json' \\
  -d '{"domain":"northwind.example","chain":"near:testnet"}'`,
    check: `curl -s ${shellBase}/v1/check \\
  -H 'content-type: application/json' \\
  -d '{"payee":"near:testnet:northw1nd.testnet","vendor":{"domain":"northwind.example"}}'`,
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
  registryAccount: "payees.redline-labs.testnet",
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

function Block({ title, line, children }: { title: string; line?: string; children: React.ReactNode }) {
  return (
    <div className="conn">
      <div className="conn-head">
        <h2>{title}</h2>
        {line && <p>{line}</p>}
      </div>
      <div className="conn-body">{children}</div>
    </div>
  );
}

export function Connect() {
  const s = snippets(API_URL, MCP_URL);
  return (
    <main>
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <span className="label">{CONNECT.label}</span>
          <h1 className="h2">{CONNECT.title}</h1>
          <p className="lede">{CONNECT.lede}</p>
        </div>
      </section>
      <section className="sec tight">
        <div className="wrap">
          {!API_URL && (
            <div className="unset" role="note" data-unset="api">
              <b>{CONNECT.unsetTitle}</b>
              <span>{CONNECT.unsetBody}</span>
            </div>
          )}
          <div className="conns">
            <Block title={CONNECT.openai} line={CONNECT.openaiLine}>
              <CodeBlock code={s.openaiJs} label={`${CONNECT.openaiJs} OpenAI client`} language="js" />
              <CodeBlock code={s.openaiPy} label={`${CONNECT.openaiPy} OpenAI client`} language="py" />
            </Block>
            <Block title={CONNECT.mcp} line={CONNECT.mcpLine}>
              {MCP_URL && s.mcp ? (
                <>
                  <CodeBlock code={MCP_URL} label="MCP URL" language="url" />
                  <CodeBlock code={s.mcp} label="MCP client config" language="json" />
                </>
              ) : (
                <p className="unset-line" data-unset="mcp">
                  {CONNECT.unsetMcp}
                </p>
              )}
            </Block>
            <Block title={CONNECT.resolve}>
              <CodeBlock code={s.resolve} label="curl resolve example" language="sh" />
            </Block>
            <Block title={CONNECT.check}>
              <CodeBlock code={s.check} label="curl check example" language="sh" />
            </Block>
            <Block title={CONNECT.sdkHosted}>
              <CodeBlock code={s.hosted} label="SDK hosted quickstart" language="ts" />
            </Block>
            <Block title={CONNECT.sdkDirect} line={CONNECT.sdkDirectLine}>
              <CodeBlock code={s.direct} label="SDK direct quickstart" language="ts" />
            </Block>
            <Block title={CONNECT.x402}>
              <CodeBlock code={s.x402} label="x402 guard snippet" language="ts" />
            </Block>
            <Block title={CONNECT.llms} line={CONNECT.llmsLine}>
              <a className="link" href="/llms.txt">
                /llms.txt
              </a>
            </Block>
          </div>
        </div>
      </section>
    </main>
  );
}
