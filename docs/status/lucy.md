# Status: lucy

Last updated: 2026-11-04

## Done

- **fixtures/dev: 12 dev scenarios** (Nov 4 gate). 5 legitimate (ordinary, two recurring Fernhill
  bills as a 2 step sequence on one ledger, varied layout, benign urgency on business B),
  5 adversarial (injection, forged CFO approval, bank change, look-alike vendor, same invoice twice),
  2 exceptions (new vendor, over vendor cap). Opaque ids, decoy payables in every case. Validated
  against `ScenarioSchema` plus lint rules (`pnpm --filter @redline/evaluator test`).
- **services/evaluator**: runner (fresh ledger per scenario or sequence), deterministic oracle,
  15 metrics with numerators and denominators, EvaluationReport JSON plus markdown, comparison
  table, timeouts and errors kept in denominators. 17 tests.
- **Evidence**: salted, domain-separated suite commitment; report and run-record digests; registry
  stub standing in for the evidence contract; `verify:evidence` recomputes everything.
  `evidence/example-run/` committed and verifying (28 match, 0 mismatch).
- **Docs**: docs/THREAT_MODEL.md, docs/LIMITATIONS.md, READMEs for fixtures, evidence, evaluator.

## Interfaces I expose

- **Dev fixtures** for Kristian: `fixtures/dev/*.json`. The agent sees only `intake` and `context`.
  Conventions in fixtures/dev/README.md.
- **`StartingStateSchema`, forbidden-effect vocabulary**: services/evaluator/src/fixtures.ts.
- **`VaultSim` / `VaultSimFactory`**: services/evaluator/src/sim.ts (`VaultGateway` plus `transfers()` and `setNow()`).
- **`FileEvidenceGateway implements EvidenceGateway`**: services/evaluator/src/evidence.ts.
- **Digests**: `SHA-256(utf8(domain) || 0x00 || [salt32] || canonical_json(value))`; domains in src/canonical.ts.
- **Report location** for the API/UI: `evidence/**/runs/*/report.json`, digests in `digests.json`.

## Blockers

None. Everything outside my lane runs on local stubs for now.

## Requests

- **Alexander**
  - Root scripts: `"eval:dev": "pnpm --filter @redline/evaluator eval:dev"`, same for
    `eval:assessment` and `verify:evidence`.
  - I committed a pnpm-lock.yaml change. It only adds the services/evaluator importer, which the
    new workspace package needs to install.
  - `EvaluationCase.vault_result`: please add a value such as `PAID_WRONG_PAYABLE` for "vault
    paid a valid approved payable that this invoice does not correspond to". Today that has to be
    labeled BREACHED, which reads as a vault failure. Example: look-alike invoice gets a real open
    bill paid early.
  - Optional: move `StartingStateSchema` into packages/schemas if the API or the sim want it.
  - Team note: corepack's pnpm shim fails a signature check on Node 22.12 here; `npx pnpm@12.16.1` works.
- **Tharun**
  - packages/vault-sim: export a factory matching `VaultSimFactory` in services/evaluator/src/sim.ts,
    i.e. `(vaults: VaultSimInit[], nowNs: bigint) => VaultGateway & { transfers(); setNow(ns) }`. Mine is a
    stub with the rejection order: BAD_CALLER, PAUSED, BINDING_INACTIVE, UNKNOWN_PAYABLE, ALREADY_PAID,
    ALREADY_PENDING, PAYABLE_EXPIRED, NOT_YET_PAYABLE, STALE_REVISION, OVER_VENDOR_CAP, OVER_WEEKLY_CAP,
    OVER_LIFETIME_CAP, INSUFFICIENT_BALANCE. Tell me where yours differs.
  - Evidence contract: I need `register_suite(commitment)`, `register_run(run_id, suite_commitment,
    manifest_digest, report_digest)`, and a view returning the stored report digest by run_id.
    evidence/*/registry.stub.json shows exactly what I would write.
  - docs/VAULT_RULES.md when ready; I will reconcile the threat model with it.
- **Kristian**
  - Dev fixtures are ready in fixtures/dev.
  - From services/agent please export `createGymAgents(): Promise<GymAgent-like[]>` (fields `name`,
    `label`, `kind`, `manifest`, `runner`, optional `lastUsage()` returning token counts) with names
    `llm` and `rules`, plus `createDecisionAdapter(): DecisionAdapter`. The Gym picks them up
    automatically and stops using my stubs.

## Next

- Deliverable 2: author the 48 hidden cases in fixtures/private (36 first, final 12 last), back
  up outside the repo, run `commit:assessment`, and publish the commitment by Nov 8.
- Agree thresholds in src/rubric.ts with the team and freeze the rubric (Nov 8).
- Swap in vault-sim, Kristian's agents and adapter, and the evidence contract as they land.
- Nov 9 to 10: run the assessment on the frozen candidate and publish results, failures included.
