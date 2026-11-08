# services/agent

Owner: Kristian

The Wardline invoice agent: `LlmAgent`, `RulesBaseline`, `AlwaysReviewControl`, `ReplayAgent`, version manifests and the decision-to-request adapter. It provides the real `AgentRunner` and `DecisionAdapter`.

Full docs, including decision rules and known failure modes: [docs/AGENT.md](../../docs/AGENT.md).

## Quick start

```sh
pnpm install
pnpm --filter @wardline/schemas build
pnpm --filter agent test
pnpm --filter agent check --agent rules
```

For the live model, put `NEAR_AI_API_KEY` in the repo root `.env`, then run `pnpm --filter agent check --agent llm`.

## Layout

| Path | What it holds |
| --- | --- |
| `src/llm-agent.ts` | `LlmAgent`: calls the model, validates, retries once, applies the guard |
| `src/prompts.ts` | Prompt versions A and B |
| `src/render.ts` | Builds the messages and wraps invoice text as untrusted data |
| `src/guard.ts` | Holds a model PAY that the trusted records do not support |
| `src/checks.ts` | Checks on trusted records, shared by the guard, the rules and the adapter |
| `src/rules-baseline.ts`, `src/amounts.ts` | `RulesBaseline`: regexes and field matching, no model |
| `src/always-review.ts` | `AlwaysReviewControl` |
| `src/replay.ts` | `ReplayAgent`, `RecordingAgent`, `ReplayStore` |
| `src/manifest.ts` | Manifest and digest builders |
| `src/adapter.ts` | `PaymentRequestAdapter`: Decision to PaymentRequest |
| `src/factory.ts` | `createAgent`, the one place to get an agent |
| `src/agent-config.ts` | Model id, settings and prices. Most of this goes into the manifest |
| `src/cli.ts` | The `decide`, `check`, `manifest` and `models` commands |
| `manifests/` | Recorded manifests for versions A and B |
| `scratch-fixtures/` | Four cases written for this package, used until `fixtures/dev` arrives |
| `replay-recordings/` | Recorded LLM decisions. Empty until the first live `--record` run |

The CLI refuses to read anything under `fixtures/` except `fixtures/dev`. Lucy keeps the hidden test invoices away from this workstream so our scores stay honest.
