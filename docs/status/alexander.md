# Status: alexander

## Payee Shield (2026-11-07)

Brief: [docs/PAYEE_SHIELD.md](../PAYEE_SHIELD.md). Everything below runs on the stub engine and memory registry. Nothing reads a registry contract yet.

### Done

| Piece | Where | State |
| --- | --- | --- |
| Schemas | `packages/schemas/src/payee-check.ts` | On main |
| `/v1/check`, `/v1/resolve`, `/v1/vendors`, `/v1/payments/record`, free tier and 402 | `services/api/src/payee` | Done on stub and memory |
| Signed receipts, `/.well-known/redline-attestor.json` | `services/api/src/payee/attestor.ts` | Done. Signed by the API's key, no TEE claim |
| `/v1/vendors/verify`: nep413, eip191, solana-ed25519, merchant identity | `services/api/src/payee/proofs.ts`, `verify-vendor.ts` | Done. NEP-413 checked against a real `near-api-js` signature |
| Proof and seed scripts | `scripts/make-payee-proof.ts`, `scripts/seed-payees.ts` | Done |
| SDK, hosted and direct | `packages/sdk` | Hosted done. Direct runs on the sample registry |
| x402 guard, fake server, swap walkthrough | `packages/x402-guard`, `scripts/demo-x402-swap.ts` | Done. Tested with the real `@x402/fetch` wrapper and `x402Client` hook, using a stand-in payment scheme. Not run against a real facilitator |
| MCP server, HTTP and stdio | `services/mcp` | Done. `server.json` written, not published |
| Agent onboarding | `apps/web/public/llms.txt`, `docs/skills/redline-payee-check/SKILL.md`, root README | Done |

Root `pnpm test` now builds every package first. Root `pnpm dev` builds the API's dependencies first.

### Blocked

- `REDLINE_PAYEE_ENGINE=live` needs `@redline/payee-check` (Lucy). Until then the API refuses to start in this mode.
- `REDLINE_REGISTRY_MODE=near` and direct mode reading NEAR both need `PayeeRegistryClient` (Tharun). Until then near mode refuses to start, and direct mode without a `registry` option reads a built-in sample registry and logs one warning.
- A public API or MCP URL. `llms.txt`, the skill file and `server.json` have no hosted URL to point at, so they use localhost or leave it out.

### Decisions needed from Alexander

- **AP2 wording.** The brief asked for "AP2 silently drops payee constraints". I could not find a source for it. The AP2 spec defines `payment.allowed_payees` and says the payee MUST be in that list. `docs/PAYEE_SHIELD.md` says what I could support: AP2 identifies a merchant by id, name and website, and nothing proves a payout account belongs to it. If you have a source for "silently drops", send it and I will change the line.
- **Seed domains.** Seed vendors use realistic domains such as `fernhill.example`, and I did not check whether real companies hold them. They only exist in memory today. Replace them before `seed-payees` ever writes to a public registry.
- **Authentication before hosting.** The API has no auth and binds to localhost. Before `/v1` goes public: split it from the owner routes (`/review/*`, `/vault/*`), and add auth to `POST /v1/payments/record`, since today anyone who knows a payer id can write to its history.
- **npm scope.** `server.json` names `@redline/mcp`. All packages are `private: true`, and I did not check that the `@redline` scope is available.
- **Repo name.** `server.json` links to the repo, and the URL contains "Hackathon". Consider renaming the repo before publishing.

### Env vars added

In `.env.example` only: `REDLINE_PAYEE_ENGINE`, `REDLINE_REGISTRY_MODE`, `REDLINE_SEED_PAYEES`, `REDLINE_ATTESTOR_KEY`, `REDLINE_FREE_CALLS_PER_DAY`, `REDLINE_TRUST_PROXY`, `REDLINE_X402`, `REDLINE_X402_PAY_TO`, `REDLINE_X402_NETWORK`, `REDLINE_X402_ASSET`, `REDLINE_API_URL`, `MCP_PORT`, `MCP_ALLOWED_HOSTS`.

The API now loads the repo root `.env` at startup. Values already in the shell win.

### Interface notes

**Tharun.** Export `PayeeRegistryClient` from `packages/vault-client`. It gets wrapped as `PayeeRegistry` from `packages/sdk/src/interfaces.ts`, at the marked TODO in `services/api/src/payee/runtime.ts`. What it needs:

- Views: `get_vendor(domain)`, `find_by_account(caip10)` and a way to list every vendor. The engine compares accounts against the whole registry to catch look-alikes when no domain is claimed.
- `attest_vendor({ domain, name, accounts, evidence_hash, issued_at, legal_name })`. Accounts are normalized CAIP-10 strings: lowercase for EVM, as-is for Solana.
- Records shaped like `RegistryVendor`: `verifiedAt` and `issuedAt` as ISO strings, and per account `status` (`active` or `pending`) with `activatesAt`.
- Cooling off belongs in the contract. The memory registry's rules are the reference: first attestation active at once, later accounts pending for 72 hours, unchanged accounts keep their status, accounts missing from a new file are removed at once, an older `issued_at` is refused.
- Reads must work in a browser with no `fs`, because direct mode reads the views from the SDK. If the client imports `fs` at the top level, please split the read path out.

**Lucy.** `@redline/payee-check` gets wrapped as `PayeeEngine` from `packages/sdk/src/interfaces.ts`, at the other TODO in `runtime.ts`, and direct mode runs the same functions.

- Rules and expected results: `packages/sdk/src/stub-engine.ts` and `packages/sdk/test/sdk.test.ts`. Please run those verdict tests against your engine. If we disagree, the brief decides.
- The stub's look-alike rule is simple on purpose: same first and last 4 characters on EVM and Solana; on NEAR, confusable characters, edit distance 2 or less, or containing the vendor's label. Yours should replace it.
- The stub's signals are a fixed table. Real NEAR signals need a `SignalsProvider`: throw, or return nulls with `supported: true`, when they cannot be read, and that becomes `SIGNALS_UNAVAILABLE`.
- `verifyReceipt` signs over `reasons` in order, so keep your reason order deterministic.
- `caseFile` is always null until the investigator agent lands.

**Kristian.** Attack surfaces for the benchmark:

- `POST /v1/check` and `/v1/resolve`, with `pnpm --filter @redline/api start`.
- `withRedline` in `packages/x402-guard`. `createFakeX402Server` from `@redline/x402-guard/fake-server` has honest and malicious modes, and can sign offers with the site's key. Please add attacks in your own folder rather than changing it.
- Known gaps, to save you time: stub look-alike rules miss Unicode and anything beyond the patterns above; the merchant identity signature is not checked; EVM contract wallets (EIP-1271) cannot prove an account; a hijacked website can still start a new account's cooling-off period.

## Done

- Repo scaffold: pnpm workspace, folder READMEs, LICENSE, .gitignore, .env.example.
- docs/CONTEXT.md and docs/OWNERSHIP.md.
- packages/schemas: all shared zod schemas and types, one example per concept, and a test that validates every example.
- services/api: Hono + better-sqlite3 skeleton with all endpoints, mock gateways, and the full POST /intake flow.
- apps/web: rebuilt as Redline, matching apps/web/design/redline-reference.html. Site pages #/, #/vault, #/scoring, #/about, and the dashboard at #/app/overview, invoices, evaluation, controls. Rules in docs/BRAND.md. Still on mock data.
- Product renamed to Redline everywhere in the repo, including package names (`@redline/*`), schema ids (`redline-*-v1`), and the event standard (`redline`). The test token is now Redline Test Dollar (REDL).

## Interfaces I expose

- `@redline/schemas`: every schema as `XSchema` with type `X`, plus the `AgentRunner`, `DecisionAdapter`, `VaultGateway`, and `EvidenceGateway` interfaces.
- API on http://127.0.0.1:8787. See services/api/README.md for the routes.
- Real gateways plug in at one place: `services/api/src/gateways/index.ts`.

## Blockers

## Requests

- Everyone: main is renamed to Redline. After merging main, run `pnpm install`, and move your imports to `@redline/schemas` and your schema ids to `redline-*-v1`.
- Everyone: the test token is now Redline Test Dollar (REDL), deployed at `redl.redline-labs.testnet` under the new root `redline-labs.testnet`. After merging main, run `pnpm install` and use REDL anywhere you wrote the old symbol.
- Lucy: write the hidden cases in REDL. fixtures/dev and evidence/example-run are already updated and regenerated, so the example suite commitment changed.
- Kristian: the prompt text changed with the symbol, so manifest digests A and B changed. They are updated in docs/status/kristian.md.
- Tharun: the deployment is now under `redline-labs.testnet`. Records are in scripts/contracts/deployments, and the keys are in WSL at `~/.redline/testnet/`.
- Tharun: contract events should use the standard `redline`, matching `RedlineEventSchema`.
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

- Connect the API to `NearVaultGateway` on `redline-labs.testnet`. The mock seed still uses `*.redline.testnet` names.
- Merge teammates' gateways as they land.
- Add authentication before a real owner key is connected. The API has none today and binds to localhost only.
- Add a UI for submitting a test invoice (POST /intake works, but no view calls it yet).
- Add a vault switcher so the UI can show business B. The API already takes `vault_id`.
- Add unpause to the dashboard if the contract gets one. Today the button locks after pausing and a mock restart clears it.
- Decide how the dashboard labels mock data before submission. The old mock banner is gone, and `data_source` is still in GET /overview.
