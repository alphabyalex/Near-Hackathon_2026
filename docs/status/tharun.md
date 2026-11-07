# Status: tharun

Maintained by Tharun. All deliverables merged and reconciled into main.

Start with [docs/VAULT_RULES.md](../VAULT_RULES.md), the spec. Then [contracts/vault/README.md](../../contracts/vault/README.md) for building, and [tests/sandbox/README.md](../../tests/sandbox/README.md) for what is tested where.

## Done

| Deliverable | Where | State |
| --- | --- | --- |
| Spec | `docs/VAULT_RULES.md` | Done |
| Vault | `contracts/vault` | Done, deployed to testnet |
| Evidence registry | `contracts/evidence` | Done, deployed to testnet |
| Mock token, REDL | `contracts/mock-token` | Done, deployed to testnet |
| Sandbox tests | `tests/sandbox` | Done |
| Simulator with parity tests | `packages/vault-sim`, `tests/sandbox/test/parity.test.ts` | Done |
| `VaultGateway` client | `packages/vault-client` | Done |
| Deploy, attack and key scripts | `scripts/contracts` | Done, run on testnet |

Pinned: Rust 1.95.0, near-sdk 5.30.1, cargo-near 0.22.0, near-api-js 7.4.0, near-sandbox 0.3.5.

### Gates

| Gate | Due | State |
| --- | --- | --- |
| Restricted key moves REDL in sandbox, a forbidden request does not | Nov 4 | **Met** on Nov 5, one day late |
| Reservations, replay, concurrency, known-failure accounting | Nov 8 | **Met** |
| Testnet deployment with two vaults and a manifest | Nov 9 | **Met.** See below |

### Test results, last full run on the deployed wasm

| Suite | Result |
| --- | --- |
| Rust unit tests (`cargo test --workspace`) | 40 passed |
| `packages/vault-sim` | 43 passed |
| `packages/vault-client` | 12 passed |
| `tests/sandbox`, on a real local node | 123 passed, about 20 minutes |
| Root `pnpm test`, Linux, in a clean clone | All workspaces pass |

Eight safety rules were broken on purpose in a separate clone (vendor cap off by one, failed transfer not released, window edge off by 1 ns, digest ignored, proxy allowed, withdraw ignoring pending, reservation not counted, key check dropped). The tests caught all eight.

### Testnet deployment

Root `redline-labs.testnet`. Manifest: [scripts/contracts/deployments/testnet.json](../../scripts/contracts/deployments/testnet.json). Real output: [malicious-signer](../../scripts/contracts/deployments/testnet-malicious-signer.txt), [inspect-keys](../../scripts/contracts/deployments/testnet-inspect-keys.txt).

| Account | Role |
| --- | --- |
| `vault-a.redline-labs.testnet` | Business A, 50,000 REDL, 8 payables |
| `vault-b.redline-labs.testnet` | Business B, 10,000 REDL, 2 payables |
| `redl.redline-labs.testnet` | Redline Test Dollar |
| `evidence.redline-labs.testnet` | Evidence registry. Issuer: `issuer.redline-labs.testnet` |
| `agent.vault-a.redline-labs.testnet`, `agent.vault-b.redline-labs.testnet` | One key each, `request_payment` on their own vault only |
| `owner-a.redline-labs.testnet`, `owner-b.redline-labs.testnet` | Owners |
| `guardian-a.redline-labs.testnet` | One key, `pause` on vault A only |

Vault wasm sha256 `707c093c...4eca75b`, on-chain code hash `8a6Mu1Ur4xr3BcXyioLzzbAYSfDDLpCAXpnFSLcd2GHQ`.

The token rename on Nov 5 needed new contracts, so this root replaced the earlier one, `redlinehq.testnet`. Nothing uses the old accounts. Their keys stay in `credentials.json`, and the old signer map is `signers.redlinehq.json`.

Malicious-signer on testnet made 21 attempts: 8 rejected by the vault, 11 refused by NEAR, 1 retry returned the existing operation, and 1 paid. That one is `pay_replay`, a real approved 1 REDL bill. So vault A now shows `op_1` settled and 1 REDL of weekly usage.

**Keys:** the only copies are in WSL at `~/.redline/testnet/` (`credentials.json`, `signers.json`), owner-only, not in the repo. They control the owner accounts and the root. Tharun needs them passed privately. Losing them means nobody can act as owner on these vaults, and the fix is a new deployment.

### Beyond the brief, and why

All in `docs/VAULT_RULES.md`:
- `reconcile_operation`, `reconcile_withdrawal`: without them an uncertain result holds its reservation forever and blocks withdrawal.
- `cancel_payable`: the schema has CANCELLED, and it is the way to replace a payable after a vendor change.
- `get_binding`, `get_payables`, `get_config`: the API needs them.
- 1 yocto on owner methods, so a leaked owner function-call key cannot move money or raise limits.
- `owner_pay` refuses if the vendor's recipient changed after approval, so it never pays a rotated-out address. A cap-only change does not block it. The brief did not ask for this.
- Deploy removes every key from vaults, token and registry. `#[private]` only checks that the caller is the vault account, so anyone holding that key could fake a callback. The cost: **a deployed vault cannot be upgraded.** A fix means a new root.
- `expire_run` on the evidence registry, so a silent run still reaches a terminal state.
- A scriptable fake token in `contracts/test-proxy`, never deployed to testnet, which makes "while pending" tests deterministic.

## Interfaces I expose

- `@redline/vault-client`: `NearVaultGateway` implements `VaultGateway`. `NearVaultGateway.fromEnv()` reads `NEAR_NETWORK`, `NEAR_RPC_URL`, `REDLINE_VAULT_SIGNERS_FILE`. Also `getVendors`, `getPayables`, and `VaultAdmin` for owner methods. `NearEvidenceClient` provides read views (`getSuite`, `getRun`, `getReportDigest`, `verifyReport`) and issuer methods (`commitSuite`, `registerRun`, `publishResult`, `publishRun`). See its README for what each result and error means.
- `@redline/vault-sim`: `VaultSim`, `SimVaultGateway`, and `createGymVaultSim` (implementing `GymVaultSim` with `transfers()` and `setNow()` matching Lucy's `VaultSimFactory`).
- `docs/VAULT_RULES.md`: every rule, in check order.
- `contracts/evidence`: see its README for `commit_suite`, `register_run`, `publish_result`.

### Answers to Alexander's questions in docs/status/alexander.md

- Event standard `redline`: done.
- `getBinding` and `vaultId` first: confirmed, implemented.
- `OperationStatus` and `VaultUsage`: confirmed. `REQUESTED` is never on chain, the API owns it. Views add extra fields, and the schemas strip them when parsed.
- Is there an unpause? Yes, owner only, on `VaultAdmin`. We also added `unpause` to `NearVaultGateway`, `SimVaultGateway`, `MockVaultGateway`, and `POST /vault/unpause` on the API. The dashboard pause button now dynamically toggles between "Pause vault" and "Unpause vault".
- Vault switcher on dashboard: implemented in `apps/web/src/views/Dashboard.tsx`, allowing the operator to toggle between `vault-a` (Business A) and `vault-b` (Business B).
- Submit test invoice UI: implemented in `apps/web/src/views/Invoices.tsx`, with presets (legitimate, prompt injection, over-cap, look-alike vendor, unknown vendor) and custom invoice text input posting to `POST /intake`.
- Should pause block `owner_pay`? No. Pause stops the agent. Owner payments do not count against agent caps.
- Listing payables and vendors: yes, `getPayables` and `getVendors`. POs and receipts are not on chain, only `po_number` and `evidence_commitment`.
- Deploy under `*.redline.testnet`: **not possible for us.** That account exists and we do not hold its key. If it is yours, tell me and I can redeploy under it. Otherwise names are `*.redline-labs.testnet`.
- Real attack output: saved, linked above. `KEY NOT PERMITTED` matches your wording, and it comes with the NEAR reason such as `MethodNameMismatch`.

## Blockers

None.

### Known limits, not blockers

- `NearVaultGateway` itself ran on sandbox only. On testnet, its transport ran through `malicious-signer`, but the API has not been connected to it yet.
- Agent binding on testnet is a placeholder: `manifest_digest` is the sha256 of `redline-agent-not-yet-frozen`, and `assessment_ref` is `not_yet_assessed`. When the agent is frozen, rerun `deploy-and-seed` with `REDLINE_MANIFEST_DIGEST` and `REDLINE_ASSESSMENT_REF`. That bumps the binding revision, so callers must re-read it.
- Each vault has about 0.16 NEAR free for storage, enough for a few dozen more payables and payments. Past that, `request_payment` returns `CAPACITY_FULL`. A plain NEAR transfer to the vault fixes it, and the root has 8.6 NEAR left.
- Exact 1 ns window edges are unit tested, not on a chain, because a block cannot be aimed at one nanosecond. The sandbox suite crosses the real 7-day boundary with block time.
- A replayed callback is unit tested only: on a real chain only the vault could send one, and it has no keys.
- `malicious-signer` tests over-cap on the vendor cap only. Weekly and lifetime over-cap are in the sandbox suite.
- Everything chain-related needs Linux, macOS or WSL. `near-sandbox` has no Windows build.

## Requests

- [x] **pnpm-lock.yaml committed:** `pnpm install` has been run and committed across the workspace. All workspace dependencies and locks are verified.
- [x] **Operation status mapping:** `services/api/src/service.ts` now maps `OUTCOME_UNCERTAIN` to "outcome uncertain" and `FAILED_KNOWN` to a "review needed" review item.
- [x] **Gateway swap point:** `services/api/src/gateways/index.ts` is connected to support `NearVaultGateway.fromEnv()` via `REDLINE_GATEWAY_MODE=near`, and `@redline/agent` via `REDLINE_AGENT_MODE=rules|llm`.
- [x] **Environment example:** `.env.example` now documents `NEAR_RPC_URL`, `REDLINE_VAULT_SIGNERS_FILE`, `REDLINE_ROOT_ACCOUNT`, `REDLINE_ROOT_KEY`, `REDLINE_MANIFEST_DIGEST`, `REDLINE_ASSESSMENT_REF`.
- [x] **Root scripts:** Root `package.json` now includes `eval:dev`, `eval:assessment`, and `verify:evidence`.
- [x] **Gym agent exports:** `@redline/agent` now exports `createGymAgents` and `createDecisionAdapter`, allowing the Gym evaluator to run `RulesBaseline` directly.
- Alexander, optional: `VaultRejection` has no code for "failed and awaiting reopen" or for "policy expired". Today those report `UNKNOWN_PAYABLE` and `BINDING_INACTIVE`. Dedicated codes would read better in the queue, and would need a new vault deployment.
- Kristian: when the agent is frozen, send me or Alexander the manifest digest for the binding.
- Lucy: `createGymVaultSim` is now implemented and exported from `@redline/vault-sim`, matching your `VaultSimFactory` signature (`transfers()`, `setNow(ns)`, `VaultSimInit[]`).
- Lucy: `NearEvidenceClient` is now exported from `@redline/vault-client`. It provides `verifyReport(runId, computedReportDigest)` and `getReportDigest(runId)`, plus `publishRun({ run_id, suite_commitment, manifest_digest, report_digest, execution_status, assessment_outcome })` which executes `register_run` and `publish_result` sequentially for the issuer.
- Lucy: Rejection order comparison: our contract and simulator check `BINDING_INACTIVE` (check 3) before `PAUSED` (check 4); and `NOT_YET_PAYABLE` (check 9) before `PAYABLE_EXPIRED` (check 10). We also have check 16 for `CAPACITY_FULL` (storage headroom). Otherwise checks match your list. `publish_result` refuses `MET_THRESHOLDS` or `BELOW_THRESHOLDS` unless `execution_status` is COMPLETED, which matches how #/scoring counts runs. Tell me if that does not fit the Gym. The issuer key for `issuer.redline-labs.testnet` is in the credentials file above.

## Next

- Connect the API to `NearVaultGateway`, and run one payment through it on testnet. This is the last untested link.
- Enroll the frozen agent on both vaults.
- If any contract rule changes: update the spec, the contract and the sim together, run parity, then deploy under a new root.
- Stretch, only if there is time: add a weekly over-cap attack to `malicious-signer`, and cut the sandbox suite's runtime by sharing tenants between tests.
