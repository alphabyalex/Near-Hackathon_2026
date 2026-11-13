---
title: Groups and budgets
description: How a team funds a shared AI budget and gives each member an allowance.
---

A group is a team, hacker house, DAO or solo builder that spends on AI from one shared budget. The budget is what an agent's calls are paid from.

## How a group works

| Part | What it is |
| --- | --- |
| Budget | A deposit of USDC held by the meter contract. Every call is paid from it. |
| Member | A person or agent who can spend from the budget. |
| Allowance | The most one member can spend in a period: a day, a week or a month. |
| Meter key | The key a member's agent holds. It starts with `wk_`, and there is one per member. |

A call can spend only what the member's allowance and the budget's balance both allow. If either is used up, the gateway answers `402` before anything is sent to a model.

## Funding a budget

A group funds its budget from its own treasury, usually a Sputnik DAO or a Trezu account. The transfer is an `ft_transfer_call` on the USDC token, sent to the meter contract with this message:

```json
{ "action": "fund", "budget_id": "bgt_northwind" }
```

For a group run by a DAO, the transfer is a proposal like any other, so members approve it before the money moves.

## Setting allowances

In a DAO-run group, the DAO sets a member's allowance on the meter with `set_allowance`, giving the budget, the member and the amount in USDC's smallest unit. Each change is a proposal, so nobody's limit changes without the group agreeing.

## Meter keys

Each member gets a meter key. Keep it where the agent runs and nowhere else. Because a key belongs to one member, you can retire it without touching anyone else's.

A leaked key can spend only what that member's allowance still allows. See [The spending cap](#/docs/spending-cap).

## Reputation

Every budget has a record: how many calls were proven, how many were refused, and whether a claim was ever paid. The record sets the group's tier, which sets its fee. See [Tiers and reputation](#/docs/tiers-and-reputation).
