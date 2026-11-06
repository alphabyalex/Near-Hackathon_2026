# Spend Gym Vault Rules

Status: normative engineering specification for the hackathon vault lane

Audience: contract implementers, vault-client implementers, AI adapter implementers, evaluator implementers, reviewers, and demo operators

## 1. Purpose

A Spend Gym vault is one NEAR contract instance for one business. It receives a fixed mock NEP-141 token, stores owner-approved vendors and owner-approved payables, and lets one enrolled agent request payment of those payables.

The vault does not decide whether an invoice is genuine. It enforces a narrow owner-supplied payment mandate. The owner remains responsible for approving vendors, recipient accounts, purchase orders, receipts, payable amounts, policy changes, agent bindings, and exceptional payments.

The security goal is containment:

> A request signed with the enrolled agent key cannot move more token value, pay a different recipient, pay a different amount, pay outside the approved time window, or pay the same payable twice beyond the exact authority that the owner recorded in vault state.

The vault does not claim to be fraud-proof, unhackable, or a certification system.

## 2. Actors and identities

### 2.1 Owner

The owner is the only account that may:

- create or replace a vendor configuration;
- register a payable;
- change weekly or lifetime policy limits;
- activate or revoke an agent binding;
- unpause the vault;
- pay an approved payable through `owner_pay`;
- reopen a payable after a known failed transfer;
- withdraw available vault funds while the vault is paused and no payment or withdrawal remains unresolved.

Owner authorization is based on `predecessor_account_id`. Owner methods reject proxy calls.

### 2.2 Guardian

The optional guardian may call `pause` and nothing else. The guardian cannot unpause, change policy, alter vendors, register payables, pay bills, withdraw funds, activate an agent, or invoke callbacks.

### 2.3 Enrolled agent

The enrolled agent is one account plus one exact public key and one release binding. The intended key is a NEAR function-call access key restricted to:

- receiver: this vault contract only;
- method: `request_payment` only;
- allowance: a deliberately small gas allowance suitable for the demo.

The vault additionally checks all of the following inside `request_payment`:

- `attached_deposit == 0`;
- `predecessor_account_id == signer_account_id`;
- predecessor and signer equal the enrolled agent account;
- `signer_account_pk` equals the enrolled public key;
- binding is enabled;
- binding has started;
- binding has not expired;
- caller-supplied binding revision matches current state.

These checks mean a proxy contract, relayer, different key on the same agent account, revoked key, expired binding, or stale release cannot inherit payment authority.

### 2.4 Vault contract

Only the vault itself may execute private callbacks. Callback methods require `predecessor_account_id == current_account_id` and the expected promise-result count.

### 2.5 Fixed token contract

Each vault has exactly one token contract and one token-decimal value fixed at initialization. `ft_on_transfer` accepts funding only when the predecessor is that token contract. Funding never raises the policy ceiling.

## 3. Stored entities

### 3.1 Vendor

A vendor record contains:

- `vendor_id`: bounded opaque identifier;
- `recipient`: approved NEAR account that receives token transfers;
- `per_payment_cap_atomic`: maximum agent payment for one payable in token atomic units;
- `revision`: monotonically increasing owner-controlled revision;
- `enabled`: whether new agent requests may use this vendor.

Changing a vendor increments its revision. A payable records the vendor revision that was approved with it. This prevents a later recipient change from silently redirecting an already-approved bill.

### 3.2 Payable

A payable contains:

- `payable_ref`: bounded, unique, opaque stable identifier;
- `vendor_id`;
- `vendor_revision`;
- `amount_atomic`: exact amount to transfer;
- `po_number`: bounded purchase-order reference;
- `not_before_ns`;
- `due_at_ns`;
- `expires_at_ns`;
- current status;
- optional operation identifier;
- optional request digest.

The owner, not the agent, sets the vendor, recipient binding, amount, and time window. Partial payments and installments are out of scope.

`not_before_ns <= due_at_ns <= expires_at_ns` is required. Duplicate `payable_ref` values are rejected permanently, including after settlement.

### 3.3 Policy

The policy contains:

- `weekly_cap_atomic` (`W`): conservative rolling seven-day agent-spend cap;
- `lifetime_ceiling_atomic` (`C`): finite cumulative agent authorization ceiling;
- `revision`: monotonically increasing owner-controlled revision.

A policy change never clears or reduces accounting history. A new lifetime ceiling below `settled_agent_total + reserved_agent_total` is rejected.

### 3.4 Agent binding

The binding contains:

- agent account;
- exact public key;
- manifest digest for the declared release;
- enabled flag;
- valid-from timestamp;
- expiry timestamp;
- revision.

A new release or key requires an explicit owner-signed activation. Good history never raises limits automatically.

### 3.5 Operation

A successful request creates one operation before any cross-contract transfer is dispatched. The operation contains:

- unique operation identifier;
- payable reference;
- actor kind, agent or owner;
- request digest when applicable;
- amount;
- recipient;
- creation timestamp;
- current operation status;
- settlement timestamp when final;
- failure detail category when known.

Operations are bounded by a configured maximum. A settlement slot is reserved before dispatch so a successful transfer can always be recorded.

## 4. Accounting model

The vault maintains distinct accounting values:

- `S`: cumulative agent-paid amount successfully settled;
- `R`: cumulative agent amount reserved for unresolved transfers;
- `O`: cumulative owner-paid amount successfully settled;
- `W`: rolling seven-day agent cap;
- `C`: finite lifetime agent ceiling;
- `B`: token balance observed through accepted funding and finalized withdrawals, adjusted by finalized payments;
- `A`: available recorded balance not reserved by pending payments or withdrawals;
- `P`: unresolved payment-operation count;
- `P_agent`: unresolved agent-payment count, which also reserves future rolling-entry capacity.

Required invariants:

```text
S + R <= C
rolling_settled_last_7_days + R <= W
R == sum(amount of unresolved agent operations)
P_agent == count(unresolved agent payment operations)
active rolling entries + P_agent <= configured rolling-entry capacity
available + all unresolved outgoing reservations <= recorded token balance
one payable has at most one successful settlement
```

Owner payments do not consume `W` or `C`, but remain exact-amount, approved-recipient, single-settlement payments and are tracked in `O`.

### 4.1 Rolling window

The rolling window covers settled agent payments whose callback settlement timestamps are within the last exactly seven days.

For a request at time `t`, a settled entry at `t - 7 days` is expired and no longer contributes. An entry one nanosecond newer still contributes.

Pending reservations always contribute to the weekly capacity calculation, regardless of creation age. Each pending agent operation also reserves one future rolling-entry slot. This prevents concurrent requests from oversubscribing either the amount cap or the bounded settlement-history capacity.

### 4.2 Reservations

The vault reserves capacity and balance before calling the token contract. Reservation happens in one state transition:

1. allocate operation and settlement-record capacity;
2. subtract amount from available recorded balance;
3. add amount to `R` for agent operations;
4. lock payable as `PENDING`;
5. store operation as `DISPATCHED`;
6. emit reservation event;
7. dispatch `ft_transfer` with exactly one yoctoNEAR;
8. attach a private callback.

If dispatch cannot be created, the whole contract call fails atomically and no reservation persists.

### 4.3 Callback outcomes

The callback reads the actual promise result.

- Successful token call: mark operation `SETTLED`, mark payable `SETTLED`, remove reservation, increase `S` or `O`, append rolling entry for an agent payment, and keep the permanent paid lock.
- Explicit failed token call: mark operation `FAILED_KNOWN`, remove reservation exactly once, restore recorded available balance, and leave the payable failed until the owner explicitly reopens it.
- Missing or otherwise unclassifiable result: keep the operation unresolved and keep every reservation. The owner must reconcile it. The vault must not free capacity merely because an observer timed out or a callback was malformed.

Callbacks are idempotent. Replaying a callback cannot settle twice or release twice.

## 5. Payable state machine

```text
REGISTERED/OPEN
  -> PENDING_AGENT       successful agent request and reservation
  -> PENDING_OWNER       successful owner request and reservation

PENDING_AGENT
  -> SETTLED             successful token transfer callback
  -> FAILED_KNOWN        explicit failed token transfer callback
  -> RECONCILIATION      ambiguous or missing result

PENDING_OWNER
  -> SETTLED             successful token transfer callback
  -> FAILED_KNOWN        explicit failed token transfer callback
  -> RECONCILIATION      ambiguous or missing result

FAILED_KNOWN
  -> OPEN                owner calls reopen_failed_payable

SETTLED
  -> terminal

RECONCILIATION
  -> terminal for the hackathon contract unless an audited reconciliation method is later added
```

Pause, vendor changes, policy changes, binding changes, and key rotation never unlock a `PENDING`, `SETTLED`, or `RECONCILIATION` payable.

## 6. Agent payment request sequence

For `request_payment(payable_ref, request_digest, expected_policy_revision, expected_vendor_revision, expected_binding_revision)`:

1. Check the vault is not paused.
2. Check attached deposit is zero. The intended function-call access key cannot attach a deposit. A full-access caller that deliberately attaches a deposit receives a structured rejection; callers must not use this method as a NEAR-transfer mechanism.
3. Check predecessor equals signer.
4. Check predecessor, signer, and signer key match the active binding.
5. Check the binding is enabled and in its validity interval.
6. Check every expected revision against current state.
7. Find the payable. Unknown references return a structured rejection.
8. If the payable is pending or settled with the same digest, return its existing operation status without another transfer.
9. If the same payable carries a different digest, return a digest-conflict rejection.
10. Require payable status `OPEN`.
11. Require current time at or after `not_before_ns` and no later than `expires_at_ns`.
12. Find the vendor and require it is enabled.
13. Require payable vendor revision equals current vendor revision and the caller's expected revision.
14. Require payable amount no greater than the vendor per-payment cap.
15. Prune only rolling entries that are strictly outside the seven-day window.
16. Require rolling settled amount plus all agent reservations plus this amount no greater than `W`.
17. Require `S + R + amount <= C`.
18. Require recorded available token balance and bounded collection capacity.
19. Reserve first and lock the payable.
20. Emit an NEP-297 reservation event containing identifiers, amounts, revisions, and timestamps only.
21. Call the fixed token contract's `ft_transfer` with the locked recipient and amount, attaching exactly one yoctoNEAR.
22. Attach the private callback.
23. Return a structured accepted result containing the operation identifier and `PENDING` status.

No invoice body, email body, bank instructions, prompt text, or other untrusted document content is written to events or contract state.

## 7. Owner payment sequence

`owner_pay(payable_ref)` is the owner-signed escalation path for reviewed or over-cap items.

It still requires:

- the vault is not paused unless the team explicitly chooses owner payment while paused before merge;
- payable exists and is `OPEN`;
- payable is in its configured time window;
- vendor exists and is enabled;
- payable vendor revision is current;
- exact payable amount;
- locked recipient;
- sufficient available recorded balance;
- operation and callback capacity.

It does not consume the agent weekly cap or agent lifetime ceiling. It is tracked separately in `O` and remains single-payment locked.

## 8. Funding and withdrawals

### 8.1 Funding

Funding uses `ft_transfer_call` to the vault. `ft_on_transfer`:

- requires predecessor to be the fixed token contract;
- credits recorded token balance and available balance;
- emits a funding event;
- returns zero unused tokens;
- does not change `W` or `C`.

Direct token balance changes outside `ft_transfer_call` are not reflected in recorded accounting and are not spendable until an explicit reconciliation mechanism exists. Deployment scripts must use the supported funding path.

### 8.2 Withdrawal

`withdraw_available(recipient, amount_atomic)` requires:

- owner caller;
- vault paused;
- no unresolved payment operation;
- no unresolved withdrawal;
- amount no greater than recorded available balance;
- bounded operation capacity.

The vault reserves the withdrawal before dispatch and uses a private callback. A successful callback permanently reduces recorded balance. A known failed callback restores the withdrawal reservation exactly once. An ambiguous outcome remains reserved for reconciliation.

## 9. Structured request results

Rule failures in `request_payment` return a typed result and do not panic. Administrative programming errors may use explicit errors, but no normal agent policy rejection should consume all gas through a panic.

The minimum rejection vocabulary is:

- `VAULT_PAUSED`
- `NON_ZERO_ATTACHED_DEPOSIT`
- `CALLER_SIGNER_MISMATCH`
- `AGENT_ACCOUNT_MISMATCH`
- `AGENT_KEY_MISMATCH`
- `AGENT_BINDING_DISABLED`
- `AGENT_BINDING_NOT_YET_VALID`
- `AGENT_BINDING_EXPIRED`
- `STALE_BINDING_REVISION`
- `UNKNOWN_PAYABLE`
- `PAYABLE_NOT_OPEN`
- `PAYABLE_TOO_EARLY`
- `PAYABLE_EXPIRED`
- `REQUEST_DIGEST_CONFLICT`
- `UNKNOWN_VENDOR`
- `VENDOR_DISABLED`
- `STALE_VENDOR_REVISION`
- `STALE_POLICY_REVISION`
- `AMOUNT_OVER_VENDOR_CAP`
- `WEEKLY_CAP_EXCEEDED`
- `LIFETIME_CEILING_EXCEEDED`
- `INSUFFICIENT_RECORDED_BALANCE`
- `PENDING_CAPACITY_EXHAUSTED`
- `ROLLING_CAPACITY_EXHAUSTED`
- `OPERATION_CAPACITY_EXHAUSTED`

A rejection includes:

- code;
- payable reference when known;
- current revisions needed for a safe retry;
- current usage and requested amount when relevant;
- human-review recommendation;
- no raw invoice content.

## 10. Administrative revision rules

- Vendor revision starts at 1 and increments by exactly 1 on each accepted owner change.
- Policy revision starts at 1 and increments by exactly 1 on each accepted owner change.
- Binding revision starts at 1 and increments by exactly 1 on activation, replacement, or revocation.
- Owner mutation calls include `expected_revision` and reject stale writes.
- Revisions never wrap. The contract rejects a change if a revision is already at the numeric maximum.

## 11. Pausing rules

- The contract starts paused.
- Owner or guardian may pause.
- Only owner may unpause.
- Pausing blocks new agent requests.
- Pausing does not cancel or release pending operations.
- Private callbacks continue while paused.
- Owner administrative repairs needed to preserve accounting may remain available while paused.
- Withdrawal requires paused state and zero unresolved payments.

## 12. Bounded state

The contract configuration fixes maximum counts for:

- vendors;
- payables;
- operations;
- unresolved operations;
- rolling settled entries;
- event field lengths and identifiers.

Rejected requests do not create state. Registration fails before mutation when capacity is unavailable. Settlement capacity is reserved before a token transfer is dispatched.

Pruning rolling entries cannot remove the permanent paid lock, operation history needed for idempotency, or cumulative `S` and `O` totals.

Operation records are append-only and count against a finite lifetime capacity. The hackathon contract does not delete terminal operations or migrate state. A business that reaches that limit must replace the vault or adopt a separately audited migration design.

## 13. Events

Events follow NEP-297 with:

- `standard`: `spendgym`
- `version`: `1.0.0`
- typed JSON data

Expected event names include:

- `vault_initialized`
- `vault_paused`
- `vault_unpaused`
- `vendor_set`
- `payable_registered`
- `policy_set`
- `agent_activated`
- `agent_revoked`
- `payment_reserved`
- `payment_settled`
- `payment_failed_known`
- `payment_reconciliation_required`
- `payable_reopened`
- `vault_funded`
- `withdrawal_reserved`
- `withdrawal_settled`
- `withdrawal_failed_known`

Events never contain invoice text, prompts, email bodies, personal data, or secrets.

## 14. Evidence registry rules

The separate evidence contract is append-only.

- `commit_suite` records a suite commitment and bounded metadata.
- `register_run` records run identifier, manifest digest, suite commitment, and issuer.
- `publish_result` records report digest, execution status, and assessment outcome.
- A suite commitment cannot be replaced.
- A run identifier cannot be reused.
- A result cannot be replaced after terminal publication.
- The issuer is explicit. The hackathon issuer is the Spend Gym team, not an independent certification authority.
- Every registered run must be driven to a terminal result by the operational workflow, including aborted and infrastructure-error states.

The registry proves that published values were recorded at a point in time. It does not prove evaluator honesty, hidden-test secrecy, runtime identity, or correctness of grading.

## 15. Cross-tenant rule

Each business has a separate vault contract, balance, owner, vendors, payables, policy, and agent binding. Business A's agent key is installed only for Business A's vault and must fail at both the access-key layer and the contract caller checks when used against Business B's vault.

No shared mutable spending balance or tenant identifier exists inside one vault instance.

## 16. Required edge tests

The implementation is not complete until tests cover at least:

- wrong caller, signer, public key, proxy, expired binding, revoked binding, and agent attempts on owner methods;
- unknown, early, expired, stale-revision, pending, failed, and settled payables;
- exact cap and cap plus one atomic unit for vendor, rolling, and lifetime limits;
- two concurrent requests for one payable;
- distinct payables racing for the last budget;
- recipient not registered with the token;
- known token failure releasing exactly once;
- callback forgery and replay;
- pause and vendor change while a transfer is pending;
- owner payment of an item that the agent cap blocked;
- Business A key used against Business B;
- funding and withdrawal callbacks;
- rolling-window behavior one nanosecond before, exactly at, and one nanosecond after seven days;
- simulator and contract outcome parity for identical request sequences.

## 17. Merge-time questions

Before merging into the team repository, owners must decide and record:

1. Whether owner payment is permitted while paused. This implementation defaults to no.
2. Whether a `RECONCILIATION` operation can ever be owner-resolved on chain. This implementation keeps it locked and exposes it for inspection.
3. Exact shared-schema field names for `VaultRejection`, `PayableStatus`, `Operation`, `PaymentRequest`, `RequestResult`, and emitted event data.
4. Exact collection bounds and storage funding assumptions for the two demo vaults.
5. Whether due-date warnings are computed in the API or exposed as a vault view. The vault stores `due_at_ns`; queue warning policy belongs in the API.
