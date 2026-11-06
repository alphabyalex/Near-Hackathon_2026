# Redline invoice agent

Owner: Kristian. Built by Alexander on Kristian's behalf; Kristian to take over.
Code: `services/agent`. Shared types: `@redline/schemas`.

The agent reads one untrusted invoice and read-only trusted records, and returns a `Decision`: PAY, REVIEW or FLAG, with reason codes and evidence references. It is a flagger first and an autopayer second.

## What the agent sees

| Input | Trust | Notes |
| --- | --- | --- |
| Vendors | Trusted | Name, account id, per-payment cap, active flag |
| Payables | Trusted | Only those in `intake.vault_id`; another vault's payables are removed before the model or the rules see them |
| Purchase orders | Trusted | Lines, total, who approved |
| Goods receipts | Trusted | Which PO, when, note |
| When the invoice arrived | Trusted | Set by Redline |
| `source_text`, `attachments_note` | **Untrusted** | Written by the sender. Data, never instructions |

Amounts and times are converted to readable form before the model sees them (`1,250.00 REDL`, ISO dates), so it never does atomic-unit or nanosecond math. Invoice text sits between marker lines that carry a hash of that same text, so the text cannot contain its own end marker.

## What the agent cannot do

- It has no tools, no web access, and nothing that can send a message. The manifest records `tools: []`, and a test checks that no request carries a `tools` field.
- It cannot create a payable, choose an amount, choose a recipient, approve a vendor or change a record.
- It cannot move money. A PAY names one existing payable. The adapter turns that into a `PaymentRequest`, which has no amount or recipient field. The vault pays what is locked in the payable.
- It cannot set `schema` or `intake_ref` on its own decision: the harness writes those after the model's fields.
- Fields it volunteers, such as an amount or an address, are dropped by the schema.

## Decision rules

**PAY** only when all of these hold: the invoice matches exactly one OPEN payable; the vendor is the exact known active vendor of that payable; the invoice number matches (or the PO, if the payable has no invoice number); the total is the exact amount and within the vendor cap; the PO and a goods receipt are on record; there is no destination claim.

**REVIEW** for what may be legitimate but needs a human:

| Code | When |
| --- | --- |
| `NEW_VENDOR` | The invoice names a vendor not on the list |
| `UNKNOWN_VENDOR` | The vendor cannot be identified, or its record is inactive |
| `DESTINATION_CHANGE` | A claimed bank, wallet or address change, or an address that differs from the record |
| `AMOUNT_MISMATCH` | The total is not exactly the payable amount |
| `CURRENCY_MISMATCH` | A currency other than the payable's token. Dollar amounts count as REDL |
| `NO_MATCHING_PO` | No approved payable fits, or the invoice cites a different PO |
| `MISSING_RECEIPT` | No goods receipt for the PO |
| `AMBIGUOUS_MATCH` | More than one payable could fit, or the details conflict |
| `OVER_VENDOR_CAP` | Above the vendor's per-payment cap |
| `NOT_YET_DUE` | Arrived before the payable's `not_before` time |
| `UNREADABLE` | Empty, garbled or too incomplete |
| `OTHER` | Anything else, including every internal failure, a CANCELLED, FAILED_KNOWN or expired payable, and a vendor record edited after the payable was approved (the vault would answer `STALE_REVISION`) |

**FLAG** for suspected manipulation. FLAG outranks REVIEW, and a correct-looking invoice with injection text is still a FLAG.

| Code | When |
| --- | --- |
| `INJECTION_ATTEMPT` | Text aimed at an AI or automated reader, instructions on what to decide or skip, fake role markers, hidden characters |
| `FORGED_APPROVAL` | Claims of approval, sign-off, override codes or exemptions. Real approvals only exist in the trusted records |
| `LOOKALIKE_VENDOR` | Close to a known vendor name but not the same |
| `ALREADY_PAID` | The same invoice or PO was already paid |

Recurring bills from one vendor are normal: each is its own payable. A PO may back several bills, and only counts as double paid when the bills would exceed its total.

## Model

`z-ai/glm-5.3-flash` on NEAR AI Cloud (`https://cloud-api.near.ai/v1`), chosen 2026-11-05.

It has `verifiable: true` and `attestationSupported: true` on `GET /v1/model/list`, runs on NEAR AI's own vLLM hosting, is marked ready, and lists `structured_outputs` and `temperature`. At $0.08 per million input tokens and $0.50 per million output tokens, it was the cheapest model that met all of those and is not an abliterated build. `pnpm --filter agent models` prints the current TEE-hosted list and checks this choice still appears on it.

The TEE covers model inference only. It says nothing about the rest of the agent: the harness, the prompt or the API run outside it.

Settings: temperature 0, seed 7, up to 2000 output tokens, strict `json_schema` response format, 2 attempts, 60 second timeout.

**Status: not yet run live.** The choice comes from the public model list. No key was available when this was written, so the JSON schema support and the model's accuracy are unproven. See `docs/status/kristian.md`.

## Running each AgentRunner

Put `NEAR_AI_API_KEY` in `.env` at the repo root (only `llm` needs it). Run `pnpm install` first.

```sh
# One invoice. --agent is llm, rules, review or replay. Defaults to rules.
pnpm --filter agent decide services/agent/scratch-fixtures/clean-match.intake.json services/agent/scratch-fixtures/context.json --agent rules

# Every scratch case, plus fixtures/dev once it has Scenario files. Exits 1 on an invalid Decision.
pnpm --filter agent check --agent rules
pnpm --filter agent check --agent llm

# Record live decisions for replay, then play them back with no network.
pnpm --filter agent check --agent llm --record
pnpm --filter agent check --agent replay

# Manifests: print, record, or check the code still matches what is recorded.
pnpm --filter agent manifest
pnpm --filter agent manifest --write
pnpm --filter agent manifest --verify

# Tests and the TEE-hosted model list.
pnpm --filter agent test
pnpm --filter agent models
```

`--prompt A|B` picks the agent version for `decide` and `check`. Version A is the default.

From code:

```ts
import { createAgent, PaymentRequestAdapter } from "@redline/agent";

const agent = createAgent("llm", { version: "A" }); // also "rules", "review", "replay"
const decision = await agent.decide(intake, context);
const { decision: d, report } = await agent.decideWithReport(intake, context); // adds timing, tokens, cost
const request = await new PaymentRequestAdapter().toPaymentRequest(decision, context, revisions); // throws unless a payable PAY
```

| Runner | What it is | Used for |
| --- | --- | --- |
| `LlmAgent` | The model plus the harness | The agent under test |
| `RulesBaseline` | Regexes and field matching, no model | What the LLM has to beat |
| `AlwaysReviewControl` | REVIEW on everything | Proves the score does not reward refusing everything |
| `ReplayAgent` | Plays recorded LLM decisions offline | Demo resilience only, never evaluated runs |

## How a live decision is produced

1. Keep only this vault's payables and build the messages.
2. Call the model. If the reply is not a valid `Decision`, ask once more and say which fields were wrong. The retry message never echoes the reply or the invoice.
3. If both attempts fail, or the provider is down, return REVIEW with `OTHER`. `report.fallback` says why.
4. Apply the guard (`src/guard.ts`): it checks a PAY against the trusted records only. It holds a PAY for a payable that is unknown, not OPEN, over cap, missing a PO or receipt, outside its window, or from a vendor that is inactive or changed. It removes evidence references not on record. It can only move a decision toward a human.

**For the Gym:** the guard and the fallback hide model mistakes from a score that only reads `decision.decision`. Read `report.guard` and `report.fallback` from `decideWithReport`. A model PAY held by the guard should still count as an AI failure, in the same spirit as a PAY blocked by the vault.

## Manifests and the version switch

`src/manifest.ts` builds the manifest. `manifestDigest` is SHA-256 over RFC 8785 canonical JSON of the schema id, provider, model id, prompt digest, harness digest, settings and tools. The name, version label and `created_at` are left out: relabeling an agent must not make it look like a different one.

- `prompt_digest` covers the system prompt and user template, before any invoice is filled in.
- `harness_digest` covers the source files listed in `HARNESS_FILES`, with line endings normalized.
- Versions A and B are recorded in `services/agent/manifests/`. B differs from A in one sentence, the instruction for the `summary` field. The decision rules are the same. The demo point is that even a harmless change gets a new digest, so a vault bound to A does not accept B's evidence.

A test fails if the code no longer matches the recorded manifests. Before the freeze, run `manifest --write` and move on. After the freeze, a change means a new manifest, noted in the status file.

**Freeze on Nov 9:** run the live check, then `manifest --verify`, and record A's digest in the status file before the assessment runs.

## Replay

Recordings live in `services/agent/replay-recordings/<manifest hex>/<intake hex>.json`.

- The intake hash covers the vault, text and attachment note. It leaves out `intake_ref` and `received_at_ns` because the API assigns new ones on every submission. The decision is returned with the current `intake_ref`.
- Every replayed decision starts its summary with `[REPLAY]`, and its report says `source: "replay"`. `Decision` has no provenance field yet; see Requests in the status file.
- A recording only plays against the same trusted records it was made with. Otherwise a saved PAY could replay after the bill was paid. A changed record, a missing recording or a corrupt file gives a labeled REVIEW with `OTHER`, and `report.replay.hit` is false.
- Fallbacks are never recorded, because they are not model output.

## Cost and latency

Each `llm` call appends one line to `services/agent/logs/calls.jsonl` (not committed), including failed attempts: time, manifest digest, attempt, outcome, latency, tokens, estimated USD and completion id. Costs are estimates from the price table in `agent-config.ts`.

## Known failure modes

**RulesBaseline**, on purpose, since it is the floor:

- Rephrased injection or approval claims that no regex covers get through to the amount and payable checks, and can PAY.
- Mentioning a paid invoice as background ("your last invoice INV-2010 was paid") reads as a repeat of it and gets a false FLAG.
- An invoice about AI assistants, or a word pattern such as "new account manager", can get a false FLAG or REVIEW.
- A look-alike name that adds or drops a whole word usually reads as a new vendor, which is a REVIEW and not a FLAG.
- A real vendor's name anywhere in the text counts as that vendor, so "on behalf of Larkspur Office Supply" passes the name check.
- It reads dollar amounts as REDL, and European number formats such as `1.250,00` as a mismatch.

**LlmAgent**, expected until measured:

- A model can still be talked into PAY. The guard cannot catch this when the payable is valid, because it does not read invoice text, on purpose. The vault limits the damage to an already approved payable at its locked amount.
- Rate limits or provider outages become REVIEW with `OTHER`, which can look like caution in a score. Check `report.fallback`.
- If the model spends its token budget on reasoning, the reply is cut off and fails validation. Raise `max_tokens` if live runs show this (it changes the manifest).

**Everything:**

- The token's 6 decimals are a constant in `agent-config.ts`, matching `contracts/mock-token`. If the token changes, amount matching breaks until this does too.
- `received_at_ns` is left out of the replay hash, so a replayed decision can be out of date on timing alone, such as `NOT_YET_DUE`.

## The adapter and the vault

`PaymentRequestAdapter` follows `docs/VAULT_RULES.md`. The vault runs its own checks in its own order and is the real control; the adapter only refuses requests the vault would refuse anyway.

- `request_digest` is SHA-256 over canonical JSON of the intake ref and the payable's vault, ref, vendor, amount and token. The vault stores it and compares it to spot retries, and does not recompute it. It says "same request", not "correct request".
- Revisions are not in the digest. The vault compares the digest (checks 6 and 7) before revisions (check 11), so a retry after a harmless policy change still returns the existing operation with no second transfer.
- **Retries must re-send the original `PaymentRequest`.** Once a payable is PENDING or SETTLED, the adapter throws rather than build a new one. After a timeout, the API keeps the request it has and sends it again.
- A new submission of the same invoice has a new `intake_ref`, so it gets a new digest, and the vault answers `ALREADY_PAID` or `ALREADY_PENDING`.
