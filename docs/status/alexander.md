# Status: alexander

## Done

- Repo scaffold: pnpm workspace, folder READMEs, LICENSE, .gitignore, .env.example.
- docs/CONTEXT.md and docs/OWNERSHIP.md.
- packages/schemas: all shared zod schemas and types, one example per concept, and a test that validates every example.
- services/api: Hono + better-sqlite3 skeleton with all endpoints, mock gateways, and the full POST /intake flow.
- apps/web: rebuilt as Redline, matching apps/web/design/redline-reference.html. Site pages #/, #/vault, #/scoring, #/about, and the dashboard at #/app/overview, invoices, evaluation, controls. Rules in docs/BRAND.md. Still on mock data.
- Product renamed to Redline. Package names, folders, and schema ids (`spendgym-*-v1`) keep the spendgym name. Mock account ids are now `*.redline.testnet`.

## Interfaces I expose

- `@spendgym/schemas`: every schema as `XSchema` with type `X`, plus the `AgentRunner`, `DecisionAdapter`, `VaultGateway`, and `EvidenceGateway` interfaces.
- API on http://127.0.0.1:8787. See services/api/README.md for the routes.
- Real gateways plug in at one place: `services/api/src/gateways/index.ts`.

## Blockers

## Requests

- Tharun: please confirm these additions to the vault contract surface, which came out of building the API:
  - `VaultGateway.getBinding`, needed for `expected_binding_revision` and the active agent version.
  - Every `VaultGateway` method takes `vaultId` first, since there is one vault per business.
  - `OperationStatus` values (REQUESTED, RESERVED, SETTLED, FAILED_KNOWN, OUTCOME_UNCERTAIN) and the new `VaultUsage` shape.
  - Is there an unpause? The agreed interface only has `pause`, and the mock clears it on restart.
  - Should a paused vault also block `owner_pay`? The mock allows it. Owner payments also do not count against agent caps in the mock.
  - The API needs a way to list a vault's payables, vendors, POs, and receipts to build `AgentContext`. Today that comes from the mock seed.
  - The dashboard shows account ids, so please deploy under `*.redline.testnet` if you can. Examples and the mock seed already use those names.
  - The attack log on #/vault is scripted copy in apps/web/src/components/Terminal.tsx. Please send the real malicious-signer output when it runs so the page can match it. `KEY NOT PERMITTED` there is not a `VaultRejection`; it stands for the key failing at the NEAR level. Tell me if the real wording differs.
- Kristian: `DecisionAdapter.toPaymentRequest` takes a third argument with the current policy and binding revisions, because `AgentContext` does not carry them.
- Lucy: `EvaluationCase` scores `ai_result` and `vault_result` separately, and `assessment_outcome` is MET_THRESHOLDS, BELOW_THRESHOLDS, or NOT_ASSESSED. Please confirm these fit the Gym.
- Lucy: #/scoring reads metric ids `useful_payments`, `unsafe_proposals`, `vault_containment`, and a new `exceptions_to_human`. It only counts runs that are COMPLETED and assessed, and only shows the suite fingerprint when the on-chain record matches. Until then it shows placeholders of `[ ] of 20`, `[ ] of 20`, `[ ] of 8`. Please use those ids and confirm the real denominators.

## Next

- Merge teammates' gateways as they land.
- Add authentication before a real owner key is connected. The API has none today and binds to localhost only.
- Add a UI for submitting a test invoice (POST /intake works, but no view calls it yet).
- Add a vault switcher so the UI can show business B. The API already takes `vault_id`.
- Add unpause to the dashboard if the contract gets one. Today the button locks after pausing and a mock restart clears it.
- Decide how the dashboard labels mock data before submission. The old mock banner is gone, and `data_source` is still in GET /overview.
- Rename Spend Gym in the root README.md and LICENSE, which were outside this task's edit list.
