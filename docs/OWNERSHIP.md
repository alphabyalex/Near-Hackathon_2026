# Ownership

## Folders

| Folder | Owner | Purpose |
| --- | --- | --- |
| apps/web | Alexander | Operator and judge UI |
| services/api | Alexander | Backend API, persistence, chain observer |
| packages/schemas | Alexander (shared) | zod schemas and TS types everyone uses |
| contracts/vault | Tharun | Rust NEAR vault contract |
| contracts/evidence | Tharun | Rust evidence registry |
| packages/vault-client | Tharun | TS client for the contracts |
| packages/vault-sim | Tharun | TS simulator of vault rules |
| tests/sandbox | Tharun | NEAR sandbox integration tests |
| scripts/contracts | Tharun | Deploy, seed, attack scripts |
| services/agent | Kristian | Invoice agent |
| services/evaluator | Lucy | Gym runner and scoring |
| fixtures/dev | Lucy | Public development invoices |
| fixtures/released-assessment | Lucy | Empty until reveal |
| evidence | Lucy | Reports and commitments |
| scripts/eval | Lucy | Eval scripts |
| docs/status | Everyone | One status file per person |

## Rules

- Each person pushes only to their own branch: alexander, tharun, kristian, lucy.
- Only edit folders you own for now. If you need a change in someone else's folder or in packages/schemas, write the request in docs/status/<yourname>.md under "Requests" and keep working against a local stub.
- Do not merge main into your branch unless Alexander says to. Alexander coordinates all merges to main.
- Lanes are expected to change as the project evolves; Alexander will announce changes.
- At the end of every work session, update docs/status/<yourname>.md and push.
