# Vault rules

Owner: Tharun. This is the plain-language spec of the Wardline vault contract (`contracts/vault`).
The Rust contract, the TypeScript simulator (`packages/vault-sim`) and the parity tests all implement this file.
If code and this file disagree, that is a bug: fix one of them and say which in `docs/status/tharun.md`.

Vocabulary comes from `packages/schemas`: `VaultRejection`, `PayableStatus`, `OperationStatus`, `RequestResult`, `Payable`, `Vendor`, `Policy`, `AgentBinding`, `Operation`, `VaultUsage`, `WardlineEvent`.

Amounts are atomic integers (JSON strings, Rust `u128`). Times are nanoseconds since the Unix epoch (JSON strings, Rust `u64`). "Now" is always the block timestamp.

## The idea in one paragraph

One vault per business. The owner approves vendors and exact payables. The agent can only say "pay this approved payable": its request carries no amount and no recipient, because both are locked inside the payable. The vault checks every limit itself, so a malicious script holding the agent key hits exactly the same limits as the AI. Anything over a cap is not declined: the vault returns a structured rejection, no money moves, the item goes to the human queue, and the owner can pay it with `owner_pay`.

## State

| State | Meaning |
| --- | --- |
| `owner` | Account allowed to change anything. Fixed at `new`. |
| `guardian` | Optional account that may only `pause`. |
| `token_contract`, `token_decimals` | The one NEP-141 token this vault holds. Fixed at `new`. |
| `vendors` | `vendor_id` to vendor: `display_name`, `account_id` (approved recipient), `per_payment_cap_atomic`, `revision`, `active`. |
| `payables` | `payable_ref` to payable: exact `amount_atomic`, `vendor_id`, `vendor_revision`, locked `recipient`, `po_number`, `invoice_number`, times, `evidence_commitment`, `status`, latest operation. |
| `policy` | `revision`, weekly cap W, lifetime ceiling C, `expires_at_ns`, `paused`. |
| `binding` | At most one enrolled agent: `agent_account_id`, `public_key`, `manifest_digest`, `assessment_ref`, `revision`, `expires_at_ns`, `enabled`. Its revision survives revocation and re-activation. |
| `operations` | `operation_id` (`op_<n>`) to one payment attempt: payable, amount, recipient, status, attempt, times, origin (AGENT or OWNER), `request_digest`. |
| Accounting | See below. |

### Accounting

| Symbol | Name | Meaning |
| --- | --- | --- |
| A | `available` | Tokens credited by funding and not reserved, settled or withdrawn. Shown as `balance_atomic`. |
| R | `reserved` | Agent payments reserved and not yet resolved. |
| S | `settled` | Lifetime total of settled agent payments. Never decreases. |
| `rolling` | Rolling window | List of (amount, settled_at) for settled agent payments. An entry counts while `now < settled_at + 7 days`. At exactly 7 days it no longer counts. |
| `owner_reserved` | | Owner payments in flight. Never counts against caps. |
| `owner_paid` | | Lifetime total of settled owner payments. Never counts against caps. |

Conservation invariant at every point in time, when nothing was sent to the vault outside `ft_on_transfer`:

`funded = A + R + owner_reserved + S + owner_paid + withdrawn + withdrawal_in_flight`

### Capacities

Set in `new`, each no higher than the hard limit. All enforced. Rejected calls write no state at all, so they can never consume capacity.

| Capacity | Default | Hard limit |
| --- | --- | --- |
| `max_vendors` | 64 | 128 |
| `max_payables` | 1024 | 4096 |
| `max_pending` (operations in RESERVED or OUTCOME_UNCERTAIN) | 32 | 64 |
| `max_rolling` (live rolling entries plus reserved settlement slots) | 256 | 512 |
| `max_operations` (all attempts ever) | 2048 | 8192 |

String limits: ids and refs at most 64 bytes, `display_name` and `po_number` and `invoice_number` and `assessment_ref` at most 64 bytes, digests exactly `sha256:<64 lowercase hex>`.

## Who can call what

| Method | Caller | Deposit | On failure |
| --- | --- | --- | --- |
| `new(config)` | The vault account itself, once, in the deploy transaction | 0 | Panic |
| `set_vendor`, `register_payable`, `cancel_payable`, `reopen_failed_payable`, `set_policy`, `activate_agent`, `unpause`, `reconcile_operation`, `reconcile_withdrawal`, `withdraw_available` | Owner | Exactly 1 yocto | Panic with an `E_*` code |
| `revoke_agent` | Owner | 0 | Panic with an `E_*` code |
| `pause` | Owner or guardian | 0 | Panic with an `E_*` code |
| `owner_pay` | Owner | Exactly 1 yocto | Returns `RequestResult` for rule failures. Wrong deposit panics. |
| `request_payment` | Enrolled agent | 0 | Returns `RequestResult` for rule failures. Any deposit panics, which refunds it. |
| `ft_on_transfer` | The fixed token only | 0 | Panic, so the token refunds the sender |
| `on_payment_result`, `on_withdraw_result` | The vault itself (private) | 0 | Panic |

The 1 yocto rule means these owner methods can only be signed by a full-access key, so a leaked function-call key of the owner cannot move money or raise limits. `pause` and `revoke_agent` only reduce authority, so they stay deposit-free and a guardian can hold a pause-only key.

**The vault account holds no keys after deployment.** `#[private]` only checks that the caller is the vault account, so anyone holding a key to that account could sign a fake `on_payment_result`, or replace the code. `scripts/contracts/deploy-and-seed` removes every key from the vault once it is set up, and `inspect-keys` proves it. The cost: a deployed vault cannot be upgraded. A fix means deploying a new vault.

## Methods

### `new(config)`

`config`: `owner`, `guardian` (optional), `token_contract`, `token_decimals`, `policy { weekly_cap_atomic, lifetime_cap_atomic, expires_at_ns }`, `capacities` (optional, defaults above). One time only. Policy revision starts at 1. The vault starts paused. No agent is enrolled.

### `set_vendor(vendor, expected_revision)`

`vendor`: `vendor_id`, `display_name`, `account_id`, `per_payment_cap_atomic`, `active`. `expected_revision` must equal the current revision (0 for a new vendor), else `E_STALE_REVISION`. Revision goes up by 1. A new vendor needs a free slot, else `E_CAPACITY_FULL`.

Effect on other records: payables pinned to the older revision can no longer be requested by the agent (`STALE_REVISION`). Payments already PENDING are not affected: they keep their locked recipient and amount.

### `register_payable(payable)`

`payable`: `payable_ref`, `vendor_id`, `vendor_revision`, `po_number`, `invoice_number` (nullable), `amount_atomic`, `not_before_ns`, `due_at_ns`, `expires_at_ns`, `evidence_commitment`.

Checks: `payable_ref` unused (`E_DUPLICATE_PAYABLE`), vendor exists (`E_UNKNOWN_VENDOR`), vendor active (`E_VENDOR_INACTIVE`), `vendor_revision` is current (`E_VENDOR_REVISION_MISMATCH`), `amount_atomic > 0` and `not_before_ns <= due_at_ns <= expires_at_ns` with `not_before_ns < expires_at_ns` (`E_INVALID_INPUT`), free slot (`E_CAPACITY_FULL`).

Effect: status OPEN, and the vendor's current `account_id` is copied into the payable as the locked recipient. A `payable_ref` is never reused, even after cancellation.

### `cancel_payable(payable_ref)`

OPEN or FAILED_KNOWN to CANCELLED, else `E_NOT_CANCELLABLE`. Cancelled is final. This is how an owner replaces a payable whose vendor revision moved: cancel it and register a new one under a new ref.

### `set_policy(change, expected_revision)`

`change`: `weekly_cap_atomic`, `lifetime_cap_atomic`, `expires_at_ns`. Never touches S, R or the rolling window. `lifetime_cap_atomic` below `S + R` panics with `E_BELOW_COMMITTED`. W may be set below current usage: that simply blocks further agent payments until the window clears. Revision goes up by 1. Pending payments are not affected.

### `activate_agent(binding, expected_revision)`

`binding`: `agent_account_id`, `public_key`, `manifest_digest`, `assessment_ref`, `expires_at_ns`. Replaces any current binding, enabled. Revision goes up by 1 (from 0 if there has never been a binding).

### `revoke_agent(agent_account_id)`

Must name the enrolled agent (`E_AGENT_MISMATCH`). Sets `enabled = false`, revision goes up by 1. Pending payments still resolve.

### `pause()` and `unpause()`

`pause`: owner or guardian. `unpause`: owner only. Neither bumps the policy revision. Pause stops `request_payment` only. It does not stop callbacks (money already sent must still be accounted for), funding, or `owner_pay`: the owner is the human escalation path and can still pay a bill that is due during an incident.

### `request_payment(payable_ref, request_digest, expected_vendor_revision, expected_policy_revision, expected_binding_revision)`

Enrolled agent only. Carries no amount and no recipient. The first failing check in this exact order decides the result. The order is part of the spec, because the simulator must match it. A rejected call writes no state and emits no event.

| # | Check | Rejection |
| --- | --- | --- |
| 0 | Attached deposit is 0 | Panic (the SDK does this for non-payable methods) so the deposit is refunded |
| 1 | A binding exists, predecessor == signer == enrolled agent account, signer public key == enrolled key | `BAD_CALLER` |
| 2 | `request_digest` is well formed | `BAD_CALLER` |
| 3 | Binding enabled, `now < binding.expires_at_ns`, `now < policy.expires_at_ns` | `BINDING_INACTIVE` |
| 4 | Vault not paused | `PAUSED` |
| 5 | Payable exists | `UNKNOWN_PAYABLE` |
| 6 | SETTLED: if the digest matches the settled operation return `ok` with that `operation_id` and no transfer, else | `ALREADY_PAID` |
| 7 | PENDING: if the digest matches the pending operation return `ok` with that `operation_id` and no transfer, else | `ALREADY_PENDING` |
| 8 | Status is OPEN. CANCELLED and FAILED_KNOWN are not open: FAILED_KNOWN needs the owner to reopen it first | `UNKNOWN_PAYABLE` |
| 9 | `now >= not_before_ns` | `NOT_YET_PAYABLE` |
| 10 | `now < expires_at_ns` | `PAYABLE_EXPIRED` |
| 11 | All three expected revisions equal current ones, payable's `vendor_revision` == vendor's current revision, vendor active | `STALE_REVISION` |
| 12 | `amount <= vendor.per_payment_cap_atomic` | `OVER_VENDOR_CAP` |
| 13 | `rolling_settled(now) + R + amount <= W` | `OVER_WEEKLY_CAP` |
| 14 | `S + R + amount <= C` | `OVER_LIFETIME_CAP` |
| 15 | `amount <= A` | `INSUFFICIENT_BALANCE` |
| 16 | Pending slot, settlement slot and operation record free, and NEAR storage margin present | `CAPACITY_FULL` |
| 17 | Prepaid gas covers transfer and callback (at least 60 Tgas) | Panic `E_INSUFFICIENT_GAS` (reverts, no state changes) |

Notes:
- Check 6 and 7 are the idempotency rule: a retry with the same digest never causes a second transfer.
- Exactly at a cap passes. One atomic unit over fails.
- An expired policy has no code of its own and reports `BINDING_INACTIVE`: the agent's authority has lapsed.
- A deactivated vendor reports `STALE_REVISION`, since deactivating bumped the revision.

**On success, reservation happens first, in the same receipt, before any token call:**
1. Prune expired rolling entries.
2. `A -= amount`, `R += amount`.
3. Payable to PENDING. Pending slot and settlement slot taken. New operation with status RESERVED, `attempt` = previous attempts on this payable + 1.
4. Emit `payment_reserved`.
5. Call `ft_transfer(recipient, amount)` on the token with 1 yocto, then the private callback `on_payment_result(operation_id)`.

The transaction's final value is the callback's return value, a `RequestResult`.

### `owner_pay(payable_ref)`

Owner only, exactly 1 yocto. The escalation path for over-cap or reviewed items. First failing check decides:

| # | Check | Rejection |
| --- | --- | --- |
| 1 | Caller is owner | `BAD_CALLER` |
| 2 | Payable exists | `UNKNOWN_PAYABLE` |
| 3 | Not SETTLED | `ALREADY_PAID` |
| 4 | Not PENDING | `ALREADY_PENDING` |
| 5 | Status OPEN (FAILED_KNOWN must be reopened first, CANCELLED is final) | `UNKNOWN_PAYABLE` |
| 6 | Vendor active and vendor's current `account_id` still equals the locked recipient | `STALE_REVISION` |
| 7 | `amount <= A` | `INSUFFICIENT_BALANCE` |
| 8 | Pending slot and operation record free, and NEAR storage margin present | `CAPACITY_FULL` |

Pays the locked amount to the locked recipient. Ignores pause, payable time window and all three agent caps. Check 6 exists so a stale approval never pays an old address after the owner rotated it: a cap-only vendor change does not block `owner_pay`, a recipient change does.

Reservation: `A -= amount`, `owner_reserved += amount`, payable PENDING, operation RESERVED with origin OWNER. No settlement slot.

### `on_payment_result(operation_id)`

Private callback. Reads the actual promise result. Acts only if the operation is RESERVED, otherwise changes nothing and returns the current answer, which makes it idempotent.

| Promise result | Effect |
| --- | --- |
| Exactly one result, successful, empty value (what `ft_transfer` returns) | Operation SETTLED, payable SETTLED (permanent paid lock). Agent: `R -= amount`, `S += amount`, rolling entry added at callback block time. Owner: `owner_reserved -= amount`, `owner_paid += amount`. Pending slot freed. Event `payment_settled`. |
| Exactly one result, failed | The token call reverted, so no tokens moved. Operation FAILED_KNOWN, payable FAILED_KNOWN. Agent: `R -= amount`. Owner: `owner_reserved -= amount`. `A += amount`. Slots freed. Event `payment_failed`. Happens once. |
| Anything else | Operation OUTCOME_UNCERTAIN, payable stays PENDING, reservation stays. Event `payment_uncertain`. Needs `reconcile_operation`. |

Returns `{ ok: true, operation_id, rejection: null }` in all cases. `ok` means "the vault accepted the request and this operation exists". It does not mean "the money moved": read `get_operation` for the outcome. `RequestResult` cannot carry a failed transfer because that is not a policy rejection.

### `reopen_failed_payable(payable_ref)`

FAILED_KNOWN to OPEN, else `E_NOT_FAILED`. The next attempt creates a new operation with a higher `attempt`. The agent cannot reopen. Typical reason: the recipient has now registered storage with the token.

### `reconcile_operation(operation_id, settled)`

Owner only. Addition to the original brief: without it an uncertain payment would hold its reservation forever and block withdrawals. Allowed when the operation is OUTCOME_UNCERTAIN, or RESERVED for at least 1 hour (a callback that never ran), else `E_NOT_RECONCILABLE`. The owner checks the token's records and states the outcome. `settled = true` applies the settled effects at current block time, `false` applies the failed effects. A later callback then changes nothing.

### `ft_on_transfer(sender_id, amount, msg)`

Only from the fixed token, else panic `E_WRONG_TOKEN` so the tokens are refunded. Credits `A`. Works while paused. Never changes W, C or anything but `A`. `msg` is ignored and never stored. Returns `"0"` (keep everything). Event `funding_received`.

Plain `ft_transfer` to the vault does not call this hook, so such tokens stay uncredited and unspendable. Fund with `ft_transfer_call`.

### `withdraw_available(amount)`

Owner only, exactly 1 yocto, and: vault paused (`E_NOT_PAUSED`), nothing pending (`E_PENDING_OPERATIONS`), no other withdrawal in flight (`E_WITHDRAWAL_IN_FLIGHT`), `0 < amount <= A` (`E_INSUFFICIENT_BALANCE`). Recipient is always the owner. `A -= amount`, in-flight record set, `ft_transfer` with 1 yocto, then private callback `on_withdraw_result(amount)`.

### `on_withdraw_result(amount)`

Private. Success: in-flight cleared, `withdrawn += amount`. Failed: in-flight cleared, `A += amount`. Anything else: in-flight stays and is marked uncertain, which blocks further withdrawals until reconciled. Does nothing if no matching withdrawal is in flight, or it is already marked uncertain.

### `reconcile_withdrawal(settled)`

Owner only. Allowed when the in-flight withdrawal is uncertain, or at least 1 hour old (a callback that never ran), else `E_NOT_RECONCILABLE`. With none in flight: `E_NO_WITHDRAWAL`. Same reasoning as `reconcile_operation`.

### Views

`get_policy`, `get_usage`, `get_payable(payable_ref)`, `get_operation(operation_id)`, `get_vendors(from_index, limit)`, `get_binding`, `get_payables(from_index, limit)`, `get_config`.

- `get_payable` and `get_payables` report OPEN payables past `expires_at_ns` as EXPIRED. This is derived, not stored, because expiry needs no transaction. `owner_pay` can still pay them.
- `get_payable` matches `PayableSchema` (`vault_id` and `token_contract_id` are filled in from the vault). The locked `recipient` and `operation_id` are extra fields.
- `get_usage` matches `VaultUsageSchema`: `weekly_settled_atomic` is the rolling sum at now, `weekly_reserved_atomic` and `lifetime_reserved_atomic` are both R, `lifetime_settled_atomic` is S, `balance_atomic` is A. Extras: `owner_paid_atomic`, `owner_reserved_atomic`, `withdrawn_atomic`, `withdrawal_in_flight_atomic`, `pending_count`.
- `get_operation` matches `OperationSchema`. `tx_hash` is always null on chain, since a contract cannot know its own transaction hash: `vault-client` fills it in when it knows it. Extras: `origin`, `request_digest`.

## Status machines

```
Payable
OPEN --request_payment or owner_pay--> PENDING
PENDING --transfer ok--> SETTLED (final)
PENDING --transfer failed--> FAILED_KNOWN --reopen_failed_payable--> OPEN
OPEN or FAILED_KNOWN --cancel_payable--> CANCELLED (final)
OPEN past expires_at_ns reads as EXPIRED in views

Operation
RESERVED --ok--> SETTLED (final)
RESERVED --failed--> FAILED_KNOWN (final)
RESERVED --anything else--> OUTCOME_UNCERTAIN --reconcile_operation--> SETTLED or FAILED_KNOWN
RESERVED for 1 hour with no callback --reconcile_operation--> SETTLED or FAILED_KNOWN
```

`REQUESTED` from `OperationStatus` is never stored on chain. It belongs to the API, for a request not yet confirmed.

## One payment, step by step

1. Owner has approved vendor `vnd_larkspur` (cap 5,000 WUSD) and registered `pay_1001` for exactly 1,250 WUSD, and the vault is funded and unpaused.
2. The API takes a PAY decision from the agent. The adapter builds a `PaymentRequest`: `payable_ref`, `request_digest`, and the three revisions it read.
3. `vault-client` signs `request_payment` with the agent's function-call key, which NEAR only accepts for this one method on this one vault, with no deposit.
4. The vault runs checks 1 to 17. Suppose one fails: it returns `{ ok: false, operation_id: null, rejection: "OVER_WEEKLY_CAP" }`, nothing changes, no money moves. The API opens a review item and the owner can `owner_pay`. Otherwise:
5. Same receipt: A and R change, `pay_1001` becomes PENDING, `op_7` is RESERVED, slots are taken, `payment_reserved` is logged. Then `ft_transfer` and the callback are scheduled. From here on no second payment of `pay_1001` can start.
6. Next receipt, on the token: 1,250 WUSD moves to the locked recipient, or the call reverts.
7. Next receipt, on the vault: `on_payment_result("op_7")` reads the real result. Success: `op_7` and `pay_1001` become SETTLED, R moves to S, a rolling entry is added at this block's time.
8. The final value `{ ok: true, operation_id: "op_7", rejection: null }` comes back. `vault-client` waited for final execution and returns it. The API reads `get_operation` for the outcome and the receipt.
9. A timeout at any point is not a failure: `vault-client` throws, the API marks "outcome uncertain", and a retry with the same digest returns `op_7` with no second transfer.

## Events

NEP-297 logs: `EVENT_JSON:{"standard":"wardline","version":"1.0.0","event":...,"data":[{...}]}`. Standard name matches `WardlineEventSchema`. Data is typed fields only: ids, refs, amounts, revisions, digests, statuses. Never invoice text.

| Event | Data |
| --- | --- |
| `vendor_set` | `vendor_id`, `revision`, `account_id`, `per_payment_cap_atomic`, `active` |
| `payable_registered` | `payable_ref`, `vendor_id`, `vendor_revision`, `amount_atomic`, `recipient`, `due_at_ns` |
| `payable_cancelled`, `payable_reopened` | `payable_ref` |
| `policy_set` | `revision`, `weekly_cap_atomic`, `lifetime_cap_atomic`, `expires_at_ns` |
| `agent_activated` | `agent_account_id`, `revision`, `manifest_digest`, `expires_at_ns` |
| `agent_revoked` | `agent_account_id`, `revision` |
| `vault_paused`, `vault_unpaused` | `by` |
| `payment_reserved` | `operation_id`, `payable_ref`, `amount_atomic`, `recipient`, `origin`, `attempt` |
| `payment_settled`, `payment_failed`, `payment_uncertain` | `operation_id`, `payable_ref`, `amount_atomic`, `origin` |
| `operation_reconciled` | `operation_id`, `payable_ref`, `settled` |
| `funding_received` | `sender_id`, `amount_atomic` |
| `withdrawal_started`, `withdrawal_settled`, `withdrawal_failed`, `withdrawal_uncertain` | `amount_atomic` |

## Rule codes at a glance

Rejections (returned, never panics): the `VaultRejection` enum.

Owner and admin errors (panic messages, stable strings): `E_NOT_OWNER`, `E_NOT_OWNER_OR_GUARDIAN`, `E_STALE_REVISION`, `E_INVALID_INPUT`, `E_CAPACITY_FULL`, `E_UNKNOWN_VENDOR`, `E_VENDOR_INACTIVE`, `E_VENDOR_REVISION_MISMATCH`, `E_DUPLICATE_PAYABLE`, `E_UNKNOWN_PAYABLE`, `E_UNKNOWN_OPERATION`, `E_NOT_CANCELLABLE`, `E_NOT_FAILED`, `E_NOT_RECONCILABLE`, `E_BELOW_COMMITTED`, `E_AGENT_MISMATCH`, `E_NO_BINDING`, `E_NOT_PAUSED`, `E_PENDING_OPERATIONS`, `E_WITHDRAWAL_IN_FLIGHT`, `E_NO_WITHDRAWAL`, `E_INSUFFICIENT_BALANCE`, `E_WRONG_TOKEN`, `E_INSUFFICIENT_GAS`, `E_OVERFLOW`.

## What the vault does not protect against

Stated so nobody overclaims:
- It checks what the owner approved, not whether the approval was right. A fraudulent payable registered by the owner gets paid.
- A compromised owner key has full authority over this vault. The agent key does not, and that is the boundary this contract enforces.
- The agent can pay any payable that passes the checks, in any order, at any time inside its window. The caps bound that loss. They do not prevent it.
- `request_digest` is stored and compared for retries, not verified against any invoice. It says "same request", not "correct request".
