# Tharun status

Updated: 2026-11-05 UTC

## Done

- Kept all repository work on the isolated `tharun` branch. The repository `main` branch remains untouched.
- Wrote `docs/VAULT_RULES.md` before contract implementation.
- Implemented the Rust NEAR payment vault, append-only evidence registry, and mock six-decimal `Spend Gym Test Dollar` (`sgUSD`) token.
- Implemented exact payable amounts, locked recipients, vendor revisions, per-vendor caps, a rolling seven-day cap, a finite lifetime ceiling, reservations, replay protection, callback reconciliation, owner escalation, funding, withdrawals, bounded collections, and NEP-297 events.
- Bounded callback result reads. An oversized or otherwise unclassifiable callback result stays in `RECONCILIATION`, preserving the reservation and payable lock.
- Implemented the pure TypeScript vault simulator with the contract's state model, `u128` input domain, rejection vocabulary, reservation rules, and overflow-safe cap checks.
- Added 22 deterministic simulator tests, including UTF-8 bounds, locked recipients, pending accounting, exact rolling-window boundaries, replay, known and ambiguous outcomes, owner escalation, withdrawals, tenant isolation, `u128` limits, cap overflow, and randomized invariants.
- Implemented the typed vault client with final execution waiting, nullable structured rejections, lossless `U64` operation identifiers, and ambiguity-safe on-chain reconciliation. It never treats a timeout as a known failure or automatically retries an uncertain payment.
- Added Rust tests for authorization, exact and over-cap boundaries, competing payables, callback replay, oversized callback results, ambiguity, rolling expiry, owner escalation, withdrawal outcomes, evidence finality, and mock-token metadata.
- Added NEAR sandbox tests for restricted-key authorization, proxy calls, revocation, expiry, cross-tenant attempts, payable lifecycle, exact cap boundaries, storage-registration failure, owner escalation, concurrency, rolling expiry, and simulator parity.
- Added testnet-only deployment and seeding, access-key inspection, direct malicious-signer, Wasm build, and source-scan tools.
- Testnet deployment installs exactly one finite function-call key on each agent, restricted to `request_payment` on its own vault. It removes temporary full-access bootstrap keys from every deployed contract and synthetic vendor account after seeding.
- Added six deterministic deployment-helper tests and five vault-client tests.
- Added a pinned GitHub Actions pipeline for TypeScript, Rust, Wasm, sandbox, and source-safety checks.
- Diagnosed the first Rust CI failure as release drift inside `near-sdk` 5.30.0's permissive internal dependency ranges. Pinned the exact matching release set: `near-sdk-macros` 5.30.0, `near-sys` 0.4.0, `near-sdk-env` 0.1.8, `near-sdk-core` 4.4.1, and `near-global-contracts` 0.3.2.

## Interfaces I expose

- `docs/VAULT_RULES.md`: normative contract behavior, accounting rules, state transitions, and rejection vocabulary.
- `contracts/vault`: one-business vault with owner administration, restricted agent requests, exact payables, reservations, callbacks, escalation, funding, withdrawals, and bounded state.
- `contracts/evidence`: append-only suite commitments, run registration, and terminal result publication with an explicit issuer.
- `contracts/mock-token`: test-only NEP-141 `sgUSD` token.
- `packages/vault-sim`: deterministic reference model and invariant checks for fast Gym evaluation.
- `packages/vault-client`: transport-neutral gateway plus a `near-api-js` transport.
- `tests/sandbox`: local-chain security, accounting, concurrency, and simulator-parity tests.
- `scripts/contracts`: testnet deployment, key audit, malicious-signer, build, and source-scan commands.

## Blockers and limitations

- The authoritative team repository is not connected here, so its current `packages/schemas`, `docs/CONTEXT.md`, and `docs/OWNERSHIP.md` have not been reconciled. Those files win during the final merge.
- No testnet deployment has been executed because funded account credentials and final account naming were not supplied. No private key is stored in this repository.
- `owner_pay` is blocked while the vault is paused. The team should explicitly confirm this policy before merge.
- A payment in `RECONCILIATION` remains reserved and the payable remains locked. No unaudited owner override is included.
- Operation history is intentionally finite and append-only. A vault eventually reaches its configured lifetime operation capacity and then requires replacement or a separately audited migration design.
- A direct NEP-141 transfer that does not use `ft_transfer_call` can increase the token contract's real balance without increasing the vault's recorded spendable balance. Deployment uses only the supported funding path.
- The evidence contract records team-issued evidence. It does not prove evaluator honesty, hidden-suite secrecy, or runtime identity by itself.
- Sandbox time advances in blocks, so the contract and simulator unit suites carry the exact one-nanosecond-before and exact-seven-day boundary assertions. Sandbox covers before and clearly after the boundary.
- Pause and vendor-change behavior while a transfer is pending is covered at contract unit level. The sandbox library does not expose deterministic receipt interleaving for that exact race.

## Verification

- PASS locally: simulator TypeScript compilation with the available global compiler.
- PASS locally: 22 of 22 simulator tests.
- PASS locally with a temporary ignored API declaration matching the pinned library surface: vault-client TypeScript compilation and 5 of 5 client tests.
- PASS locally with temporary ignored dependency declarations: contract-script TypeScript compilation and 6 of 6 helper tests.
- PASS locally: JavaScript syntax checks for every sandbox test.
- PASS locally: shell syntax checks for build and source-scan scripts.
- PASS locally: tracked authored source contains no em dash characters.
- PASS locally: source scan found no committed private key, seed phrase, mainnet endpoint, generated dependency directory, or generated build output.
- PASS from the earlier remote TypeScript gate: simulator and vault-client tests before the later parity and deployment hardening commits.
- FAILED, diagnosed, and fixed locally: the first remote Rust gate selected newer internal NEAR crates that were incompatible with `near-sdk` 5.30.0. Exact internal version pins are now committed locally and need a fresh remote gate.
- PENDING: Rust formatting, Rust tests, Clippy, Wasm builds, and full NEAR sandbox execution after the exact dependency pins are published.
- NOT RUN: testnet deployment, live key inspection, and malicious-signer execution because credentials are intentionally absent.

## Requests for the merge agent

- Reconcile local `VaultRejection`, `PayableStatus`, `Operation`, `PaymentRequest`, usage, and event types with the team `packages/schemas`.
- Confirm whether `owner_pay` should remain blocked while paused.
- Preserve the distinction between an unsafe agent proposal and a vault containment success in evaluator reporting.
- Supply testnet account IDs and credentials only through the execution environment, then run deployment, key inspection, and the direct restricted-key attack script.
- Commit only the public deployment manifest containing accounts, code hashes, and key permissions. Never commit private keys.

## Next

- Publish the exact NEAR dependency pins and rerun the Rust gate.
- Repair any project compiler, Clippy, Wasm, or sandbox failure exposed after dependency resolution succeeds.
- Generate and commit `Cargo.lock` and `pnpm-lock.yaml`, then rerun the README from a fresh checkout with frozen and locked installs.
- Reconcile shared schemas, then move the verified lane into the team repository.
- Deploy only to NEAR testnet after explicit account and key setup.
