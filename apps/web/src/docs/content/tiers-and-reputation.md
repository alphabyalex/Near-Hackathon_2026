---
title: Tiers and reputation
description: How a group's record sets its fee and coverage, and what moves it up or down.
---

Every group has a tier: Bronze, Silver or Gold. The tier is a plain record of how the group's calls have gone, and it sets what the group pays and how much the pool will cover.

## The tiers

| Tier | Cover fee | Coverage cap | How a group gets there |
| --- | --- | --- | --- |
| Bronze | 2.00% | 25 USDC | Every group starts here |
| Silver | 1.50% | 50 USDC | 10 clean proven calls in a row |
| Gold | 1.00% | 100 USDC | 25 more clean proven calls (35 in all) |

A clean call is a proven one with no claim since the group last moved. The thresholds are settings, and a demo can run them much smaller.

## What moves a group

- **Up.** Clean proven calls move a group up when it crosses a threshold.
- **Down.** Each paid claim moves a group down one tier, Gold to Silver or Silver to Bronze, and resets its count of clean calls.
- **Refusals.** A refused call is counted, but it does not lower the tier. A refusal is the system working: the model was swapped or the signature was missing, and nothing was paid.

## Reading a group's record

The meter answers `get_reputation` for a budget with:

| Field | Meaning |
| --- | --- |
| `tier` | `bronze`, `silver` or `gold` |
| `proven_calls` | Calls proven and paid |
| `refused_calls` | Calls refused |
| `claims` | Claims paid against the group |
| `fee_bps` | The cover fee in basis points (200, 150 or 100) |
| `coverage_cap` | The most the pool will cover for the group, in USDC |

`list_reputations` returns every group. On the [Groups](#/groups) page, **Open group** shows one group's whole record, its budget and its recent calls. The [Safest groups](#/) list on the home page ranks groups with at least 10 proven calls, since a shorter record is too little to rank.

## Why it works this way

A lower fee is the reward for a record the pool can trust, and a claim is the only thing that undoes it. A group that stops getting calls wrong pays less. A group that costs the pool money pays more.
