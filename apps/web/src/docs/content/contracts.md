---
title: Contracts
description: The NEAR testnet accounts Wardline runs on, and what each one does.
---

Wardline's contracts are deployed on NEAR testnet under `wardline-labs.testnet`. Every account links to its page on NearBlocks.

## Accounts

::contracts

## Money

All money is Circle's USDC on NEAR testnet, with six decimals. The token's account is:

```text
3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af
```

Testnet USDC is free from Circle's faucet. WARD is minted by the pool itself and follows NEP-141, so any NEAR wallet or explorer can show it.

## Reading them

The most useful view methods:

| Contract | Method | Returns |
| --- | --- | --- |
| Meter | `get_reputation(budget_id)` | A group's tier, counts, fee and coverage cap |
| Meter | `list_reputations()` | Every group's record |
| Pool | `get_pool()` | Assets, WARD supply, price, the sell wait and the large-claim threshold |
| Pool | `list_proposals()` | Every WARD-holder proposal |
| Pool | `weight_of(account_id)` | An account's WARD balance |
| Pool | `governance_params()` | The voting window and quorum |

## Events

The pool reports WARD moves with the standard NEP-141 events (`ft_mint` on deposit, `ft_burn` on redeem, `ft_transfer` on transfers), so wallets and indexers see them without special support.

:::note
These are testnet deployments and are replaced as the contracts change. Check the account on NearBlocks for the code that is live.
:::
