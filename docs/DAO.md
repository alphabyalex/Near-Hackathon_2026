# Wardline DAO Governance (Sputnik v2)

## Overview

Wardline uses Sputnik DAO v2 contracts to decentralize payment authority, AI budget allocations, provider attestations, vendor payout endpoint changes, and Mutual coverage pool claims.

Rather than relying on single hot keys or centralized administrators, groups (such as accounts-payable departments, security councils, or multi-tenant organizations) make decisions via on-chain DAO proposals with explicit voting policies.

## Contracts and Methods

The DAO governs five contracts across Wardline:

1. **Meter Contract (`meter.wardline.testnet`)**
   - Method: `set_allowance`
   - Arguments: `{"budget_id": string, "member": string, "allowance": string}`
   - Purpose: Updates a member's per-period spend limit in atomic WUSD.
   - Funding: Executed as `ft_transfer_call` on the WUSD token contract with `receiver_id` set to the meter contract and `msg` set to `{"action":"fund","budget_id": string}`.

2. **Model Registry Contract (`models.wardline.testnet`)**
   - Method: `add_provider`
   - Arguments: `{"provider_id": string, "pay_to": string, "model_ids": string[]}`
   - Purpose: Registers an AI inference provider, its payout account, and the models it is authorized to serve.

3. **Vault Contract (`vault.wardline.testnet`)**
   - Method: `approve_endpoint`
   - Arguments: `{"vendor_id": string, "revision": number, "account": string}`
   - Purpose: Grants governance approval for a cooling-off vendor payout account revision. Dual-gated activation ensures neither an compromised agent nor a single hot key can redirect funds.

4. **Cover Pool Contract (`mutual.wardline.testnet`)**
   - Method: `set_param`
   - Arguments: `{"name": string, "value": string}`
   - Purpose: Modifies risk parameters such as `large_claim_threshold`, `withdraw_delay_days`, and `max_claim_bps`.
   - Method: `approve_claim`
   - Arguments: `{"claim_id": string}`
   - Purpose: Approves large claims exceeding the automatic threshold. Disburses funds first from the junior first-loss tranche, then from senior LP capital.

## Proposal Mapping

The `@wardline/dao-adapter` package translates between high-level user actions and Sputnik v2 proposals:

| Decision | Sputnik Proposal Kind | Method / Action |
| --- | --- | --- |
| Fund Budget | `Transfer` with `msg` | `ft_transfer_call` -> `{"action":"fund","budget_id":"..."}` |
| Set Allowance | `FunctionCall` | `meter.set_allowance({budget_id, member, allowance})` |
| Add Provider | `FunctionCall` | `registry.add_provider({provider_id, pay_to, model_ids})` |
| Approve Payout Change | `FunctionCall` | `vault.approve_endpoint({vendor_id, revision, account})` |
| Set Pool Param | `FunctionCall` | `pool.set_param({name, value})` |
| Approve Claim | `FunctionCall` | `pool.approve_claim({claim_id})` |

## Security Model

1. **Least Privilege**: The AI agent key holds only function-call permissions on `request_payment` against its assigned vault. It has zero permissions on the DAO, meter, or model registry.
2. **First-Loss Protection**: In Wardline Mutual, protocol and junior holders absorb losses first before any senior LP capital is touched.
3. **Dual-Gated Endpoints**: A vendor endpoint change must satisfy both time cooldown and DAO approval. Stale approvals (past expiry) and replay attacks are rejected on-chain.
