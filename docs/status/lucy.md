# Status: lucy

Last updated: 2026-11-07 (US time; Nov 8 UTC)

## Done

### Payee Shield: packages/payee-check (this session)

- **`@redline/payee-check`**, pure TypeScript, browser and Node safe (compiles with no Node types;
  a test scans src for Node-only APIs). Imports the shared types from `packages/schemas/src/payee-check.ts`.
- **Engine:** `checkPayee(req, deps)` and `resolvePayee(req, deps)`, deterministic, no LLM. All
  thresholds in `PAYEE_CHECK_CONFIG`. Every reason has a one-sentence detail.
- **CAIP-10:** `parseAccount` / `formatAccount` / `normalizeAccount` for near, eip155, solana.
  Malformed input throws before any registry or RPC call (tested by counting registry calls).
- **NEAR signals over JSON-RPC:** existence, contract, creation block (binary search on the archive),
  full-access keys added and code changed in 7 days. 8 s timeout plus one retry per call; failures
  become nulls and SIGNALS_UNAVAILABLE, never an exception. `SignalsCache` interface with an LRU
  default (creation forever, the rest 10 minutes).
- **Look-alike detector** (`detectLookalike`): NEAR bait words, confusables, edit distance, same name
  under another parent; EVM and Solana first-4/last-4 address poisoning; EVM edit distance.
- **Tests: 89, all offline.** 27 engine cases (each asserting verdict and exact reason codes), resolve
  cases, look-alike rules, a simulated NEAR chain for the signals provider (skipped heights,
  timeouts, retries, broken archive, cache behavior), and replay of real testnet responses.
- **Fixtures:** `packages/payee-check/fixtures/testnet-recording.json`, recorded once by
  `scripts/record-payee-fixtures.ts`. Real results: `vault-a.redline-labs.testnet` was created at
  block 276438635 (2026-11-06T04:15:33Z, 4.5 minutes before Tharun's manifest `deployed_at`), has new
  code and no full-access keys, so it HOLDs with NEW_ACCOUNT and RECENT_CODE_CHANGE. A missing
  account BLOCKs with ACCOUNT_MISSING.
- **README:** API, verdict tables, signals per chain, measured RPC cost, known limits.
- Root `pnpm test` passes (383 tests across 8 packages) once workspace packages are built; see Requests.

### Earlier: the Gym

fixtures/dev (12 scenarios), services/evaluator, evidence and commitments, docs/THREAT_MODEL.md,
docs/LIMITATIONS.md. Unchanged this session.

## Live RPC calls used

**27 of 50**, all from the record script, against the public FastNEAR archival testnet endpoint
(`NEAR_RPC_URL`). **QuickNode: 0 calls.** `QUICKNODE_NEAR_RPC_URL` is not set anywhere I can see.
No manual live checks: the creation block was verified from the recorded data.

## Interfaces I expose

- `@redline/payee-check`: `checkPayee`, `resolvePayee`, `parseAccount`, `formatAccount`,
  `normalizeAccount`, `parseChainId`, `normalizeDomain`, `detectLookalike`, `verdictFor`,
  `PAYEE_CHECK_CONFIG`, `NearSignalsProvider`, `NearRpcClient`, `nearRpcUrlsFromEnv(env)`,
  `LruCache`, `InMemoryPayeeRegistry`, `InMemoryPaymentHistory`.
- Interfaces for others to implement: `PayeeRegistry` (Tharun), `SignalsCache` (API sqlite),
  `PaymentHistory` (API or SDK).
- Errors: `AccountParseError` and `DomainParseError` (bad input, before any call), `PayeeDependencyError`
  (registry or history unreadable; callers should treat it as HOLD).

## Blockers

None.

## Proposed schema changes (packages/schemas/src/payee-check.ts)

1. **`REGISTRY_UNAVAILABLE` reason code.** Today a registry or history outage has no honest code, so
   the engine throws `PayeeDependencyError`. With this code it could return HOLD instead.
2. **Clarify `ACCOUNT_NOT_VENDORS`.** The brief says "not one of theirs on any chain". Read literally,
   every account on a chain the vendor never verified would BLOCK and CHAIN_NOT_VERIFIED could never
   fire. Implemented: BLOCK when the vendor has accounts on this chain (or the account belongs to a
   different vendor); HOLD with CHAIN_NOT_VERIFIED when the vendor has none on this chain. Please confirm.
3. Optional, for case files: `PayeeSignals.checkedAtBlock` (the head height signals were read at) and
   `lookalikeRule` (`BAIT_WORD`, `CONFUSABLE`, ...). Both exist inside the engine already.

## Requests

- **Alexander**
  - Root `pnpm test` builds only schemas, but services/api now imports `@redline/agent`'s `dist/`, so a
    fresh checkout fails with "Failed to resolve entry for package @redline/agent". Building first
    (`pnpm -r build`, or filtering schemas, vault-sim, vault-client, agent) makes everything pass.
  - `.env.example`: add `QUICKNODE_NEAR_RPC_URL` and `NEAR_ARCHIVE_RPC_URL`. Historical queries need
    an archival node; if the QuickNode endpoint is not archival, set the second to an archival one.
  - I committed a pnpm-lock.yaml change that only adds the packages/payee-check importer.
  - SDK direct mode: Redline does not see the payee, but the RPC provider does (the `view_account`
    calls name it). The README says so; the SDK docs should too.
  - Confirm proposed schema changes 1 and 2.
- **Tharun**
  - `PayeeRegistryClient` implementing `PayeeRegistry` (packages/payee-check/src/types.ts) with these
    semantics, which `InMemoryPayeeRegistry` mirrors: `isVerifiedPayee` true only for active accounts
    past `activatesAt`; `getVendorByAccount` also finds pending accounts; `resolve` returns active only.
  - Every look-alike check calls `listVendors()`. A single view returning all vendors and accounts
    keeps that to one RPC call; the engine can also take a cached registry wrapper.
- **Kristian**: for the red-team benchmark, `checkPayee` with `InMemoryPayeeRegistry` and the
  `FakeSignals` pattern in packages/payee-check/test/helpers.ts runs fully offline.

### Still open from the Gym (not addressed this session)

- Alexander asked me to use metric ids `useful_payments`, `vault_containment`, `exceptions_to_human`
  for #/scoring and to confirm the 20/20/8 denominators.
- Kristian asked whether a PAY held by the agent's guard should count as an AI failure.
- Tharun's rejection order differs from my old stub (BINDING_INACTIVE before PAUSED, NOT_YET_PAYABLE
  before PAYABLE_EXPIRED, plus CAPACITY_FULL). The evaluator should switch to `createGymVaultSim`.
- Hidden assessment set (48 cases, in REDL), rubric freeze and suite commitment are not done yet.

## Next

- Payee Shield: plug in Tharun's registry client once it exists; add payee-shield rows to
  docs/THREAT_MODEL.md; record `owner-a.redline-labs.testnet` (about 25 calls) to replay a real
  RECENT_FULL_ACCESS_KEY if budget allows.
- Gym: answer the three open questions above, switch to `createGymVaultSim`, write the hidden set.
