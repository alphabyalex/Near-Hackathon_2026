# Spend Gym NEAR payment vault

Spend Gym stress-tests invoice-handling AI agents and gives each business a separate NEAR payment vault. The vault only executes owner-approved payables and keeps enforcing exact recipients, exact amounts, time windows, vendor revisions, rolling limits, lifetime limits, and single-payment locks even when the agent or its request key is compromised.

This repository contains Tharun's crypto engineering lane for the NEAR Hackathon 2026 build. It is isolated on the `tharun` branch for review and later reconciliation with the team repository.

## What is implemented

- `docs/VAULT_RULES.md`: normative payment-vault specification and rejection vocabulary.
- `contracts/vault`: Rust NEAR vault contract.
- `contracts/evidence`: append-only evaluation evidence registry.
- `contracts/mock-token`: mock NEP-141 token named Spend Gym Test Dollar (`sgUSD`).
- `packages/vault-sim`: deterministic TypeScript model of the vault rules.
- `packages/vault-client`: typed NEAR gateway with final-outcome and ambiguity handling.
- `tests/sandbox`: NEAR sandbox authorization, accounting, adversarial, concurrency, and parity tests.
- `scripts/contracts`: build, testnet deployment, restricted-key audit, direct malicious-signer, and source-scan tools.
- `docs/status/tharun.md`: current verification, limitations, requests, and handoff state.

## Safety boundary

This code is for local NEAR sandbox and NEAR testnet only. It must not be configured for mainnet or used with assets of economic value. Never commit private keys, seed phrases, credentials, real invoices, real vendor payment details, or production account data.

The contracts enforce the owner's recorded payment mandate. They do not prove that an invoice represents a genuine debt, that goods were delivered, or that an approved vendor account is uncompromised.

## Pinned toolchain

- Rust `1.95.0`
- `near-sdk` and `near-contract-standards` `5.30.0`
- Node.js `22.22.2`
- pnpm `10.20.0`
- TypeScript `5.9.3`
- `near-api-js` `7.3.1`
- `near-workspaces` `5.0.0`

Node 22.22.2 is pinned because the selected `near-api-js` release requires it. Dependency lockfiles are committed after the verification publication gate.

## Reproduce from a fresh checkout

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
cargo fmt --all --check
cargo test --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
pnpm contracts:build
pnpm test:sandbox
pnpm scan:secrets
```

Expected results are recorded in `docs/status/tharun.md`. An unchecked or failed command is not represented as verified.

## Testnet operations

Build the Wasm files, then use the scripts documented in `scripts/contracts/README.md`:

```bash
pnpm contracts:build
pnpm --filter @spendgym/contracts-scripts deploy:testnet
pnpm --filter @spendgym/contracts-scripts inspect:keys
pnpm --filter @spendgym/contracts-scripts attack:restricted-key
```

The deployment command requires testnet-only environment variables. It creates two independent business vaults and two agent accounts whose installed keys are restricted to `request_payment` on their own vault. The generated manifest contains account IDs, code hashes, and public key permissions, never private keys.

## Team-repository handoff

The team repository's current `docs/CONTEXT.md`, `docs/OWNERSHIP.md`, and `packages/schemas` are authoritative. Before merging this lane, reconcile local types and rejection names with those files, preserve lane ownership, and rerun every command above from a fresh checkout.
