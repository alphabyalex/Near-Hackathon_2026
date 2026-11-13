---
title: Quickstart
description: Point an OpenAI client at Wardline and make your first call that is paid only on proof.
---

This page takes you from nothing to a proven call. It works with any OpenAI-compatible client: the only change is the base URL and the key.

## Before you start

You need a meter key. It starts with `wk_`, and a group's admin creates one per member. If you run the group yourself, create keys in the owner app.

## 1. Change one line

Set the client's base URL to the Wardline gateway and use your meter key as the API key. Nothing else in your code changes.

::developer-tabs{path=ai}

## 2. Make a call

Call the model the way you always do. Wardline sends your request unchanged, checks the response, and decides which side of the line the call lands on.

```ts
const { data, response } = await client.chat.completions
  .create({
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    messages: [{ role: "user", content: "Summarize this invoice." }],
  })
  .withResponse();
```

You get the same answer you would get anyway. Streaming isn't supported: a request with `stream: true` is refused with a `400`.

## 3. Read the proof

Every response carries an `x-wardline-proof` header.

```ts
console.log(response.headers.get("x-wardline-proof")); // "verified" or "refused"
```

- `verified` means a signer attested for that model signed that exact answer, and the call was paid.
- `refused` means it wasn't proven, and you weren't charged.

The other headers and every error code are on [Proof headers and errors](#/docs/proof-headers-and-errors).

## What happens when you run out

When a member's allowance or the budget is used up, the gateway answers `402` before anything reaches a model. Nothing is spent and nothing is lost. See [The spending cap](#/docs/spending-cap).

## Next

- Check who an account belongs to before your agent pays it: [Payee checks](#/docs/payee-checks).
- Use the same checks from TypeScript: [SDK and x402 guard](#/docs/sdk-and-x402).
- Give an AI assistant the tools directly: [MCP server](#/docs/mcp-server).
