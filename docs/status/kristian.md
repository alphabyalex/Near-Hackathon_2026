# Status: kristian

Built by Alexander on the alexander branch on Kristian's behalf; Kristian to take over.

Start with [docs/AGENT.md](../AGENT.md). It covers decision rules, how to run everything, and known failure modes.

## Done

- `services/agent` package (`@redline/agent`), all in TypeScript:
  - `LlmAgent`: NEAR AI Cloud, strict JSON schema output, zod validation, one retry, then REVIEW with `OTHER`. Invoice text is wrapped as labeled untrusted data. No tools.
  - `RulesBaseline`, `AlwaysReviewControl`, and `ReplayAgent` with `RecordingAgent`.
  - Manifest builder (RFC 8785 canonical JSON, SHA-256) with versions A and B recorded in `services/agent/manifests/`.
  - `PaymentRequestAdapter`, following `docs/VAULT_RULES.md`.
  - CLI: `decide`, `check`, `manifest`, `models`. Per-call cost and latency log in `services/agent/logs/calls.jsonl`.
- Tests: 109 passing with a fake model client. Typecheck and build pass. Five safety lines were broken on purpose to check the tests catch it. One test did not, and was fixed.
- Four scratch cases in `services/agent/scratch-fixtures`.
- `docs/AGENT.md`.

### Gates

| Gate | State |
| --- | --- |
| RulesBaseline gives valid Decisions on dev cases | **Met on scratch cases only** (4 of 4 valid, 4 of 4 as expected). `fixtures/dev` has no invoices yet |
| LlmAgent gives valid Decisions on dev cases | **Not met.** It has never called the real model, because there is no API key. Only tested against a fake client |
| Candidate A frozen by Nov 9 | Not yet. Needs a live run first |

### Current manifest digests (candidates, not frozen)

| Version | Digest |
| --- | --- |
| A | `sha256:235f34dd1b74bdabe8ddf3bfd75832ed7aca8cc67cd862afe727ae15e9f25baf` |
| B | `sha256:75e5790ebfdd7e339bf4a78d4fe9bf0b0fd2e981932d77dc942914898cccb842` |

Model: `z-ai/glm-5.3-flash`. These digests will change if the first live run needs a harness or settings fix. That is fine before the freeze.

## Interfaces I expose

From `@redline/agent` (run `pnpm --filter agent build` first, as with schemas):

- `createAgent(kind, options)`: kind is `llm`, `rules`, `review` or `replay`. Returns a `ReportingAgent`, which is an `AgentRunner` plus `decideWithReport`.
- `decideWithReport(intake, ctx)` returns `{ decision, report }`. `report` has timing, tokens, cost, `fallback`, `guard` and `replay`.
- `PaymentRequestAdapter`: implements `DecisionAdapter`. Throws `NotPayableError` for anything but a payable PAY.
- `buildManifest("A" | "B")`, `manifestDigest(manifest)`, `harnessDigest()`, `promptDigest(version)`.
- `loadRepoEnv()`: loads the repo root `.env`. Only the CLI calls it, so a service must call it or set the environment itself.

## Blockers

- **`NEAR_AI_API_KEY` is missing (Alexander).** There is no `.env` in the repo root. Until it exists, the LLM gate cannot be met and the model's accuracy is unknown. The model list is public, so the model choice was still possible.

## Requests

- **Alexander, lockfile:** `services/agent/package.json` adds a workspace package and the `canonicalize` dependency, but `pnpm-lock.yaml` is outside this lane, so it is not updated. Please run `pnpm install` and commit the lockfile. Until then `pnpm install --frozen-lockfile` fails, which includes CI environments. I installed locally with `pnpm install --filter @redline/agent --ignore-scripts --config.lockfile=false`, which left the lockfile unchanged and added only `canonicalize`.
- **Alexander, API:** to replace `services/api/src/gateways/mock-agent-gateway.ts`, add `@redline/agent` to the API's dependencies and use `createAgent` with `PaymentRequestAdapter`.
- **Alexander, API retries:** after a timeout, re-send the original `PaymentRequest`. Do not call the adapter again. It throws once the payable is PENDING or SETTLED, and the vault's retry check relies on the digest staying the same.
- **Alexander, schemas:** please add a provenance field to `Decision`, such as `source: "live" | "replay"`. Until then, the local stub is a `[REPLAY]` prefix on `summary`, plus `report.source`. A summary prefix is easy for a UI to lose.
- **Lucy:** `pnpm --filter agent check` picks up `Scenario` files in `fixtures/dev` automatically once they are pushed, and only those with split DEV.
- **Lucy:** the LLM runner has a guard, part of the harness digest, that holds a model PAY the trusted records do not support. Score from `decideWithReport`: if `report.guard` is non-empty or `report.fallback` is set, the model's own answer was not what came out. A held PAY should still count as an AI failure, in the same spirit as a PAY the vault blocks. Please confirm this fits.
- **Lucy:** token and timing data for `EvaluationCosts` is in `report.usage`, `report.latency_ms` and `report.cost_usd`.
- **Tharun:** no action needed. FYI `request_digest` is SHA-256 of canonical JSON of the intake ref and the payable's vault, ref, vendor, amount and token, with no revisions, so your checks 6 and 7 see the same digest on a retry. The agent's vendor revision check, cap check and window boundaries follow your spec.

## Next

1. Get the key into `.env`, then run `pnpm --filter agent models` and `pnpm --filter agent check --agent llm`. This is the first real test of the model, its JSON schema support and the prompt.
2. Compare the LLM with `RulesBaseline` and `AlwaysReviewControl` on `fixtures/dev` when Lucy pushes it. Tune only on those cases and scratch cases.
3. If `z-ai/glm-5.3-flash` struggles, try `Qwen/Qwen3.6-35B-A3B-FP8` next. Changing the model means changing `MODEL_ID` and its price in `agent-config.ts`.
4. Record replays for the demo: `pnpm --filter agent check --agent llm --record`, and commit `services/agent/replay-recordings/`.
5. Freeze by Nov 9: run `pnpm --filter agent manifest --write`, record A's digest here, and commit before the assessment runs. Any later prompt or model change means a new manifest, noted here.

## Assumptions to check

- Package names are `@redline/*`. The handoff prompt said `@spendgym/*`, but the repo has already been renamed, and the repo is the source of truth. `pnpm --filter agent` resolves `@redline/agent`.
- Version B changes one sentence: how the `summary` field is written. Its decision rules match A, so the version-switch demo shows a digest change and not a behavior change. If the demo should show B scoring worse, B needs a different change.
- A held PAY that the guard turns into REVIEW is my addition, not in the original brief. It reads trusted records only, and it can only move a decision toward a human.
- A vendor record edited after approval is REVIEW with `OTHER`, not `DESTINATION_CHANGE`, because the vault bumps the revision for any edit, including a cap change.
- Dollar amounts on an invoice count as sgUSD. Other currencies, including USDC, are a `CURRENCY_MISMATCH`.
- `ReasonCode` has both `NEW_VENDOR` and `UNKNOWN_VENDOR`. I use the first for a named vendor not on the list, and the second for an unidentifiable or inactive one. Lucy may want to confirm this for scoring.
