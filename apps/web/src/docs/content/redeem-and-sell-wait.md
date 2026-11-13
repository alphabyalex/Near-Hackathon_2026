---
title: Redeem and the sell wait
description: How to turn WARD back into USDC, and why there is a wait.
---

You can leave the Mutual at any time. Leaving takes two steps with a wait between them, so a rush of exits can't strip the pool while a payout is pending.

## How redeeming works

1. **Request to sell.** On [Your balance](#/wallet), choose how much WARD to sell. That WARD is locked for redemption.
2. **Wait.** The sell wait is seven days by default. The page shows a countdown.
3. **Redeem.** When the countdown ends, redeem. The pool burns the WARD and sends you USDC at the price on that day.

You can have several requests open at once, each with its own countdown.

## Why there is a wait

The wait gives the pool time to settle anything in flight: a claim being filed, a vote closing. It also means the price you redeem at already reflects any payout made while you waited.

## Changing the wait

WARD holders vote on the sell wait. A passed proposal can set it anywhere from 0 to 90 days. A change applies to requests made after it is executed. See [Governance](#/docs/governance).

## Selling another way

WARD is a standard NEAR token, so you can also sell it on a market that lists it. That skips the wait, and the price you get is whatever the market pays.

:::note
Redeeming pays the pool's price, which includes the fees WARD has earned. A market price can sit above or below it.
:::
