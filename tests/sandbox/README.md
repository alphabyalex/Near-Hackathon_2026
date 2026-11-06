# tests/sandbox

Owner: Tharun

Tests against a real local NEAR node, so token transfers, receipts, callbacks and key permissions are the real thing.

## Run

Needs Linux, macOS or WSL (`near-sandbox` has no Windows build), plus the wasm from `scripts/contracts/build.sh`.

```bash
pnpm install
bash scripts/contracts/build.sh
pnpm --filter @redline/sandbox-tests test:sandbox              # everything, about 20 minutes
cd tests/sandbox && npx vitest run test/gate.test.ts           # one file, after building the TS packages once
```

Root `pnpm test` does not run these. It stays fast and works on Windows.

## What is covered

| File | Covers |
| --- | --- |
| `gate.test.ts` | The first gate: the restricted key moves REDL, a forbidden request does not. |
| `access.test.ts` | Wrong caller, wrong key, proxy caller, revoked and expired binding, agent calling owner methods, guardian limits, deposits, low gas, tenant A against vault B. |
| `payables-caps.test.ts` | Unknown, early, expired, already paid and stale payables. Exact cap and cap plus one atomic unit for vendor, weekly, lifetime and balance. Capacities. `owner_pay` on an over-cap item. |
| `money.test.ts` | Two concurrent requests for one payable. Distinct payables racing for the last budget. Missing recipient registration. Token failure releasing once. Uncertain results. Forged callbacks. Pause, vendor change, revoke and policy change while pending. A client timeout that is not a failure. |
| `funding-withdraw.test.ts` | Only the fixed token funds. Funding never raises a limit. Every withdrawal path. |
| `window.test.ts` | The real wasm crossing the real 7-day boundary. The settled entry is back-dated so the boundary is about 40 seconds away. |
| `parity.test.ts` | The same request sequences on the contract and `packages/vault-sim`, including generated ones. Stops at the first difference in a result or in any state. |
| `evidence.test.ts` | The evidence registry is append-only, and only the issuer publishes. |
| `scripts.test.ts` | `deploy-and-seed`, `malicious-signer` and `inspect-keys`, run for real. |

## Things a sandbox cannot do, and where they are tested instead

| Case | Where |
| --- | --- |
| Rolling window exactly 1 ns before, at, and 1 ns after 7 days | `contracts/vault/src/tests.rs` and `packages/vault-sim/test`, since block times cannot be chosen |
| A replayed callback | `contracts/vault/src/tests.rs`. On a real chain only the vault can call its own callback, and a deployed vault has no keys. |
| An unexpected number of promise results | `contracts/vault/src/tests.rs` |

Sandbox fast-forward moves about 0.3 chain seconds per block, so reaching 7 days would take hours. `Chain.ageRolling` uses `sandbox_patch_state` to back-date rolling entries instead, on the same wasm we deploy. It reads the end of the vault's borsh state, so if you reorder the `Vault` struct's fields it fails with a clear error: keep `rolling`, `pending_count` and `agent_pending_count` last.

## The fake token

`contracts/test-proxy` doubles as a scriptable token: `ok`, `fail`, `weird` (succeeds with a value `ft_transfer` never returns), and `hold` (waits using NEAR's yield and resume until a test releases it). `hold` is why the "while pending" tests are deterministic rather than a race against block timing.
