---
title: SDK and x402 guard
description: Use Wardline from TypeScript, hosted or straight from the chain, and guard x402 payments.
---

The SDK wraps the gateway and the payee checks in typed calls. Install `@wardline/sdk`. The x402 guard is a separate package, `@wardline/x402-guard`.

## Hosted or direct

| Mode | Where the checks run | Use it when |
| --- | --- | --- |
| `hosted` | On the Wardline API. Give agents a check-only key | You want the simplest setup |
| `direct` | In your process, reading the payee registry on NEAR | You don't want Wardline to see who you pay |

::developer-tabs{path=app}

## Check a payee

`assertPayable` throws unless the verdict is `PAY`, so a payment can't go ahead on `HOLD` or `BLOCK`.

```ts
import { createWardline, assertPayable } from "@wardline/sdk";

const wardline = createWardline({ mode: "hosted", baseUrl: "https://your-wardline-api.example" });
const result = await wardline.resolve({ domain: "northwind.example", chain: "near:testnet" });
assertPayable(result);
pay(result.account);
```

In direct mode there is no server in between:

```ts
const wardline = createWardline({ mode: "direct", nearRpcUrl, registryAccount });
```

## Pay for AI calls

In hosted mode, `.openai(OpenAI)` returns an OpenAI client that already points at the gateway with your meter key.

```ts
import OpenAI from "openai";
import { createWardline } from "@wardline/sdk";

const wardline = createWardline({ mode: "hosted", baseUrl: "https://your-wardline-api.example", meterKey: process.env.WARDLINE_METER_KEY });
const client = wardline.openai(OpenAI);
```

`getCall(callId)` returns a call with its proof, and `verifyProof(call, { responseBytes })` re-checks it on your machine without trusting the API.

## The x402 guard

x402 is a way for a server to ask for payment in the response to a request. The guard runs every `402` payment request through a payee check before your agent pays it.

```ts
import { wrapFetchWithPayment } from "x402-fetch";
import { withWardline } from "@wardline/x402-guard";

const pay = wrapFetchWithPayment(withWardline(fetch, { wardline }), x402Client);
```

If the check says `HOLD` or `BLOCK`, the guard stops the payment and your agent never signs it.
