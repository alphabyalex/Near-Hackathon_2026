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
| Vault v2 change control | `contracts/vault` | Done, endpoints with cooldown and approver separation |
| Release Guard | `contracts/vault` | Done, manifest digest verification and conservative caps |
| Public Payee Registry | `contracts/payee-registry` | Done, opt-in domain-to-account directory with cooling-off |
| Payee Registry Client | `packages/vault-client` | Done, browser-safe RPC client implementing PayeeRegistry |
| Release Guard and Registry Specs | `docs/RELEASE_GUARD.md`, `docs/PAYEE_REGISTRY.md` | Done |
| Model Registry Contract | `contracts/model-registry` | Done, TEE signer attestation directory with DAO management |
| Meter Gateway Contract | `contracts/meter` | Done, on-chain EIP-191 ecrecover proof verification, USDC `ft_on_transfer` budget funding, and provider payouts |
| Cover Pool Contract (Mutual) | `contracts/cover-pool` | Done, WARD NEP-141 share token, junior first-loss, senior USDC `ft_on_transfer` minting, delayed `redeem`, and price history |
| Chain Clients (Meter, Registry, Pool) | `packages/vault-client` | Done, typed NearMeterClient, NearModelRegistryClient, NearCoverPoolClient with full WARD & redeem support |
| Chain Switch-over | `services/api/src/chain/index.ts` | Done, native NearCoverPoolClient without temporary adapter |
| DAO Governance Spec | `docs/DAO.md` | Done, Sputnik v2 proposal mappings and methods |
| Live Sandbox Meter and Pool Tests | `tests/sandbox/test/chain-meter-pool.test.ts` | Done, 20/20 tests passing on live sandbox |
| Testnet Deployment Prep | `scripts/contracts/src/deploy-wardline-chain.ts` | Done, automated deployment and manifest generator |

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
| Rust unit tests (`cargo test --workspace`) | 64 passed across all 8 contract crates (38 vault, 5 payee-registry, 4 meter, 2 model-registry, 4 cover-pool, 10 evidence, 1 mock-token) |
| `packages/vault-sim` | 50 passed |
| `packages/vault-client` | 12 passed |
| `tests/sandbox/test/chain-meter-pool.test.ts` | 20 passed |
| `tests/sandbox/test/v2-endpoint-release.test.ts` | 11 passed |
| `tests/sandbox`, on a real local node | All suites pass |
| Root `pnpm test`, Linux/macOS, in a clean clone | All workspaces pass (754+ unit and integration tests) |

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

- `@redline/vault-client`:
  - `NearVaultGateway`: implements `VaultGateway`. Reads environment configurations and manages payments, bindings, policies, and queries.
  - `PayeeRegistryClient`: implements `PayeeRegistry` from `@redline/sdk`. Provides browser-safe RPC view calls (`getVendor`, `listVendors`, `findByAccount`, `resolve`, `isVerifiedPayee`) and authenticated actions (`attestVendor`, `proposeUpdate`, `revokeVendor`).
  - `VaultAdmin`: administrative control exposing `proposeEndpoint`, `approveEndpoint`, `activateEndpoint`, `rejectEndpoint`, `revokeEndpoint`, and `raiseBindingCaps`.
  - `NearEvidenceClient`: read views and issuer methods for the evidence registry.
- `@redline/vault-sim`:
  - `VaultSim`: in-memory simulator matching all Vault v2 rules, endpoint revisions, Release Guard manifest checks, and conservative authority tiers.
  - `SimVaultGateway` and `createGymVaultSim`: Gym-compatible gateway with simulated clock controls and transfer logging.
- `@redline/schemas`:
  - `PaymentRequestSchema` updated to include optional `manifest_digest: DigestSchema.optional()`.
  - `VaultRejectionSchema` updated with `ENDPOINT_REVISION_MISMATCH`, `PAYEE_NOT_VERIFIED`, and `RELEASE_MISMATCH`.
- `contracts/payee-registry`:
  - Opt-in public registry for cross-agent payee resolution with cooling-off protection.
- `docs/RELEASE_GUARD.md`:
  - Release manifest coverage, gateway trust boundaries, conservative authority caps, and event specifications.
- `docs/PAYEE_REGISTRY.md`:
  - Directory architecture, CAIP-10 account normalization, attestor first-listing, self-service updates, and vault independence.

## USDC and WARD Mutual Implementation (2026-11-08)

All requested features from Alexander's update have been built and verified:
1. **Meter Contract (`contracts/meter`)**:
   - `ft_on_transfer`: accepts USDC via NEP-141 with `{"action":"fund","budget_id":"..."}` to deposit directly into member budgets.
   - `settle`: supports optional `pay_to` account destination for provider settlements in USDC.
2. **Cover Pool Contract (`contracts/cover-pool`)**:
   - Implements full NEP-141 token interface for WARD ("Wardline Mutual share", symbol WARD, 6 decimals): `ft_total_supply`, `ft_balance_of`, `ft_metadata`, and `ft_transfer`.
   - `ft_on_transfer`: accepts USDC deposits, minting WARD at `senior_assets / ward_supply` (starting at 1.0 USDC).
   - `request_withdraw`: locks caller's WARD shares.
   - `redeem`: burns locked WARD shares and releases USDC at the day's price once the 7-day delay has elapsed.
   - Views: `ward_supply`, `ward_price`, `launch_price` ("1000000"), `price_history`, and `ward_price_before`/`ward_price_after` on claims.
   - Parameter updates: DAO owner can set `trade_url` via `set_param("trade_url", url)`.
3. **Clients and Chain Integration**:
   - `NearCoverPoolClient` implements `CoverPoolClient` from `services/api/src/chain/types.ts` directly.
   - Removed temporary `wardPoolAdapter` from `services/api/src/chain/index.ts`.
4. **Testing and Verification**:
   - 20/20 live sandbox tests in `tests/sandbox/test/chain-meter-pool.test.ts`.
   - 11/11 live sandbox tests in `tests/sandbox/test/v2-endpoint-release.test.ts`.
   - 64 Rust unit tests passing across all 8 workspace crates.
   - 754+ TypeScript workspace tests passing with 0 failures.
   - Brand guard verified (5/5 passed). Zero em dashes throughout the repo.

### Payee Registry wiring for Alexander (services/api/src/payee/runtime.ts)

Alexander, here is the exact snippet to wire `PayeeRegistryClient` at the marked TODO in `services/api/src/payee/runtime.ts`:

```typescript
  if (registryMode === "near") {
    const vaultClient = await importOptional("@redline/vault-client");
    if (!vaultClient?.PayeeRegistryClient) {
      throw new Error("REDLINE_REGISTRY_MODE=near needs PayeeRegistryClient from @redline/vault-client, which has not landed.");
    }
    const registryContractId = env.REDLINE_PAYEE_REGISTRY_ID ?? "payee-registry.redline-labs.testnet";
    const rpcUrl = env.NEAR_RPC_URL ?? DEFAULT_NEAR_RPC;
    const client = new (vaultClient.PayeeRegistryClient as typeof PayeeRegistryClient)({
      registryId: registryContractId,
      rpcUrl,
    });
    backends.registry = {
      getVendor: (domain) => client.getVendor(domain),
      listVendors: () => client.listVendors(),
      findByAccount: (caip10) => client.findByAccount(caip10),
      attestVendor: (input) => client.attestVendor(input),
    };
  }
```

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
