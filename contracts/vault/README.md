# Spend Gym vault contract

NEAR contract implementing the bounded payment mandate in `docs/VAULT_RULES.md`.

## Toolchain

- Rust 1.95.0
- near-sdk 5.30.0
- near-contract-standards 5.30.0
- wasm32-unknown-unknown target

## Security properties implemented

- starts paused;
- owner-only administration with optional pause-only guardian;
- exact agent account and public-key binding;
- predecessor must equal signer for agent calls;
- exact payable amount and registered recipient;
- payable and vendor revision matching;
- per-vendor, rolling seven-day, and lifetime limits;
- pending reservations consume balance and both aggregate limits;
- future rolling-history capacity is reserved before dispatch;
- same-digest replay is idempotent;
- callback success and failure are idempotent;
- ambiguous callback shape preserves reservations for reconciliation;
- owner escalation remains exact-amount and single-payment locked;
- funding only through the fixed NEP-141 token receiver path;
- withdrawal only while paused with no unresolved payment;
- all persistent collections have configured bounds.

## Build

```bash
cargo build --target wasm32-unknown-unknown --release -p spend-gym-vault
```

The output is expected at:

```text
target/wasm32-unknown-unknown/release/spend_gym_vault.wasm
```

## Important limitation

The contract enforces the owner's recorded mandate. It does not prove that a payable reflects a real commercial debt, that goods were delivered, or that an approved vendor account is uncompromised.
