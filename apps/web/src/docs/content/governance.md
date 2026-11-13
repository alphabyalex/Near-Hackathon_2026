---
title: Governance
description: What WARD holders decide, how a vote runs, and how a passed change takes effect.
---

Wardline is governed at two levels. A group's DAO decides how the group spends. WARD holders decide the risks the Mutual takes.

## Group decisions

A group run by a Sputnik DAO passes proposals for its own budget: funding it, setting allowances, adding a model provider, and approving a vendor's new payout account. The proposal types are in the [API reference](#/docs/api-reference).

## What WARD holders vote on

| Decision | What changes |
| --- | --- |
| Tier fees | The cover fee for Bronze, Silver or Gold |
| Coverage | A multiplier on every tier's coverage cap, from 0.25x to 4x |
| The sell wait | How long redemption takes, from 0 to 90 days |
| Covered models | Which models the pool covers |
| Large payouts | A claim too big to pay automatically |

## How a vote runs

1. **Propose.** Only a WARD holder can propose. A proposal is a plain description and one action, from the list above.
2. **The snapshot.** When a proposal opens, the pool records every holder's WARD balance. That is your voting weight on it. Moving WARD afterwards doesn't add votes, and WARD you buy later doesn't count.
3. **Vote.** Each holder votes for or against, once, with their snapshot weight.
4. **It passes** if it reaches quorum, meaning at least 20% of the snapshot supply has voted, and more voted for than against when the window closes. The window is three days. If more than half of the snapshot supply votes for it, it passes at once.
5. **Execute.** Anyone can execute a passed proposal, once. Execution makes the change, and only a change inside the contract's bounds goes through.

:::important
A holder who votes with weight they got after a proposal opened would be voting twice. The snapshot is what stops that.
:::

## Reading a proposal

Every proposal shows what it would change in plain terms, such as "Silver groups would pay 1.25% instead of 1.50%", how much of the supply has voted, and how long is left. Passed and rejected proposals stay on the record under **Decided**.

## Voting from the app

On the [home page](#/) the open votes sit beside the safest groups. Choose **Vote for** or **Vote against**, connect a wallet if you haven't, and sign. If you held no WARD when a proposal opened, the app says so and you can vote on the next one.
