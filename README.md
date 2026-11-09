# Wardline

Wardline lets AI agents spend USDC on NEAR only on proof. A model call is paid only when NEAR AI's TEE signature shows the model you asked for signed that exact response, and an invoice is paid only to an account the vendor's own domain links; a deposit caps every budget, a group can govern its budget from a Sputnik DAO, and if a Wardline approval was wrong, Wardline Mutual pays the customer back with Wardline's own stake losing first.

The problem: agents now pay for things. A model provider can quietly serve a cheaper model than the one you pay for, a leaked key can drain a budget, and a "bank details changed" email can send an invoice payment to a look-alike account. Developers plug in by changing one line, the OpenAI client's base URL.

## Live Hosted Endpoints & Testnet Deployment

- **Web App:** https://lean-ballot-ref-script.trycloudflare.com
- **API Endpoint:** `https://attempt-caused-antique-four.trycloudflare.com`
- **MCP Server (HTTP):** `https://realize-russell-societies-incl.trycloudflare.com/mcp`
- **Testnet Deployment:** `scripts/contracts/deployments/testnet-wardline.json` (deployed contracts on `wardline-labs.testnet` using Circle's testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`)

## Try it in 5 minutes

Needs git, Node 20.19 or later and pnpm 12 (`corepack enable` gives you pnpm). Commands are for a POSIX shell; on Windows use Git Bash. No keys, accounts or `.env` are needed: AI calls replay real NEAR AI Cloud traffic recorded in `fixtures/nearai`, and contracts run as simulations (sim mode). Nothing here calls NEAR AI or sends a transaction.

### 1. Install and build

Do:

```sh
pnpm install
pnpm build
```

See: both commands exit 0.

### 2. Start the demo providers and the API

Do, in terminal A (leave it running):

```sh
pnpm demo:providers
```

See: `Demo providers on http://127.0.0.1:8791/{replay,cheapai,simtee}/v1`. These are offline stand-ins for NEAR AI: `replay` serves the recorded traffic, `cheapai` is a dishonest provider, `simtee` is a local test TEE.

Do, in terminal B (leave it running). Any free port works for `WARDLINE_API_PORT`:

```sh
export WARDLINE_API_PORT=8787
WARDLINE_AI_PROVIDER_URL=http://127.0.0.1:8791/replay/v1 WARDLINE_DEMO_METER_KEY=wk_demo_alice_key pnpm --filter @wardline/api start
```

See: `Demo meter key for alice.testnet (bgt_aurora, sim) is set from WARDLINE_DEMO_METER_KEY`, `Wardline API on http://127.0.0.1:8787 (payee engine stub, registry memory, chain sim)` and `AI gateway at /v1/ai`. The first start writes a development receipt-signing key into a new, gitignored `.env`.

### 3. Pay for one AI call through the one-line plug-in

The script uses the official `openai` client. The only Wardline-specific line is `baseURL: "http://127.0.0.1:8787/v1/ai"`.

Do, in terminal C:

```sh
export WARDLINE_API_PORT=8787
pnpm demo:plugin
```

See:

```
Reply:          An AI agent should verify who it is paying to prevent fraud, misdirected funds, ...
Proof:          verified
Model proven:   deepseek-ai/DeepSeek-V4.1-Flash-1017
Paid:           0.000098 USDC, refunded 0.000641
Settlement:     sim-settle-...
Local re-check: valid, signed by 0xfe0071895500a9755c18044948ab4f4e1a7f337e
```

Wardline reserved the most the call could cost, sent the request bytes unchanged, fetched NEAR AI's `provider_tee` signature over `<model>:<sha256 request>:<sha256 response>`, checked the signer is attested for that model, then paid and refunded the rest. Run it again and it fails with `REPLAYED`: the same signed response is never paid twice. Restart the API to run it once more.

### 4. Watch a swapped model get refused

Do:

```sh
pnpm demo:swapped-model
```

See:

```
Asked for:      deepseek-ai/DeepSeek-V4.1-Flash-1017
Signature names: z-ai/glm-5.3-flash
Gateway:        HTTP 502, X-Wardline-Proof: refused, MODEL_MISMATCH
Reserved 0.000739 USDC, paid 0.000000, refunded 0.000739 (sim-release-...)
```

`cheapai` claims to serve DeepSeek but answers with GLM-5.3 Flash and passes that model's real NEAR AI signature through. The signature names the wrong model, so nothing is paid.

### 5. Hammer a leaked key

Do:

```sh
pnpm demo:leaked-key
```

See:

```
Leaked key 1 (ci-agent.testnet): 40 parallel requests, 20 paid, 20 refused with 402 (ALLOWANCE_EXHAUSTED), spent 10.00 USDC
Leaked key 2 (bob.testnet)     : 40 parallel requests, 10 paid, 30 refused with 402 (BUDGET_EXHAUSTED), spent 5.00 USDC
spent 15.00 of 15.00 USDC, 50 requests refused
```

The first key stops at its member allowance. The second stops at the budget's deposit, the hard cap.

### 6. Block a look-alike payout

Do (the API from step 2 must be running):

```sh
curl -s http://127.0.0.1:$WARDLINE_API_PORT/v1/resolve -H 'content-type: application/json' \
  -d '{"domain":"northwind.example","chain":"near:testnet"}'
curl -s http://127.0.0.1:$WARDLINE_API_PORT/v1/check -H 'content-type: application/json' \
  -d '{"payee":"near:testnet:northw1nd.testnet","vendor":{"domain":"northwind.example"}}'
```

See: the first answers `"verdict":"PAY"`, `"account":"near:testnet:northwind.testnet"`, `"evidenceTier":"T2_DOMAIN_LINKED"` and a signed `receipt`. The second answers `"verdict":"BLOCK"` with `"code":"LOOKALIKE_ACCOUNT"`: `northw1nd` imitates the account Northwind's domain links.

### 7. Run Wardline Mutual

Do:

```sh
pnpm demo:mutual
```

See: two payouts run against the mutual pool. In the first, Wardline's first-loss stake absorbs the whole payout: WARD stays at 1.000000 USDC and outside investors lose nothing. In the second, a larger loss exceeds the remaining first-loss stake: WARD absorbs the difference and dips to 0.999600 USDC. Subsequent fee inflows raise the price again.

### 8. See the benchmark numbers

Do:

```sh
pnpm redteam:numbers
```

See: 250 attack prompts across look-alike payees, swapped models, leaked keys, fake invoices and replayed receipts. The benchmark runs against the local stack; all 250 attacks are stopped. Details in [docs/REDTEAM.md](docs/REDTEAM.md).

### 9. Run the tests

Do:

```sh
pnpm test
cargo test --workspace
```

See: 754 TypeScript tests pass across every package and service, the brand guard passes, and 66 Rust contract tests pass. For end-to-end browser tests run `pnpm test:e2e` (25 Playwright tests against the web UI).

## Live variants

The quickstart above runs entirely offline. To connect to live systems, set the matching environment variable:

- **Live NEAR AI Cloud inference:** set `NEAR_AI_API_KEY=sk-...` and leave `WARDLINE_AI_PROVIDER_URL` unset. The gateway calls NEAR AI Cloud directly and verifies live `provider_tee` signatures.
- **Live NEAR testnet:** set `WARDLINE_CHAIN=near` and configure testnet accounts. Contracts are deployed on `wardline-labs.testnet` using Circle's testnet USDC (`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`).
- **Live web UI:** start `pnpm --filter @wardline/web dev` and open http://127.0.0.1:5173. The UI talks to the API from step 2.

## How it works

```mermaid
flowchart LR
    A[Agent] -->|1. OpenAI client call| B[Wardline Gateway]
    B -->|2. Check deposit & allowance| C[(Budget Meter)]
    B -->|3. Forward unchanged| D[NEAR AI Cloud / TEE]
    D -->|4. Response + TEE signature| B
    B -->|5. Verify signature & model| E[(Model Registry)]
    E -->|Verified| F[Pay provider, charge deposit, refund remainder]
    E -->|Refused / Swapped| G[Zero payment, release deposit, 502 to Agent]
    F -->|Coverage fee| H[(Wardline Mutual Pool)]
```

## What is on-chain vs. off-chain

| Component | Where it lives | Notes |
| --- | --- | --- |
| Budget deposits, allowances, settlements | NEAR contract `contracts/meter` | Deployed on testnet (`meter.wardline-labs.testnet`); moves Circle testnet USDC |
| Model registry: which signer is attested for which model | NEAR contract `contracts/model-registry` | Deployed on testnet (`model-registry.wardline-labs.testnet`); DeepSeek V4.1 Flash registered |
| Wardline Mutual: junior stake, WARD, claims | NEAR contract `contracts/cover-pool` | Deployed on testnet (`pool.wardline-labs.testnet`); mints/burns WARD NEP-141 shares, delayed redeem |
| Payee registry and per-business vaults | NEAR contracts `contracts/payee-registry`, `contracts/vault` | Deployed on testnet (`payee-registry.wardline-labs.testnet`, `vault.wardline-labs.testnet`) |
| Group governance | Sputnik DAO v2 (existing contracts) | `packages/dao-adapter` builds and reads the proposals; deployed on `dao.wardline-labs.testnet` |
| Gateway, payee check, signature checks, receipts, dashboard | Off chain: `services/api`, `apps/web` | Hosted on Cloudflare tunnels; also runs locally |
| Model inference and response signatures | NEAR AI Cloud | Verified live with `NEAR_AI_API_KEY` |

### Honest limits

- Token counts are not signed. The TEE signature shows which model's TEE signed the exact response bytes; Wardline charges by the provider's reported usage, capped at the reservation.
- The attestor is trusted today. Signers enter the model registry from NEAR AI attestation reports; checking the TDX and GPU quotes inside those reports is the attestor's job and is not done independently here.
- `provider_tee` signatures exist only for models NEAR AI serves itself. Models listed as "attested 3p" return gateway signatures, which Wardline refuses as proof of the model.
- Wardline Mutual is protocol-backed coverage on testnet, not insurance. WARD is yield-bearing and loss-sharing; its price can fall.
- Testnet only. Mainnet USDC is a configuration value and has not been used. Streaming responses are refused for now.
- The payee check verifies control of an account and its link to a domain, at a stated trust level. It does not establish who legally owns a business.
- More in [docs/LIMITATIONS.md](docs/LIMITATIONS.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Tracks

| Track | Why |
| --- | --- |
| `privacy` Privacy & Private AI | Pays only for responses signed inside NEAR AI's TEEs, and re-verifies each signature and attestation before money moves |
| `social` Social Money | A group funds one AI budget from its Sputnik DAO or Trezu treasury and votes on allowances, providers, payouts and pool claims |
| `business` Autonomous Business | Agents get metered budgets, per-member allowances and a payee check, so they can pay for models and vendors without a human on every call |
| `realworld` Real-World Money | Circle USDC rails for invoice payments and model spend, with a vendor verification flow businesses can run on their own domain |
| `security` AI Security & Defense | Hard caps, refusal of swapped models and replays, look-alike and changed-account detection, and a red-team benchmark |

## Repository

| Path | What |
| --- | --- |
| `services/api` | Metered AI gateway (`/v1/ai`), payee check (`/v1/check`, `/v1/resolve`), Wardline Mutual, owner routes |
| `packages/sdk` | `@wardline/sdk`: `openai()`, `getCall`, `verifyProof`, payee checks |
| `packages/dao-adapter` | Sputnik DAO v2 proposals for budgets, allowances, providers, payout changes and claims |
| `services/demo-provider` | Offline upstreams: recorded NEAR AI traffic, `cheapai`, a local test TEE |
| `services/mcp` | MCP server for agents |
| `packages/x402-guard` | Checks each x402 offer's `payTo` before paying |
| `apps/web` | Site, demo, Mutual page and owner dashboard |
| `contracts` | NEAR contracts: meter, model registry, cover pool, payee registry, vault |
| `fixtures/nearai` | Real NEAR AI requests, responses, signatures and attestation reports, recorded once |
| `services/redteam`, `evidence/redteam` | Red-team benchmark and its committed results |

Docs: [docs/PAYEE_SHIELD.md](docs/PAYEE_SHIELD.md) (payee check), [docs/DAO.md](docs/DAO.md) (governance), [docs/REDTEAM.md](docs/REDTEAM.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/LIMITATIONS.md](docs/LIMITATIONS.md), [docs/CONTEXT.md](docs/CONTEXT.md), [apps/web/public/llms.txt](apps/web/public/llms.txt) (for agents), [docs/skills/wardline-payee-check](docs/skills/wardline-payee-check/SKILL.md).

## Disclosures

- No pre-hackathon code: the first commit is 2026-11-03.
- Most code was written with Claude Code, directed and reviewed by the team.
- Main libraries: `near-api-js`, `near-sdk` (Rust), `viem`, `@noble/curves`, `hono`, `better-sqlite3`, `zod`, `react`, `vite`, `@near-wallet-selector/*`, `@modelcontextprotocol/sdk`, `openai`, `vitest`, `@playwright/test`.
- External services: NEAR AI Cloud, Circle USDC on NEAR, NEAR RPC (FastNear, QuickNode optional), Sputnik DAO.
- The full list with licenses, and what else to know: [docs/DISCLOSURES.md](docs/DISCLOSURES.md). To report a vulnerability: [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
