# Wardline

AI that only pays on proof. Wardline pays for a model call only when NEAR AI's TEE signature shows the model you asked for signed that exact response. It spends from a deposit that caps every member, and checks who an agent is about to pay before money moves. If a Wardline approval was wrong, Wardline Mutual pays the customer back, and our own first-loss stake pays first. Developers plug in by changing one line: the OpenAI client's base URL. Read [docs/PAYEE_SHIELD.md](docs/PAYEE_SHIELD.md) for the payee check.

## Try it

Needs Node 20.19 or later and pnpm 12. Run these from the repo root. No keys or accounts are needed, and nothing here calls NEAR AI: AI calls replay real NEAR AI traffic recorded in `fixtures/nearai`. Commands are for a POSIX shell.

### 1. Build

Run:

```sh
pnpm install
pnpm build
```

See: both commands exit 0.

### 2. Start the demo providers and the API

Run each in its own terminal and leave them running:

```sh
pnpm demo:providers
```

```sh
WARDLINE_PAYEE_ENGINE=stub WARDLINE_REGISTRY_MODE=memory WARDLINE_AI_PROVIDER_URL=http://127.0.0.1:8791/replay/v1 WARDLINE_SEED_METER_KEYS=true pnpm --filter @wardline/api start
```

See: `Demo providers on http://127.0.0.1:8791/{replay,cheapai,simtee}/v1` in the first. In the second, `Wardline API on http://127.0.0.1:8787 (payee engine stub, registry memory, chain sim)`, `AI gateway at /v1/ai`, two lines starting `Meter key for`, and `Owner routes at /owner`. The first run also writes a development signing key to the gitignored `.env`.

### 3. Resolve northwind

Run:

```sh
curl -s http://127.0.0.1:8787/v1/resolve -H 'content-type: application/json' \
  -d '{"domain":"northwind.example","chain":"near:testnet"}'
```

See: `"verdict":"PAY"`, `"account":"near:testnet:northwind.testnet"`, `"code":"VERIFIED_MATCH"`, `"evidenceTier":"T2_DOMAIN_LINKED"` and a signed `receipt`. T2 means the vendor controls the account and its domain lists it. It does not establish legal ownership.

### 4. Check a look-alike

Run:

```sh
curl -s http://127.0.0.1:8787/v1/check -H 'content-type: application/json' \
  -d '{"payee":"near:testnet:northw1nd.testnet","vendor":{"domain":"northwind.example"}}'
```

See: `"verdict":"BLOCK"`, `"code":"LOOKALIKE_ACCOUNT"` and `"evidenceTier":"T0_NONE"`, with `"lookalikeOf":"near:testnet:northwind.testnet"`.

### 5. Run the x402 swap

A paid API swaps its `payTo` to a look-alike address and signs the swap with its own website key. No funds move.

Run:

```sh
WARDLINE_API_URL=http://127.0.0.1:8787 pnpm demo:x402-swap
```

See: `Offer signature:  valid`, then `Verdict:          BLOCK`, `Reason:           LOOKALIKE_ACCOUNT` and `Payments made:    0`. The command exits 0.

### 6. Pay for an AI call on proof

This is what an OpenAI client does after its base URL changes to `http://127.0.0.1:8787/v1/ai`. Use the key printed for `alice.testnet` in step 2.

Run:

```sh
KEY=wk_paste_the_alice_key_here
curl -si http://127.0.0.1:8787/v1/ai/chat/completions -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"model":"deepseek-ai/DeepSeek-V4.1-Flash-1017","messages":[{"role":"user","content":"In one sentence, why should an AI agent verify who it is paying?"}],"max_tokens":600,"temperature":0}'
```

See: `HTTP/1.1 200`, `x-wardline-proof: verified`, `x-wardline-model-proven: deepseek-ai/DeepSeek-V4.1-Flash-1017`, `x-wardline-settlement: sim-settle-...` and DeepSeek's answer. Run it again and see `502` with `"code":"REPLAYED"`: the same signed response is never paid twice. The JavaScript and Python versions are on the site's Connect page.

### 7. Watch a swapped model get refused

cheapai claims to serve DeepSeek V4.1 Flash but answers with GLM-5.3 Flash and passes that model's real NEAR AI signature through.

Run:

```sh
pnpm demo:swapped-model
```

See: `Asked for:      deepseek-ai/DeepSeek-V4.1-Flash-1017`, `Signature names: z-ai/glm-5.3-flash`, `Gateway:        HTTP 502, X-Wardline-Proof: refused, MODEL_MISMATCH`, and a line showing it paid `0.000000` and refunded the whole hold.

### 8. Hammer a leaked key

Run:

```sh
pnpm demo:leaked-key
```

See: the first leaked key gets `10 paid, 30 refused with 402 (ALLOWANCE_EXHAUSTED)`, the second `5 paid, 35 refused with 402 (BUDGET_EXHAUSTED)`, and the last line `spent 0.030000 of 0.030000 WUSD, 65 requests refused`.

### 9. Run the tests

Run:

```sh
pnpm test
```

See: every package passes and the command exits 0. This does not need the API to be running, and makes no NEAR AI calls.

Red-team benchmark, offline from committed fixtures: run `pnpm --filter @wardline/redteam bench`, see the catch rates in docs/REDTEAM.md.

## Hackathon Tracks

Wardline spans four tracks of the NEAR Hackathon 2026:

1. **Privacy and Private AI (Lead track)**
   - Cryptographic verification of TEE inferences from NEAR AI Cloud.
   - On-chain EIP-191 signature recovery with `env::ecrecover` in `contracts/meter`.
   - Attested model registry in `contracts/model-registry` binding model IDs to verified hardware keys.
   - Automatic refund when downstream model swaps or forged completions are detected.

2. **Social Money**
   - Shared team and DAO AI budgets on NEAR with member allowances and automated rollover.
   - Wardline Mutual in `contracts/cover-pool`: loss-sharing coverage pool with junior first-loss capital and senior LP yield.
   - Sputnik DAO v2 integration in `packages/dao-adapter` mapping governance proposals to on-chain pool payouts and cap adjustments.

3. **Autonomous Business**
   - Payment authority layer for AI agents: agents read invoices and call models, but never pick destinations or bypass vault caps.
   - Nonce-protected reservations preventing runaway bills or double-spending from stolen keys.
   - x402 payment protocol guard in `packages/x402-guard` inspecting HTTP 402 payment headers.

4. **Real-World Money**
   - Accounts payable vaults in `contracts/vault` enforcing human approval, cooldown periods, and two-person separation on vendor destination changes.
   - Look-alike account blocking in `packages/payee-check`.

## Where things are

| Path | What it is |
| --- | --- |
| `services/api` | API: `/v1/ai` metered gateway, `/v1/check`, `/v1/resolve`, vendors, receipts, Wardline Mutual |
| `packages/sdk` | `@wardline/sdk`: `openai()`, `getCall`, `verifyProof`, hosted and direct payee checks |
| `packages/dao-adapter` | Sputnik DAO proposals for funding, allowances, providers, payout changes and claims |
| `services/demo-provider` | Offline upstreams: recorded NEAR AI traffic, cheapai, a local test TEE |
| `packages/x402-guard` | `@wardline/x402-guard`, checks each x402 offer before paying |
| `services/mcp` | `@wardline/mcp`, MCP server for agents |
| `fixtures/nearai` | Real NEAR AI requests, responses, signatures and attestation reports, recorded once |
| `apps/web/public/llms.txt` | Onboarding for agents |
| `docs/skills/wardline-payee-check` | The same as an agent skill |
| `contracts`, `packages/vault-client`, `packages/vault-sim` | NEAR contracts and clients |
| `tests/sandbox` | Live NEAR sandbox integration test suite for vaults, meter, and cover pool |
| `services/agent`, `services/evaluator` | Invoice agent and the Gym |
