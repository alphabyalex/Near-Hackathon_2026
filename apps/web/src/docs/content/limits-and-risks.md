---
title: Limits and risks
description: What Wardline proves and what it doesn't, what can go wrong, and what is still to come.
---

Read this before you deposit or rely on a verdict. It says plainly where the edges are.

## Where Wardline runs

Wardline runs on NEAR testnet. Nothing in it uses real money, and nothing is on mainnet. Its contracts have not had an independent audit.

Parts of the app can also run on a simulated chain. A simulated transaction is labelled as one and has no explorer link, so anything with a **View transaction** link is a real testnet transaction.

## What the proof shows, and what it doesn't

| It shows | It doesn't show |
| --- | --- |
| Which model's secure hardware signed those exact bytes | Token counts: the charge uses the provider's reported usage, capped at the reservation |
| That the signer is attested for the model you asked for | That an answer is correct or useful |
| That the response wasn't swapped or replayed | What happened outside the model's hardware, such as your prompt or your own code |

## Risks to WARD holders

- **WARD can lose value.** A payout larger than Wardline's stake is taken from WARD holders, and WARD's price falls by that amount.
- **Yield isn't promised.** It depends on how much proven spending runs through the pool, and it can stop.
- **It isn't insurance.** The Mutual pays out of what it holds, and a claim above its threshold needs a vote.
- **The sell wait is real.** Redeeming takes the sell wait, and a market price can differ from the pool's.

## Limits of the gateway

- Chat completions only, and non-streaming: a request with `stream: true` is refused with a `400`.
- A provider timeout ends the call with a `504`, and the reservation is refunded.
- The set of models is the set attested in the model registry.

## Limits of payee checks

- A verdict says what was verified about an account. It never claims legal ownership.
- `T4_EXTERNAL_KYB` is reserved and never set today.
- The free tier is 200 calls a day per IP. Paying the 0.01 USDC fee for more isn't available yet.

## Governance today

The voting rules, a three-day window and a 20% quorum, are the contract's defaults. The community that holds WARD on testnet is small, so a vote there shows the mechanism and doesn't show how a large holder base would behave.

:::important
If anything here conflicts with something the app shows, the contract is the authority. See [Contracts](#/docs/contracts).
:::
