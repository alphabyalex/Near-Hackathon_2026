---
title: How a payment is proven
description: The life of one AI call, from the key your agent holds to the money that moves.
---

Every call through the Wardline gateway follows the same path. The path is what makes a payment above the line or below it.

## The life of a call

1. **Your agent calls the gateway** with a meter key, the way it would call any OpenAI-compatible API.
2. **Wardline reserves the most the call can cost** from the member's allowance and the group's budget. If either is used up, the call stops here with a `402` and nothing is sent to a model.
3. **Your request is forwarded unchanged** to NEAR AI Cloud.
4. **Wardline hashes the exact response** and fetches the provider's TEE signature over `<model>:<sha256 request>:<sha256 response>`.
5. **The signer is checked.** The signature must come from a signer attested for the model you asked for, as listed in the model registry.
6. **The money moves, or doesn't.** If the answer is proven, the provider is paid, the unused part of the reservation is released, and the cover fee goes to the pool. If it is not proven, the whole reservation is released.
7. **The response comes back** with an `x-wardline-proof` header that says which it was.

## How a call can end

| Outcome | Side of the line | What you see | What it costs |
| --- | --- | --- | --- |
| Proven and paid | Above | `x-wardline-proof: verified` | The provider's charge, plus the cover fee |
| Swapped or unsigned model | Below | `502` with a refusal code such as `MODEL_MISMATCH` | Nothing: the reservation is released |
| Allowance or budget used up | Below | `402` with `ALLOWANCE_EXHAUSTED` or `BUDGET_EXHAUSTED` | Nothing: no request is sent |
| Provider timeout | Below | `504` | Nothing: refunded |

## What the proof shows

The signature shows which model's secure hardware signed those exact bytes. That is enough to catch a reseller who answers with a cheaper model than the one you paid for.

:::limitation
The proof does not show token counts, and it does not show that an answer is correct. The charge uses the provider's reported usage, capped at the reservation. See [Limits and risks](#/docs/limits-and-risks).
:::

## Where the pieces live

| Piece | Where |
| --- | --- |
| Reservations, settlement and tiers | The meter contract |
| Which signers are attested for which model | The model registry |
| The pool, WARD and WARD-holder votes | The cover pool |

The accounts are listed on [Contracts](#/docs/contracts).
