import { afterEach, describe, expect, it } from "vitest";
import { LLM_SETTINGS, probeNearAi } from "../src/agent-config.js";
import { NearAiClient } from "../src/llm-client.js";

const originalKey = process.env.NEAR_AI_API_KEY;
const originalBase = process.env.NEAR_AI_BASE_URL;
afterEach(() => {
  if (originalKey === undefined) delete process.env.NEAR_AI_API_KEY;
  else process.env.NEAR_AI_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.NEAR_AI_BASE_URL;
  else process.env.NEAR_AI_BASE_URL = originalBase;
});

describe("request settings", () => {
  it("caps reasoning and leaves room for the answer, so replies are not cut off", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/chat/completions")) sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "x", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }) as typeof fetch;
    const client = new NearAiClient({ apiKey: "test-key", baseUrl: "https://ai.invalid/v1", fetch: fetchImpl });
    await client.complete([{ role: "user", content: "hi" }]).catch(() => undefined);
    expect(sent.max_tokens).toBe(LLM_SETTINGS.max_tokens);
    expect(sent.thinking_token_budget).toBe(LLM_SETTINGS.thinking_token_budget);
    expect(LLM_SETTINGS.max_tokens).toBeGreaterThanOrEqual(LLM_SETTINGS.thinking_token_budget + 2000);
  });
});

describe("probeNearAi", () => {
  const respond = (status: number, body: string) => (async () => new Response(body, { status })) as typeof fetch;

  it("passes when the model is listed, without calling chat completions", async () => {
    process.env.NEAR_AI_API_KEY = "test-key";
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: [{ id: "z-ai/glm-5.3-flash" }] }));
    }) as typeof fetch;
    await expect(probeNearAi(fetchImpl)).resolves.toBeNull();
    expect(urls.every((u) => u.endsWith("/models"))).toBe(true);
  });

  it.each([
    [401, "{}", /rejected the key/],
    [500, "{}", /HTTP 500/],
    [200, JSON.stringify({ data: [{ id: "other/model" }] }), /does not list/],
  ])("reports HTTP %s", async (status, body, reason) => {
    process.env.NEAR_AI_API_KEY = "test-key";
    expect(await probeNearAi(respond(status, body))).toMatch(reason);
  });

  it("reports a missing key and an unreachable host", async () => {
    delete process.env.NEAR_AI_API_KEY;
    expect(await probeNearAi(respond(200, ""))).toMatch(/not set/);
    process.env.NEAR_AI_API_KEY = "test-key";
    expect(await probeNearAi((() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch)).toMatch(/unreachable/);
  });
});
