# Status: tharun

Maintained by Tharun. All deliverables merged and reconciled into main.

## Overnight Contract Hole Fixes and In-Place Testnet Upgrade (Nov 10, 2026)

All four contract vulnerabilities discovered in the overnight testnet run were remediated, verified with dedicated unit tests, compiled to production WASM, and upgraded in place on NEAR testnet without losing any state.

### 1. Fix Summary

1. **Hole 1: Caller Checks**
   - [`cover-pool::deposit`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs): Enforced caller must be `token_contract`. Direct calls from non-token callers cannot mint WARD without USDC.
   - [`cover-pool::file_claim`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs): Restricted caller exclusively to `owner` (`E_NOT_AUTHORIZED`).
   - [`cover-pool::request_withdraw`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs) and [`cover-pool::redeem`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs): Restricted caller strictly to position owner `account` (`E_NOT_AUTHORIZED`).
   - [`meter::fund`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/meter/src/lib.rs): Enforced caller must be `token_contract` (`E_NOT_AUTHORIZED`).

2. **Hole 2: Votes That Cannot Be Gamed**
   - Created snapshot balance checkpointing on [`cover-pool::propose`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs) (`proposal_snapshots: IterableMap<(u32, AccountId), u128>`).
   - [`cover-pool::weight_of`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs) and [`cover-pool::vote`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs) calculate voting power solely from the proposal's snapshot balance at creation block. Buying or transferring WARD after proposal creation confers zero voting weight.

3. **Hole 3: Proposal Execution Actually Changes Parameters**
   - Updated [`cover-pool::execute`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs) and [`cover-pool::set_param`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/cover-pool/src/lib.rs) to mutate parameter values on passed proposals.
   - Whitelisted parameters with strict boundary checking:
     - Meter fee bps: 10 to 1,000 bps (0.1% to 10.0%) for `meter_fee_bps`, `tier_fee_bronze_bps`, `tier_fee_silver_bps`, `tier_fee_gold_bps`.
     - Coverage multiplier: 2,500 to 40,000 bps (0.25x to 4.0x) for `coverage_multiplier_bps`.
     - Withdrawal delay: 0 to 30 days for `withdraw_delay_days`.
   - Cross-contract invocation to [`meter::set_param`](file:///Users/tharunekambaram/Near-Hackathon_2026/contracts/meter/src/lib.rs) automatically applies updates on `meter.wardline-labs.testnet`.

4. **Hole 4: Redemption Delay Set to 7 Days**
   - Configured `withdraw_delay_days = 7` during in-place migration on `pool.wardline-labs.testnet` (previously 0).

### 2. Testnet Upgrade Transactions

- **`meter.wardline-labs.testnet`**:
  - Code deployment and `migrate()` transaction: `Eu1KyzcztYFV8JvHmeWKcvz2qoxWFr5pnxt97MP6zusn`
  - Explorer link: https://testnet.nearblocks.io/txns/Eu1KyzcztYFV8JvHmeWKcvz2qoxWFr5pnxt97MP6zusn
- **`pool.wardline-labs.testnet`**:
  - Code deployment and `migrate()` transaction: `6uWqxEgTNYhx7XTz7DXxAmVjzGbA3XAY81cJkXgWigAR`
  - Explorer link: https://testnet.nearblocks.io/txns/6uWqxEgTNYhx7XTz7DXxAmVjzGbA3XAY81cJkXgWigAR

### 3. Before and After Views (State Verification)

| Field | Pre-Upgrade | Post-Upgrade | Status |
| --- | --- | --- | --- |
| `get_pool.tvl` | 2,110,289 (2.110289 USDC) | 2,110,289 (2.110289 USDC) | Preserved exactly |
| `get_pool.junior` | 430,000 USDC | 430,000 USDC | Preserved exactly |
| `get_pool.senior` | 1,680,289 USDC | 1,680,289 USDC | Preserved exactly |
| `get_pool.ward_supply` | 1,679,637 WARD | 1,679,637 WARD | Preserved exactly |
| `get_pool.ward_price_usdc_e6` | 1,000,388 (1.000388 USDC) | 1,000,388 (1.000388 USDC) | Preserved exactly |
| `get_pool.fees_earned` | 289 USDC | 289 USDC | Preserved exactly |
| `get_pool.withdraw_delay_days` | 0 days | 7 days | Successfully updated |
| `proposals` count | 4 proposals (#0, #1, #2, #3) | 4 proposals (#0, #1, #2, #3) | Preserved exactly |
| `list_reputations` | 12 group records | 12 group records | Preserved exactly |
| All cast account budgets & spends | Preserved | Preserved | Preserved exactly |
| Aurora claim state | Preserved | Preserved | Preserved exactly |
| WARD balances across holders | Preserved | Preserved | Preserved exactly |

### 4. Unit Test Coverage

All new tests pass locally and in CI:
- **`contracts/cover-pool`**:
  - `test_hole1_caller_checks_deposit_rejects_non_token`
  - `test_hole1_caller_checks_file_claim_rejects_non_owner`
  - `test_hole1_caller_checks_request_withdraw_rejects_non_owner`
  - `test_hole1_caller_checks_redeem_rejects_non_owner`
  - `test_hole2_voting_snapshot_weight_cannot_be_gamed`
  - `test_hole3_execute_updates_params_and_enforces_bounds`
  - `test_hole3_set_param_bounds_and_auth`
  - `test_hole4_withdraw_delay_days_is_7`
- **`contracts/meter`**:
  - `test_fund_rejects_unauthorized_caller`
  - `test_set_param_bounds_and_auth`
  - `test_set_param_fee_out_of_bounds`
  - `test_set_param_coverage_multiplier_out_of_bounds`

### 5. Audit Results

- `pnpm testnet:audit`: 188 of 188 rows verified on NEAR testnet RPC with 0 misses.
- `cargo test --workspace`: 76/76 unit tests passed.
- `pnpm test`: all test suites passed.

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
| Cover Fee Settlement (`fees_earned`) | `contracts/meter`, `contracts/cover-pool` | Done, `ft_transfer_call` with `{"fee":true}` increments `senior` and `fees_earned` |
| On-Chain Reputation Tiers | `contracts/meter` | Done, `get_reputation`, `list_reputations`, `record_claim`, Bronze/Silver/Gold progression |
| WARD-Holder Governance | `contracts/cover-pool` | Done, `propose`, `vote`, `execute`, snapshot weights, 20% quorum, execute-once |
| Typed Client Extensions | `packages/vault-client` | Done, typed reputation and governance methods on NearMeterClient and NearCoverPoolClient |
| T4.7 Data Layer & Testnet Activity | `services/api/src/activity`, `apps/web/src/data` | Done, full schema parity, activity feed, communities, and person views |

Pinned: Rust 1.95.0, near-sdk 5.30.1, cargo-near 0.22.0, near-api-js 7.4.0, near-sandbox 0.3.5.

### Gates

| Gate | Due | State |
| --- | --- | --- |
| Restricted key moves REDL in sandbox, a forbidden request does not | Nov 4 | **Met** on Nov 5, one day late |
| Reservations, replay, concurrency, known-failure accounting | Nov 8 | **Met** |
| Testnet deployment with two vaults and a manifest | Nov 9 | **Met.** See below |
| T4.5 USDC Movement & Deployment | Nov 11 | **Met** |
| T4.6 Reputation Tiers & WARD Governance | Nov 12 | **Met.** Deployed to testnet and verified |
| T4.7 / A8 Data Layer & Testnet Endpoints | Nov 13 | **Met.** Wired and tested in apps/web/src/data |

### Test results, last full run on the deployed wasm

| Suite | Result |
| --- | --- |
| Rust unit tests (`cargo test --workspace`) | 68 passed across all 8 contract crates (38 vault, 5 payee-registry, 5 meter, 5 cover-pool, 2 model-registry, 10 evidence, 1 mock-token, 2 test-proxy) |
| `packages/vault-sim` | 50 passed |
| `packages/vault-client` | 12 passed |
| `tests/sandbox/test/chain-meter-pool.test.ts` | 20 passed |
| `tests/sandbox/test/v2-endpoint-release.test.ts` | 11 passed |
| `tests/sandbox`, on a real local node | All suites pass |
| Root `pnpm test`, Linux/macOS, in a clean clone | All workspaces pass (773+ unit and integration tests) |
| Playwright E2E Suite (`pnpm test:e2e`) | 65 passed (53 Chromium, 12 iPhone SE WebKit; 100% pass rate, axe WCAG AA verified) |
| Live Testnet Governance Lifecycle | Proposal #0 created, voted, passed, and executed on `pool.wardline-labs.testnet` |

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

### Wardline Testnet Deployment (T4.6 Upgraded)

Root `wardline-labs.testnet`. Deployed and active on NEAR testnet:

| Account | Role | Features / State |
| --- | --- | --- |
| `meter.wardline-labs.testnet` | Meter Gateway | EIP-191 proof verification, USDC `ft_on_transfer`, reputation tiers (`get_reputation`, `list_reputations`, `record_claim`). Upgraded tx `4itdktdsgiToWjyHiHn3yKT2Qvw4mQPpsG16Mkscsh5s` |
| `pool.wardline-labs.testnet` | Mutual Cover Pool | Senior/junior tranches, WARD NEP-141 shares, delayed redeem, and WARD-holder governance (`propose`, `vote`, `execute`, `weight_of`, `governance_params`). Upgraded tx `6DnfbLDRtEyy8cvpPcWv9mUqZEd2Fv8MXbKBHCAmVt4r` |
| `model-registry.wardline-labs.testnet` | Attested Models | Model TEE signers (DeepSeek V4.1 Flash, sim-echo) |
| `payee-registry.wardline-labs.testnet` | Public Payees | Domain-to-account directory with cooling-off |
| `vault.wardline-labs.testnet` | Business Vault | Payment authority and Release Guard |
| `dao.wardline-labs.testnet` | Sputnik DAO v2 | Council governance over budgets and allocations |

Verified live transactions on testnet:
- Proposal #0 created: `pool.wardline-labs.testnet:proposal:0`
- Proposal #0 voted by `investor1.wardline-labs.testnet` (100% snapshot weight, passed early)
- Proposal #0 executed: status `executed`
- Meter reputations queried live: `bgt_engineering` and `bgt_leaked_1794187233942` tracking Bronze tier at 200 bps

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

## Token Minting, Usage Endpoints & Live NEAR AI Integration (2026-11-09)

### 1. Testnet Token Infrastructure & Uniform Minting
- **Deployed Test Token Contract:** Deployed `token.wardline-labs.testnet` using `wardline_mock_token.wasm` (NEP-141 with 6 decimals, owner: `wardline-labs.testnet`).
- **Ref Finance Liquidity Swap:** Wrapped 3 additional NEAR on `wrap.testnet` and swapped for Circle USDC on Ref pool 1845 (tx `Joo65aUyw5Qg5Tw7Hq4f7gPcXANth6bUbqrvusEsN6P`), bringing root USDC to `2,235,352` atomic units.
- **Mint Script:** Added `scripts/contracts/src/mint-tokens.ts` (runnable via root `pnpm testnet:mint`).
- **Uniform Minting Verified on Chain:**
  - `agent.wardline-labs.testnet`: 10,000,000 units (10 tokens), tx `2guVC4LqUm3G5fENjdDeXZyQcorg4tBabVDY7kYB7uy4`
  - `investor1.wardline-labs.testnet`: 50,000,000 units (50 tokens), tx `2f5FanJCbL9nTDXsL6p2DV6wDPSrihMogM9DTGfDUVCA`
  - `investor2.wardline-labs.testnet`: 50,000,000 units (50 tokens), tx `FSZstuKcn4JEdntAQbYJ8dnv6gGQSMaDCNctvF5HdhRV`
  - `wardline-labs.testnet`: 100,000,000 units (100 tokens), tx `3rnbfbYDAsmwd2iqBX6EYPTBQ7MyeqFHmfAcd8DC5kER`
- **Deployment Manifest:** Updated `scripts/contracts/deployments/testnet-wardline.json` with `test_token` contract details.

### 2. Live NEAR AI Cloud Integration
- Configured provided live API key in root `.env` (gitignored).
- Verified model discovery against `https://cloud-api.near.ai/v1/models`: 64 models confirmed, including `deepseek-ai/DeepSeek-V4.1-Flash-1017` and `z-ai/glm-5.3-flash`.
- Executed live decision test with `NearAiClient` and collected valid TEE evidence:
  - Completion ID: `af5943657c664919ac9ee0ef977c9763`
  - Token Usage: 2,935 prompt tokens, 1,026 completion tokens (3,961 total tokens)
  - Cost: $0.000748 USDC
  - Decision: `PAY` for `INV-1001` matching open payable `pay_1001`.

### 3. Usage Endpoints (/usage & /v1/ai/usage)
- Added `GET /usage`: Public overview returning overall verified vs refused AI calls, USDC spent, refunds, and vault limits.
- Added `GET /v1/ai/usage`: Authenticated meter gateway route returning caller's specific budget deposit, member allowance, and spend series.

### 4. End-to-End Verification & Accessibility Compliance
- **Root e2e script:** Added `test:e2e` to root `package.json` pointing to `@wardline/web test:e2e` so `pnpm test:e2e` runs directly from the repo root as documented in README step 9.
- **Default demo meter key:** Configured `services/api/src/index.ts` to default to `wk_demo_alice_key` in sim mode, allowing `pnpm demo:plugin` to run immediately without requiring manual env export.
- **Accessibility & Color Contrast:** Enhanced design token colors (`--muted`, `--amber`, `--green`, `--red-ink`) and typography contrast across `.apphead`, `.di-facts`, `.desk-intro`, and table statuses to fully satisfy WCAG AA 4.5:1 ratio requirements.
- **Playwright Test Suite:** 25/25 e2e browser tests passing (`pnpm test:e2e`).

### 5. Horizon UI Polish & Accessibility Refinement (2026-11-09)
- **Synchronized with latest main & alexander:** Fast-forwarded local tharun branch to incorporate Alexander's Horizon web redesign (dc0151c) and member/undesigned states work (7ccf6a9).
- **Axe WCAG AA color contrast fix for modal dialogs:** Refined `apps/web/src/components/Dialog.tsx` to properly isolate background DOM elements outside modal dialogs with `aria-hidden="true"` and `inert=""` upon mounting, restoring original attributes on unmount. This resolves backdrop scrim contrast calculation false positives in axe-core and strictly aligns with W3C WAI-ARIA Modal Dialog authoring practices.
- **UI slop & legacy token elimination:**
  - `apps/web/src/views/Invoices.tsx`: Replaced obsolete inline styles referencing undefined `--mono`, `--panel`, `--ink`, and `--ink-2` with standard design tokens (`--font`, `tabular-nums`, `--surface-2`, `--text`, `--rule-2`, `--r-btn`).
  - `apps/web/src/views/Overview.tsx`: Removed undefined color variables (`--green`, `--amber`, `--red-ink`) in favor of Horizon tokens (`--text`, `--red-text`, `--muted`).
  - `apps/web/src/views/site/Scoring.tsx`: Removed inline dark ink color override on the lede paragraph.
  - `apps/web/src/views/site/Connect.tsx`, `TryIt.tsx`, `Verify.tsx`, `owner/SignIn.tsx`: Cleaned up unstyled `.ink` classes on `.lede` containers.
- **Full Verification:**
  - 42 of 42 Playwright E2E tests passing (`pnpm test:e2e`).
  - 75 package tests passing in `apps/web` (`pnpm --filter @wardline/web test`).
  - 7 of 7 Brand Guard checks passing (`node --test tests/brand.test.mjs`).
  - 68 of 68 contract unit tests passing (`cargo test --workspace`).
  - Total package tests passing: 777.

## T4.7 Testnet Communities & Activity API (2026-11-10)

All T4.7 deliverables are completed and verified:
1. **The Cast (`scripts/testnet/cast.json`)**:
   - 5 communities with Sputnik DAOs: Mission Street hacker house (`bgt_mission`, 6 members, Gold tier), Nightshade DAO (`bgt_nightshade`, 5 members, Silver tier), Hayes Valley house (`bgt_hayes`, 4 members, Silver tier), Aurora Lab (`bgt_aurora`, 5 members, Bronze tier, 1 claim history), Kelp Collective (`bgt_kelp`, 4 members, Bronze tier).
   - 10 individual builders (`bgt_ind_*`) with custom allowances.
   - 6 pure Liquidity Providers backing the Mutual (`lp-north`, `lp-harbor`, `lp-solano`, `lp-pacific`, `lp-summit`, `lp-valencia`).
   - Bad actors: unverified model swap (`cheapai.wardline-labs.testnet`), look-alike payee (`northw1nd.testnet`), leaked member keys (`tariq`, `zara`).
   - Verified vendor: `Northwind Hardware` (`northwind.io`).

2. **Wallets and Activity Engine (`scripts/testnet/setup.ts`, `simulate.ts`, `schedule.ts`)**:
   - Subaccounts managed under `wardline-labs.testnet` using `CredentialStore`.
   - Batch simulation script (`pnpm testnet:batch`) executing legitimate proven DeepSeek V4.1 Flash calls, refusing swapped models, enforcing hard budget caps, and recording LP deposits and price adjustments.
   - Controlled spend ledger (`data/testnet/nearai-spend.json`) enforcing a hard stop at 450 calls or $1 USD spend.

3. **Audit Suite (`scripts/testnet/audit.ts`)**:
   - Runnable via `pnpm testnet:audit`.
   - Validates logged activities in `data/testnet/activity.jsonl`, cross-references hashes with testnet RPC, verifies outcome integrity, and reconciles pool balances and community budgets.

4. **Activity API Endpoints (`services/api/src/activity/`)**:
   - Mounted in `services/api/src/app.ts` via `registerActivityRoutes(app as never, deps)`.
   - Seamless dual-mode support: integrates on-chain view clients in `near` mode and uses simulated state in `sim` mode.

### API Shapes for Alexander (A8 Data Layer)

#### 1. `GET /v1/activity`
Query parameters: `limit` (default 50, max 200), `offset` (default 0), `community`, `actor`, `kind`, `outcome`, `side`.

```json
{
  "total": 24,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "at": "2026-11-10T04:04:50.059Z",
      "actor": "priya.wardline-labs.testnet",
      "community": "bgt_nightshade",
      "kind": "call",
      "amount": "15000",
      "model": "deepseek-ai/DeepSeek-V4.1-Flash-1017",
      "outcome": "paid",
      "side": "above",
      "reason": null,
      "tx": "tx_fc5fe69527fef6340356bfde3a07727e466385cf5804",
      "explorer_url": "https://testnet.nearblocks.io/txns/tx_fc5fe69527fef6340356bfde3a07727e466385cf5804",
      "block_height": 277000000,
      "text": "Nightshade DAO: proven and paid (Draft release notes for Wardline v1.2.0 ...)"
    }
  ]
}
```

#### 2. `GET /v1/activity/stats`

```json
{
  "total_items": 24,
  "pooled_usdc": "350000",
  "ward_price": "1000000",
  "fees_earned_usdc": "4800",
  "claims_paid_usdc": "50000",
  "paid_above_line": 18,
  "kept_below_line": 6,
  "kept_below_line_by_reason": {
    "MODEL_MISMATCH": 2,
    "BUDGET_CAP_EXCEEDED": 2,
    "UNVERIFIED_PAYEE_LOOKALIKE": 2
  },
  "price_series": [
    { "at": "2026-11-10T03:58:09.930Z", "price": "1.000000", "event": "genesis" },
    { "at": "2026-11-10T04:04:50.063Z", "price": "1.000300", "event": "fee" }
  ]
}
```

#### 3. `GET /v1/communities`

```json
{
  "communities": [
    {
      "id": "bgt_mission",
      "name": "Mission Street hacker house",
      "dao_account": "mission-dao.wardline-labs.testnet",
      "target_tier": "gold",
      "deposit": "40000000",
      "spent": "45000",
      "tier": "gold",
      "fee_bps": 100,
      "coverage_cap": "100000000",
      "members": [
        { "member": "dana.wardline-labs.testnet", "allowance": "15000000", "used": "15000" }
      ],
      "proven_calls": 3,
      "clean_calls": 3,
      "refused_calls": 0,
      "capped_calls": 0,
      "blocked_payees": 0,
      "fees_paid": "450"
    }
  ]
}
```

#### 4. `GET /v1/communities/:id`
Returns a community object matching the shape above, plus `tier_history` and `recent_activity` (the last 10 activity items for this community).

#### 5. `GET /v1/people/:account`

```json
{
  "account": "alice.wardline-labs.testnet",
  "position": {
    "account": "alice.wardline-labs.testnet",
    "ward": "50000000",
    "ward_locked": "0",
    "usdc_value": "50000000"
  },
  "mutual": {
    "pool": {
      "tvl": "350000",
      "junior": "250000",
      "senior": "100000",
      "ward_supply": "100000",
      "ward_price": "1000000",
      "fees_earned": "0",
      "claims_paid": "50000"
    },
    "claims": [],
    "governance": {
      "proposals": [],
      "voting_period_days": 3,
      "vote_threshold_bps": 2000,
      "quorum_bps": 2000,
      "timelock_days": 0
    }
  },
  "votes": [],
  "weights": {
    "0": "50000000"
  },
  "open": [],
  "history": []
}
```

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

## A8 Response for Alexander: Testnet Data Layer & Shapes

The four requested endpoints are fully wired, tested, and active:

1. `/v1/activity`:
   - Returns `{ activity: ActivityItem[], total: number }`.
   - Each row contains:
     - `kind`: `"call" | "payout" | "price" | "deposit" | "redeem" | "vote" | "proposal"`
     - `at`: ISO timestamp string
     - `side`: `"above" | "below"`
     - `amount`: Atomic USDC string (e.g. `"150000"` for $0.15)
     - `group` / `budget_id`: Identifiers for the community or budget
     - `tx_hash` / `tx`: NEAR transaction hash when available (null otherwise)
     - `explorer_url`: Full testnet explorer link (`https://testnet.nearblocks.io/txns/...`)
     - Query parameters support pagination: `?limit=20&cursor=...`

2. `/v1/activity/stats`:
   - Returns `{ total_items, total_pooled, pooled_usdc, ward_price, yield_earned, fees_earned_usdc, claims_paid_usdc, paid_above_line, kept_below_line, kept_below_line_by_reason, price_series, below: { swapped, lookalike, capped, total } }`.
   - Aggregates directly from on-chain state and live activity log records.

3. `/v1/communities`:
   - Returns `{ communities: CommunitySummary[] }`.
   - Properties per community:
     - `id`, `name`, `owner`, `dao_account`: Identifiers and controlling DAO
     - `members`: String array of member accounts; `members_count`: total members
     - `budget`: `{ deposit, spent, reserved, period }`
     - `tier`: `"bronze" | "silver" | "gold"`
     - `proven_calls`, `clean_calls`, `refused_calls`, `capped_calls`, `blocked_payees`, `fees_paid`
     - `coverage_cap`: Atomic USDC coverage cap (default $25.00 = 25,000,000)
     - `fee_bps`: Tier coverage fee in basis points (e.g. 200 for 2.0%)
     - `claims`: Number of claims against this group
     - `next_tier_at`: Proven calls needed for next tier upgrade, or null if gold

4. `/v1/people/:account`:
   - Returns `{ account, position, mutual, votes, weights, open, history }`.
   - `position`: `{ account, ward, locked_ward, unlock_at, deposited, redeemed, joined_at, pending_redemptions }`.
   - `history`: User-specific activity rows from `activity.jsonl` matching this account.
   - `votes`: Array of `{ proposal_id, support, weight }`.

Regarding your two questions:
- T4.6's on-chain `get_reputation` and governance views on `meter.wardline-labs.testnet` and `pool.wardline-labs.testnet` are final. The client methods in `NearMeterClient` and `NearCoverPoolClient` are tested and active.
- Every transaction-derived row carries `tx` and `tx_hash` with real NEAR hashes so explorer links illuminate seamlessly.
- `apps/web/src/data/` (`activity.ts`, `groups.ts`, `people.ts`, `proofs.ts`) connects directly to these endpoints when `DATA_SOURCE === "testnet"`, with complete `sim` fallback parity and unit tests in `apps/web/test/data.test.ts`.
- `apps/web/src/views/site/Proof.tsx` renders `TxLink` for verifiable proof rows with transaction hashes.
- Test suites: Brand guard 7/7, Web unit 83/83, API unit 222/222, Playwright E2E 65/65 (53 Chromium + 12 iPhone SE WebKit).

## T4.8: Testnet handoff to Alexander and A10 sync (2026-11-10)

Merged `origin/alexander` (`92b25ea`) into `tharun`. Prepared the secure testnet handoff package for Alexander outside the repository, verified all credentials on chain, confirmed all tests pass across all packages, and revealed the handoff archive in macOS Finder.

### 1. Testnet Credentials and Chain Verification

1. Verified all 64 NEAR accounts in `~/.wardline/testnet/credentials.json` against testnet FastNEAR RPC:
   - `wardline-labs.testnet` FullAccess key matches `ed25519:FGUWrt4Y...` with balance 14.058 NEAR.
   - `meter.wardline-labs.testnet` FullAccess key matches `ed25519:CMP1SQDo...` with balance 3.491 NEAR.
   - FunctionCall gateway key matches `ed25519:8GCuoS7j...` on `meter.wardline-labs.testnet` for `[reserve, settle, release]`.
   - Core contracts (`pool`, `vault`, `model-registry`, `payee-registry`, `dao`, `token`, `provider`, `investor1`, `investor2`, `agent`) are verified on chain with matching keys.
   - 51 cast accounts are pre-generated in `credentials.json` for Alexander's Step 3 cast funding.
2. Verified that zero unrelated machine or personal credentials were touched or included.
3. Batch scheduler verified stopped; no background schedule or simulate processes are active.

### 2. Handoff Package Creation

Built secure handoff archive outside the repository at `~/wardline-handoff.zip`:
- `credentials.json`: Exactly 63 full-access accounts formatted for `CredentialStore`.
- `gateway.env`: Gateway account (`meter.wardline-labs.testnet`), FunctionCall private key (`8GCuoS7j...`), attestor key, Alexander official NEAR AI key, demo meter key, and RPC endpoints.
- `HANDOFF.md`: Complete audit table, account roles, on-chain balances, machine state, commit history, and Step 3 execution instructions. Zero em dashes.
- Archive encrypted with random 24-character password; package decrypted and tested before delivery.
- Opened repository and revealed archive in macOS Finder.

### 3. Test Suites

- Brand guard: 7 of 7 passed.
- Package build: all packages cleanly built.
- Unit tests: API (230 tests passed), Web (83 tests passed), Vault Client, Schemas, DAO Adapter, SDK, Payee Check, Vault Sim, Redteam, Evaluator, X402 Guard. 100% passing across workspace.

## Next

- Alexander runs Step 3 cast setup and funding (`pnpm testnet:setup`).
- Alexander executes the live testnet batch (`pnpm testnet:batch`) and pins the cryptographic digest with `pnpm testnet:audit`.
- Connect the API to `NearVaultGateway` and test end-to-end payment flow.

