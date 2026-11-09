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

## T4.5 Testnet Deployment and Phase 3 Proof Results (2026-11-08)

All T4.5 contracts are deployed to NEAR testnet, configured with Circle testnet USDC, and all 6 Phase 3 end-to-end verification flows are proven with live on-chain transaction hashes.

### Deployed Contracts and Accounts (NEAR Testnet)

- **Network:** `testnet`
- **Circle USDC Account:** `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (6 decimals)
- **Deployment Manifest:** `scripts/contracts/deployments/testnet-wardline.json`
- **Root Account:** `wardline-labs.testnet`

| Contract | Testnet Account ID | Code Hash / Description |
| --- | --- | --- |
| Payee Registry | `payee-registry.wardline-labs.testnet` | `070fb4304fde21baf8e1a179d704e9bc5ca8f8620db60382d76e839162a62f2a` |
| Vault | `vault.wardline-labs.testnet` | `e4473c15f3ef33cd97077735d432fa20279486f5f8a0f7306aca8df0d4f8aa6e` |
| Model Registry | `model-registry.wardline-labs.testnet` | `bb0073f7dd9e1ae66b334f8faa0e98f40d1cef53ff48fff636fa1f720fa8a995` |
| Cover Pool | `pool.wardline-labs.testnet` | `2b99a2bac9242ad6224c3d4fe14e1fb54174ea2f8659adde81abe66cd6ecea5a` |
| Meter | `meter.wardline-labs.testnet` | `12fd0d4c87fb8624161878adb6d4e690bbc7a361a34c95a6927a0a42e2a3a1cb` |
| Sputnik DAO v2 | `dao.wardline-labs.testnet` | `880bae9a58c99ec1efe8b10cf834b3f0c0ebc7a05d71206f3c1202c4280952da` |

### Demo Accounts and Signers

- **Provider:** `provider.wardline-labs.testnet`
- **Investor 1:** `investor1.wardline-labs.testnet`
- **Investor 2:** `investor2.wardline-labs.testnet`
- **Agent:** `agent.wardline-labs.testnet`
- **Meter Gateway Key:** `ed25519:8GCuoS7j5w8KPqcuUWPkva4La2EVz2BYNyvcUDHJ7dbX` (granted function-call access for `reserve`, `settle`, `release`)
- **DAO Council:** `["wardline-labs.testnet", "investor1.wardline-labs.testnet", "investor2.wardline-labs.testnet"]` (threshold: 2-of-3)

### Phase 3 Live End-to-End Proofs and Transaction Hashes

All 6 testnet verification flows were executed on NEAR testnet and verified on-chain:

#### 1. One Paid AI Call (DeepSeek V4.1 Flash)
- **Reservation Tx:** `4au3yM4pPgkqHPqKd8DSPyAo61PaUaXcroPgpYEDqVyk` (reserved 0.05 USDC on `bgt_engineering`)
- **Settlement Tx:** `2S7GMteqbPLF2cysyyn7FZwzYYxyBKgzZRbHxhhod7CS`
- **Outcome:** Genuine NEAR AI EIP-191 signature (`0xfe0071895500a9755c18044948ab4f4e1a7f337e`) verified on-chain. USDC transferred from budget: 48,750 units paid to provider `provider.wardline-labs.testnet`, 1,250 units cover fee transferred to `pool.wardline-labs.testnet`.

#### 2. One Refused Swapped-Model Call
- **Reservation Tx:** `5PzQVZLfnCEyD5CApMZvi4de3K6MtsKhiHjVfKiEmGzb`
- **Refused Settlement Tx:** `FRzvoZ8bevbrvLKSSNnef3uEvAwp5xNGwtcNiKYmLkbp`
- **Release / Refund Tx:** `3ML4vKLGisUqy5zBodQf2rJ2J44vY1ytTxE1zDwQsskE`
- **Outcome:** Model inference returned an un-attested signer (`0x111111...`). Settle refused on-chain with `MODEL_NOT_ATTESTED`. Reservation released and 100% of reserved funds refunded to the budget. Provider received zero USDC.

#### 3. Leaked-Key Cap (20 Rapid Calls)
- **Budget Deposit Cap:** 50,000 units on `bgt_leaked_1794187233942`
- **Calls 1 to 4:** OK (each reserved 10,000 units: `GkN4ik9hsCBzosdqg7SWZQsznpb9b6kXgokYTsaNFMSs`, `5RkHxrhJprUDxefCyiq454XB4LBjEf1LnkvTQWPc2qhb`, `APNF6iJMo9u4GCLrYJYFZhohRbFj5hppWnz7p6RtYVEg`, `8hhSxzVoCGbuA3rxxqkX8B5hLRbcBrpwEVMExUZmnWWw`)
- **Call 5 (Drains Budget) Tx:** `82bGdEmVChKafZigVuNW5RjxSjRb3ZkSyHgAKSbQRBFd`
- **Call 6 (Refused) Tx:** `Gqn92MuM3TcKYwE19anX512H51hRPfvNHEroE5thnmPn` (blocked with `ALLOWANCE_EXHAUSTED` / `BUDGET_EXHAUSTED`)
- **Calls 7 to 20:** All refused on-chain before any provider spend could occur.

#### 4. One DAO Proposal (2-of-3 Council Vote and Execution)
- **Proposal Submission Tx:** `AcccRAo52udzzZduutmv41oFEJCwYwX29o5Zd6G78uuy` (proposes setting meter cover fee to 2.5% / 250 bps)
- **Council Vote 1 (wardline-labs) Tx:** `BzhsfiKx1faBMg5wfZhz2WjSQUxv86yRKCQmPtFFydJH`
- **Council Vote 2 & Execution (investor1) Tx:** `4wC4aa1xUQwG2VUhsU78UmBamFGpDqBBGckvfRjGdbsZ`
- **Verification:** Querying `get_cover_fee_bps` on `meter.wardline-labs.testnet` returns `250`.

#### 5. One Mutual Payout (First-Loss Absorption)
- **First-Loss Stake Deposit Tx:** `Akb8hNQtV2DqRocZt3UvfQDS8xqUWREJdjbmewQFPQVT` (Wardline junior holder deposited 300,000 units USDC)
- **Claim Filing and Payout Tx:** `EvGCpfGDWs8Vx7by6qGvzu3VgCihHTuEyHyeZ6X2ssHM` (simulated 50,000 unit invalid settlement claim)
- **Verification:** Claim recorded as `paid`, `paid_from_junior = 50000`, `paid_from_senior = 0`. Junior first-loss stake absorbed 100% of the claim while senior LP capital remained untouched.

#### 6. One WARD Redeem (Investor Burn and Cooldown)
- **Investor USDC Funding Tx:** `4RfbZ1SjhQXbDwCVVb73Yg9F1FM3pJJeU8zPYzuAPC2K` (200,000 units USDC)
- **Deposit and WARD Minting Tx:** `6wD6dMQTUTihVAzthPNnEZy72HY14LhANX4HYM3ApvZa` (minted 200,000 WARD shares at 1.0 USDC)
- **Redeem Request Tx:** `AEojaiWVZTNA8E5VpdTAgjm9YHwftXyq7uzXAcAFyB5s` (requested withdrawal of 100,000 WARD)
- **Redeem Execution Tx:** `69sso4RGoiDeaLPkweoCsKhnsZDWWE2kaWpS8b3XxaLB` (burned WARD and returned 100,000 units USDC to investor)

## Phase 4: Hosted Endpoints and Deployment

All public endpoints are deployed, reachable over HTTPS, and verified:

| Service | Public Hosted URL | Local Binding | Notes |
| --- | --- | --- | --- |
| API | `https://attempt-caused-antique-four.trycloudflare.com` | `127.0.0.1:8787` | Express/Hono on Node 20+, AI gateway, payee checks, receipts |
| MCP Server | `https://realize-russell-societies-incl.trycloudflare.com/mcp` | `127.0.0.1:8790` | Streamable HTTP, registered in `~/.wardline/mcp/config.json` |
| Web App | `https://lean-ballot-ref-script.trycloudflare.com` | `127.0.0.1:5173` | Vite React SPA, interactive demo, owner views, try-it UI |

### Configuration and Tool Registration

- **Claude Desktop:** configured in `~/Library/Application Support/Claude/claude_desktop_config.json` pointing to `https://realize-russell-societies-incl.trycloudflare.com/mcp`.
- **Local MCP Config:** registered in `~/.wardline/mcp/config.json`.
- **llms.txt:** updated at `apps/web/public/llms.txt` and `apps/web/dist/llms.txt` with hosted API and MCP endpoints.
- **SKILL.md:** updated at `docs/skills/wardline-payee-check/SKILL.md` with hosted API and MCP endpoints.
- **server.json:** updated at `services/mcp/server.json` with HTTP transport pointing to the public MCP URL.
- **README.md:** updated with live hosted links for Web App, API, MCP, and NEAR testnet contract deployment manifest.

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
