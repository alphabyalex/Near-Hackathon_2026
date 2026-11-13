---
title: Proof headers and errors
description: Every response header the gateway sets and every error it can return.
---

The gateway returns the model's own response, plus headers that say what happened and what it cost.

## Response headers

| Header | Value |
| --- | --- |
| `X-Wardline-Proof` | `verified` or `refused` |
| `X-Wardline-Call` | The call's id. Use it to look the call up later |
| `X-Wardline-Settlement` | The settlement for the call |
| `X-Wardline-Model-Proven` | The model whose signer signed the response |
| `X-Wardline-Amount` | What the call cost |
| `X-Wardline-Refund` | What was released back to the budget |

## Errors

| Status | `error.type` | When | Charged |
| --- | --- | --- | --- |
| `402` | `spend_limit_reached` | A member's allowance or the budget's deposit is used up. The code is `ALLOWANCE_EXHAUSTED` or `BUDGET_EXHAUSTED`. | No. Nothing is sent to the model |
| `502` | `proof_refused` | The response wasn't proven. The code says why. | No. The whole reservation is released |
| `504` | | The provider timed out | No. Refunded |
| `400` | | The request isn't allowed, such as `stream: true` | No |

## Refusal codes

A `502` carries one of these codes.

| Code | Meaning |
| --- | --- |
| `MODEL_MISMATCH` | The signature is from a different model than the one asked for |
| `SIGNATURE_MISSING` | The provider returned no signature |
| `RESPONSE_HASH_MISMATCH` | The signature covers a different response than the one received |
| `REPLAYED` | The signature has been used before |
| `SIGNER_NOT_ATTESTED` | The signer isn't attested for this model in the registry |
| `BAD_SIGNATURE_KIND` | The signature is not the expected kind |

## Looking a call up

`GET /v1/ai/calls/{call_id}` returns the call with its proof. In the SDK, `getCall(callId)` returns it and `verifyProof(call, { responseBytes })` checks the proof again on your machine. See [SDK and x402 guard](#/docs/sdk-and-x402).

## Which signers are attested

`GET /v1/ai-registry` lists the signers attested for each model.

:::note
A refusal is not a failure of your code. It is the system doing its job: a payment that couldn't prove itself stayed below the line.
:::
