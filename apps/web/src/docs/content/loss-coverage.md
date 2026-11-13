---
title: Loss coverage
description: What the Mutual pays back when Wardline approves something it shouldn't have, and who pays first.
---

The proof engine is built so losses are rare. When one still happens, the Mutual pays the customer back, and the order of who pays is fixed.

## Who pays first

1. **Wardline's own stake.** This is the first-loss tranche, held in the pool by Wardline. It pays before anyone else's capital is touched.
2. **WARD holders.** Only what is left after the stake is drawn from the WARD holders' side of the pool, and WARD's price falls by that amount.

So WARD holders are the second line, not the first. A payout that fits inside Wardline's stake never touches WARD.

## How a claim is paid

A claim is filed with the amount, who it is for and the reason. The pool then does one of two things:

| Claim | What happens |
| --- | --- |
| Up to 1,000 USDC and within the pool's coverage capacity | Paid at once: the stake first, then WARD holders |
| Larger, or above the coverage capacity | Held for a WARD-holder vote. If the vote passes, it is paid the same way |

The large-claim threshold and the coverage capacity are pool settings, set by the pool's governance. The defaults are 1,000 USDC and 10% of the pool's assets.

## What a claim does to the group

Each paid claim moves the group down one tier and resets its count of clean calls. See [Tiers and reputation](#/docs/tiers-and-reputation).

## What is covered

What Wardline approved: a call it paid on proof, and a payee its check cleared. WARD holders can vote to cover a model or stop covering one, so changes to what is covered are always visible as proposals.

:::limitation
Coverage is bounded. The pool can pay out only what it holds, and a claim above the threshold needs a vote. It is protocol-backed coverage, not insurance. See [Limits and risks](#/docs/limits-and-risks).
:::
