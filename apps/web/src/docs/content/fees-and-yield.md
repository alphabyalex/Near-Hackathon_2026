---
title: Fees and yield
description: Where the pool's earnings come from and what moves WARD's price.
---

The Mutual earns from one thing: a cover fee on every proven AI payment. There is no other source of yield.

## The cover fee

When a call is proven, the meter pays the provider and then sends the cover fee to the pool. The fee is a share of the payment, set by the group's tier:

| Tier | Cover fee |
| --- | --- |
| Bronze | 2.00% |
| Silver | 1.50% |
| Gold | 1.00% |

Every group starts at Bronze, so 2% is the usual rate. A clean record lowers it. See [Tiers and reputation](#/docs/tiers-and-reputation).

## How the fee reaches WARD holders

The fee goes to the pool in the same transaction that settles the call. The pool counts it as fee income, which adds to the USDC that belongs to WARD holders without creating any new WARD.

The same USDC now sits behind the same WARD, so each WARD is worth more. That is the whole mechanism: the price rises, and no one has to claim anything.

## What moves the price

| Event | Effect on WARD's price |
| --- | --- |
| A proven payment | Rises by the cover fee, shared across all WARD |
| A deposit | None: WARD is minted at today's price |
| A redemption | None: WARD is burned at today's price |
| A payout smaller than Wardline's stake | None: the stake pays first |
| A payout larger than Wardline's stake | Falls by the part WARD holders cover |

## What the yield is, and isn't

The yield depends on how much proven spending runs through the pool. It can be high one week and low the next, and it can stop. Wardline doesn't quote a rate, and the app doesn't either: it shows today's price and how far it has moved from 1.0000.

:::note
Nothing is paid out as a separate reward. Your share grows in WARD's price, and you collect it when you [redeem](#/docs/redeem-and-sell-wait).
:::
