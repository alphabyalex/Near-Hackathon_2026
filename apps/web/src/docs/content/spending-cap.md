---
title: The spending cap
description: Why a leaked key can't drain a budget, and what stops it.
---

An agent's key is the part most likely to leak. Wardline is built so that a leaked key can do only a small, known amount of harm.

## Two limits, both enforced

A call can spend only what both of these allow:

1. **The member's allowance.** The most that one member can spend in a day, a week or a month.
2. **The budget's deposit.** The USDC the group has put in. Nothing can spend past it.

Both are checked before a call is sent to a model. If either is used up, the gateway answers `402` and nothing leaves.

## Reserve first, pay on proof

For every call, Wardline reserves the most the call can cost, then pays only what the proven response actually used. An unproven response releases the whole reservation. A key can never owe more than a reservation, because nothing is paid without one.

## If a key leaks

| What a leaked meter key can do | What it can't do |
| --- | --- |
| Spend up to that member's remaining allowance, on models that are on the list | Spend past the budget's deposit |
| | Spend another member's allowance |
| | Withdraw or move the budget's USDC |
| | Change allowances, tiers or fees |

Because a meter key belongs to one member, retiring it doesn't touch anyone else's. The damage is bounded by an allowance you chose, not by whatever is in the wallet.

## On the chain

The gateway itself acts on the meter contract with a function-call key. That key can call `reserve`, `settle` and `release` and nothing else, so even the gateway can't move money in any other way.

:::note
A cap limits harm. It doesn't make a payment correct. Proof is what makes a payment correct: the cap is what is left when everything else fails. See [How a payment is proven](#/docs/how-it-works).
:::
