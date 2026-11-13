---
title: Payee checks
description: Ask whether an account is safe to pay before your agent pays it.
---

Wardline checks the other half of a payment too: who gets the money. A payee check answers one question before money moves: is this account linked to the vendor it claims to belong to?

## Resolve or check

| You have | Call | You get |
| --- | --- | --- |
| The vendor's website | `resolve` | The account linked to that domain, so your agent never handles a raw address |
| A raw address, from an invoice, an email or an x402 offer | `check` | A verdict on that account |

::developer-tabs{path=vendors}

Accounts are written as CAIP-10 strings, for example `near:testnet:northwind.testnet`, `eip155:84532:0xabc...` or `solana:devnet:7xKX...`. A bare NEAR account id is also accepted.

## Verdicts

Every check returns one of three verdicts and the reasons behind it.

| Verdict | What to do | Reasons you can see |
| --- | --- | --- |
| `PAY` | Pay. The account is linked to this vendor's domain and nothing looks wrong | |
| `HOLD` | Don't pay. Send it to a human | `NOT_IN_REGISTRY`, `CHAIN_NOT_VERIFIED`, `COOLING_OFF`, `NEW_ACCOUNT`, `RECENT_FULL_ACCESS_KEY`, `RECENT_CODE_CHANGE`, `PAYEE_CHANGED`, `SIGNALS_UNAVAILABLE` |
| `BLOCK` | Never pay | `ACCOUNT_MISSING`, `LOOKALIKE_ACCOUNT`, `ACCOUNT_NOT_VENDORS` |

:::important
If a call fails or returns an error, there is no verdict. Do not pay.
:::

## Evidence tiers

Every answer carries an `evidenceTier`. It says what was verified. It never claims legal ownership.

| Tier | What it means |
| --- | --- |
| `T0_NONE` | Nothing is verified for this vendor and account |
| `T1_WALLET_CONTROL` | The account signed Wardline's challenge |
| `T2_DOMAIN_LINKED` | T1, and the vendor's domain lists the account. `PAY` needs at least this |
| `T3_RELATIONSHIP` | T2, and your owner approved the account or you paid it before. Needs your API key |
| `T4_EXTERNAL_KYB` | Reserved for an outside business-verification provider. Never set today |

## Receipts

A hosted answer carries an ed25519 receipt signed by the Wardline API. It covers the verdict, the reasons and the evidence tier. The public key is at `/.well-known/wardline-attestor.json`, and `verifyReceipt(result, publicKey, { request })` checks one. Direct mode has no receipts, because nothing leaves your machine.

## For vendors

To be payable, a vendor links its payout accounts to its domain:

1. Serve `https://<domain>/.well-known/wardline-payee.json`, signed by each payout account.
2. Send `POST /v1/vendors/verify` with `{"domain": "<domain>"}`.

That gives `T2_DOMAIN_LINKED`. The guided version is **Verify your business** in the app. A new account added to a domain that is already linked waits out a cooling-off period before anyone can pay it, so a stolen website can't redirect payments at once.

## Limits

The free tier is 200 calls a day per IP address. Past that the API answers `402` with x402 payment requirements of 0.01 USDC per call. Paying that fee isn't available yet.
