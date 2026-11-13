---
title: API reference
description: Every route, grouped by what it is for, with how each one is signed or keyed.
---

All routes are under your Wardline API's base address. Request and response bodies are JSON.

## Authentication

| You call | You send |
| --- | --- |
| The AI gateway | `Authorization: Bearer wk_...`, a meter key |
| Payee checks, free tier | Nothing. Limited to 200 calls a day per IP |
| Payee checks as a payer | `Authorization: Bearer rk_...`, an API key. Recording payments needs the `record` scope |
| Deposit, redeem, vote, propose | A signature from the holder's NEAR wallet. See [Wallet-signed actions](#/docs/api-reference/wallet-signed-actions) |

## AI gateway

| Route | Use |
| --- | --- |
| `POST /v1/ai/chat/completions` | An OpenAI-compatible chat call, paid on proof. Non-streaming only |
| `GET /v1/ai/models` | The models you can call |
| `GET /v1/ai/calls/{call_id}` | A call with its proof |
| `GET /v1/ai/budgets/{budget_id}` | A budget's balance and spending |
| `GET /v1/ai-registry` | The signers attested for each model |

## The Mutual

| Route | Use |
| --- | --- |
| `GET /v1/mutual` | Everything the home page shows: the pool, WARD's price, payouts, the groups, tier rules and proposals |
| `GET /v1/pool` | The pool: its assets, WARD supply and price |
| `GET /v1/mutual/proposals` | Every proposal |
| `GET /v1/mutual/proposals/{id}/weight/{account}` | An account's snapshot weight on a proposal |
| `POST /v1/mutual/proposals/{id}/execute` | Execute a passed proposal. Anyone, once |

## Groups and reputation

| Route | Use |
| --- | --- |
| `GET /v1/groups` | Every group and the tier rules |
| `GET /v1/reputation/{budget_id}` | One group's tier, counts, fee and coverage cap |

## Payee checks

| Route | Use |
| --- | --- |
| `POST /v1/resolve` | The account linked to a vendor's domain |
| `POST /v1/check` | A verdict on a raw account |
| `GET /v1/vendors` | Known vendors |
| `GET /v1/vendors/{domain}` | One vendor |
| `POST /v1/vendors/verify` | Ask Wardline to verify a vendor's `wardline-payee.json` |
| `POST /v1/payments/record` | Record a payment. Needs a key with the `record` scope, or the payer's NEAR signature |
| `GET /.well-known/wardline-attestor.json` | The public key that signs receipts |

## Wallet-signed actions

Deposit, redeem, vote and propose are signed by the holder's own NEAR wallet, and Wardline never holds the key.

1. `POST /v1/pool/challenge` with `{ "account": "...", "action": "deposit" | "withdraw" | "redeem" | "vote" | "propose", ... }`. You get a message to sign.
2. Sign the message with the wallet, using NEP-413 with the recipient `wardline-mutual`.
3. `POST /v1/pool/submit` with the signed message.

## Proposal types for group DAOs

A group run by a Sputnik DAO uses these proposals, built by `@wardline/dao-adapter`.

| Decision | Proposal | Action |
| --- | --- | --- |
| Fund a budget | `Transfer` with a message | `ft_transfer_call` with `{"action":"fund","budget_id":"..."}` |
| Set an allowance | `FunctionCall` | `meter.set_allowance({budget_id, member, allowance})` |
| Add a model provider | `FunctionCall` | `registry.add_provider({provider_id, pay_to, model_ids})` |
| Approve a vendor's new payout account | `FunctionCall` | `vault.approve_endpoint({vendor_id, revision, account})` |
| Change a pool setting | `FunctionCall` | `pool.set_param({name, value})` |
| Approve a claim | `FunctionCall` | `pool.approve_claim({claim_id})` |
