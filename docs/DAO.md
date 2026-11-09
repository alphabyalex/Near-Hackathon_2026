# Wardline DAO Governance (Sputnik v2)

## Overview

Wardline uses Sputnik DAO v2 contracts to decentralize payment authority, AI budget allocations, provider attestations, vendor payout endpoint changes, and Mutual coverage pool claims.

Rather than relying on single hot keys or centralized administrators, groups (such as accounts-payable departments, security councils, or multi-tenant organizations) make decisions via on-chain DAO proposals with explicit voting policies.

## Contracts and Methods

The DAO governs five contracts across Wardline:

1. **Meter Contract (`meter.wardline.testnet`)**
   - Method: `set_allowance`
   - Arguments: `{"budget_id": string, "member": string, "allowance": string}`
   - Purpose: Updates a member's per-period spend limit in atomic USDC.
   - Funding: Executed as `ft_transfer_call` on the USDC token contract with `receiver_id` set to the meter contract and `msg` set to `{"action":"fund","budget_id": string}`.

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

## On-Chain Reputation Tiers (Meter)

The meter contract (`contracts/meter`) tracks autonomous group reputation tiers based on settlement track records:

- **Bronze**: Default tier. Fee 200 bps (2.00%), coverage cap 25 USDC. Automatically promoted to Silver after 10 consecutive clean proven calls.
- **Silver**: Intermediate tier. Fee 150 bps (1.50%), coverage cap 50 USDC. Automatically promoted to Gold after 25 more consecutive clean proven calls (35 total).
- **Gold**: Elite tier. Fee 100 bps (1.00%), coverage cap 100 USDC.
- **Demotions**: Each verified claim demotes the group by one tier (Gold to Silver, Silver to Bronze) and resets the tier's clean call counter.
- **Refusals**: Unsigned or mismatched gateway calls increment refusal statistics without demoting the group's tier.
- **Views & Calls**:
  - `get_reputation(budget_id: String) -> Option<ReputationView>`
  - `list_reputations() -> Vec<ReputationView>`
  - `record_claim(budget_id: String)` (called when payout is approved)

## WARD-Holder Mutual Governance (Cover Pool)

In addition to Sputnik v2 group DAOs, the cover pool (`contracts/cover-pool`) provides on-chain governance for WARD share token holders:

- **Voting Weight**: Snapshot of the voter's WARD balance at the exact moment the proposal is submitted (`snapshot_supply` / balance lookup).
- **Quorum & Thresholds**:
  - Quorum threshold: 20% of `snapshot_supply` must participate in votes.
  - Passing condition: `for_weight > against_weight` once voting window closes (3 days / 259,200s default; demo configurable).
  - Early passage: If `for_weight > snapshot_supply / 2`, the proposal passes immediately without waiting for voting end.
- **Mutual Actions**:
  - `SetFeeBps { fee_bps: u32 }`
  - `SetCoverageMultiplier { multiplier_bps: u32 }`
  - `CoverModel { model_id: String }`
  - `UncoverModel { model_id: String }`
  - `ApprovePayout { claim_id: String, receiver: AccountId, amount: U128 }`
- **Methods**:
  - `propose(action: MutualAction, description: String) -> u64`
  - `vote(proposal_id: u64, approve: bool)`
  - `execute(proposal_id: u64)` (callable once by any account after approval)
  - `get_proposal(proposal_id: u64) -> Option<MutualProposalView>`
  - `list_proposals() -> Vec<MutualProposalView>`
  - `weight_of(account_id: AccountId) -> U128`
  - `governance_params() -> GovernanceParamsView`

## Automated Cover Fee Settlement Flow

During inference settlement in `meter.settle`:
1. The AI provider is paid via NEP-141 `ft_transfer`.
2. Any unused budget deposit is refunded back to the group budget.
3. The mutual coverage fee is transferred to `pool_contract` via `ft_transfer_call` with `msg: "{\"fee\":true}"`.
4. The cover pool contract's `ft_on_transfer` parses the message, identifies the incoming tokens as protocol fee inflow, and directly increments `self.senior` and `self.fees_earned`.
5. This fee inflow automatically increases total pool assets relative to WARD token supply, steadily raising the WARD redemption share price for all liquidity providers.

## Security Model

1. **Least Privilege**: The AI agent key holds only function-call permissions on `request_payment` against its assigned vault. It has zero permissions on the DAO, meter, or model registry.
2. **First-Loss Protection**: In Wardline Mutual, protocol and junior holders absorb losses first before any senior LP capital is touched.
3. **Dual-Gated Endpoints**: A vendor endpoint change must satisfy both time cooldown and DAO approval. Stale approvals (past expiry) and replay attacks are rejected on-chain.
