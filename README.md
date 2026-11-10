# Wardline

Wardline is a credit union for the AI economy. Communities pool USDC on NEAR, earn yield by backing AI agents' payments, and vote together on the risks they take.

Back the AI economy and earn from it: Wardline lets communities pool money, cover each other's AI agents, and earn yield from every payment those agents make safely. It has three layers:

1. **The Mutual.** Anyone deposits USDC and gets WARD, their share of the pool. WARD holders earn 2% of every proven AI payment. If a Wardline approval was wrong, Wardline's own stake pays first, then WARD holders. WARD holders vote on payouts, fees and which models are covered.
2. **Groups.** A team, hacker house or DAO funds a shared AI budget from its own Sputnik DAO or Trezu treasury. Members get allowances. Groups with a clean record move up reputation tiers (Bronze, Silver, Gold) and pay lower fees (2%, 1.5%, 1%) for more coverage.
3. **The proof engine** (why the yield is safe). A call is paid only to the right party, for the model you actually got (NEAR AI TEE signatures), up to a hard cap. Agents plug in by changing one line, the OpenAI client's base URL.

## Hosted

Nothing is hosted right now: run Wardline on your own machine (below). The web app serves on `http://127.0.0.1:5173`, the API on `http://127.0.0.1:8787` and MCP (streamable HTTP) on `http://127.0.0.1:8790/mcp`.

- NEAR testnet deployment: `scripts/contracts/deployments/testnet-wardline.json`, contracts under `wardline-labs.testnet`, Circle testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`

Hosted links live in `repo.config.json` (`hosted`), empty while nothing is hosted; `pnpm test` fails if this file, `llms.txt`, `SKILL.md` or `services/mcp/server.json` disagree with it.

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

See: `Demo meter key for alice.testnet (bgt_aurora, sim) is set from WARDLINE_DEMO_METER_KEY`, `Wardline API on http://127.0.0.1:8787 (payee engine stub, registry memory, chain sim)` and `AI gateway at /v1/ai`. The first start also prints `Generated a development attestor key in .env.`: the key that signs payee receipts, written into a new, gitignored `.env`.

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

Wardline reserved the most the call could cost, sent the request bytes unchanged, fetched NEAR AI's `provider_tee` signature over `<model>:<sha256 request>:<sha256 response>`, checked the signer is attested for that model, then paid and refunded the rest. Run it again and it prints `Refused:        HTTP 502, REPLAYED. Response chatcmpl-... was already paid for. You were not charged.`: the same signed response is never paid twice. Restart the API to run it once more.

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

### 7. Join the Mutual, then watch a payout

Do:

```sh
pnpm demo:mutual
```

See:

```
Mutual: 141.24 USDC pooled, 4 groups covered, 655 proven AI payments, 1.24 USDC earned by WARD holders
Deposit: maya.testnet puts in 25.00 USDC and receives 24.74 WARD at 1.0103
Pool: Wardline's first-loss stake 20.00 USDC, behind WARD 120.00 USDC, WARD price 1.0000
Payout 1: 8.00 USDC paid. From Wardline's stake 8.00, from WARD holders 0.00. Stake left 12.00. WARD 1.0000 to 1.0000
Payout 2: 12.50 USDC paid. From Wardline's stake 12.00, from WARD holders 0.50. Stake left 0.00. WARD 1.0000 to 0.9958
Refill: 78 proven calls (39.00 USDC) paid 0.5025 USDC in fees. WARD 0.9958 to 1.0000
```

Anyone can deposit; no group membership is needed. Wardline's own stake pays a wrong approval first, so WARD does not move. A bigger payout uses up the stake, WARD holders cover the rest and WARD dips, then fees from proven calls refill it.

### 8. Vote with WARD

Do:

```sh
pnpm demo:vote
```

See:

```
WARD holders: lp-north.testnet 70.00 WARD, lp-harbor.testnet 50.00 WARD
Proposal 0: "Lower the Silver fee to 1.25%". Snapshot 120.00 WARD, quorum 24.00 WARD, closes ...
late.testnet votes: refused. late.testnet held no WARD when this proposal opened, so it has no vote on it.
lp-harbor.testnet votes for with 50.00 WARD: open
lp-north.testnet votes for: 120.00 of 120.00 WARD for, passed
Executed by anyone: executed (sim-execute-...)
Execute again: refused. This proposal was already executed.
Silver fee is now 1.25%
```

Votes are weighted by WARD at the proposal's snapshot, so WARD deposited or moved later cannot vote twice. A proposal passes with quorum (20% of the snapshot) and more for than against when its 3-day window closes, or early once more than half of all WARD votes for it. Anyone can execute it, once.

### 9. Watch a clean group move up a tier

Do:

```sh
pnpm demo:tier
```

See:

```
Aurora Lab shared AI budget: bronze, 0 proven calls, 0 claims, fee 2.00%, coverage 25.00 USDC
After 11 proven calls: silver, 11 proven calls, 0 claims, fee 1.50%, coverage 50.00 USDC
Fee on call 1: 0.0100 USDC. Fee on call 11: 0.0075 USDC
```

Ten clean proven calls in a row move a group from Bronze to Silver; 25 more reach Gold. A paid claim moves it down one tier. The same numbers come from `GET /v1/reputation/bgt_aurora` on the API from step 2.

### 10. See the scam-test numbers

Do:

```sh
pnpm redteam:numbers
```

See:

```
Engine: stub
Attacks stopped: 100% of 159 written and 48 model-invented scam payees
Unsafe payments: 0
False positives: 0% of 40 legitimate invoices
...
AI agent (z-ai/glm-5.3-flash, first payment to a vendor): alone 5 of 20 scams paid, with Wardline 0
```

Read from the committed report in `evidence/redteam/report.json`. Details in [docs/REDTEAM.md](docs/REDTEAM.md).

### 11. Run the tests

Do:

```sh
pnpm test
pnpm --filter @wardline/web exec playwright install chromium firefox webkit
pnpm test:e2e
```

See: the brand guard (7 checks) and every package's tests pass, then the Playwright suite passes in Chromium, Firefox and WebKit (49 tests in each): the Mutual home, #/me, Join the Mutual, WARD voting, Groups, all seven demo scenes, the error states, a keyboard-only walk, and axe accessibility checks at desktop and 390px. `pnpm --filter @wardline/web test:e2e:chromium` runs Chromium only. The contracts have their own Rust tests: `cd contracts && cargo test --workspace` (needs Rust; Linux, macOS or WSL).

### The web app

Do, with the API from step 2 still running:

```sh
WARDLINE_DEV_API=http://127.0.0.1:$WARDLINE_API_PORT pnpm --filter @wardline/web dev
```

See: open the Local URL Vite prints (http://127.0.0.1:5173 unless that port is taken). The site opens on the Mutual, in the Horizon design (a dark page, a halftone sphere cut by one line): the hero, pooled USDC and WARD's price, the two sides of the line (paid above it; refused, blocked or capped below it), Hold a share, WARD-holder votes and the safest groups. Connect wallet sits in the header, and once connected your account opens #/me with your share, your votes and your redemptions. Groups, Proof engine and the seven-scene Demo are in the nav.

## Live variants

Everything above runs offline. Each live variant needs its own environment variables:

| Variant | Set | Notes |
| --- | --- | --- |
| Live NEAR AI Cloud | `NEAR_AI_API_KEY`, and leave `WARDLINE_AI_PROVIDER_URL` unset | The gateway calls `cloud-api.near.ai` and verifies live `provider_tee` signatures |
| Read the testnet deployment | nothing | `pnpm testnet:check` makes view calls only: pool, budgets, attested models, WARD balances |
| NEAR testnet | `WARDLINE_CHAIN_MODE=near`, `WARDLINE_GATEWAY_ACCOUNT`, `WARDLINE_GATEWAY_KEY` (a function-call key for `reserve`, `settle`, `release` on the meter), `WARDLINE_PROVIDER_PAY_TO` | Contract ids come from `repo.config.json`; override with `WARDLINE_METER_CONTRACT`, `WARDLINE_MODEL_REGISTRY_CONTRACT`, `WARDLINE_COVER_POOL_CONTRACT`. `WARDLINE_PROVIDER_PAY_TO` receives the provider's share of each settled call, so the fee moves to the pool as USDC. `WARDLINE_DEMO_METER_KEY` is refused in this mode |
| Payee registry on testnet | `WARDLINE_REGISTRY_MODE=near` | `/v1/check` and `/v1/resolve` read `payee-registry.wardline-labs.testnet`. `WARDLINE_REGISTRY_MODE=near pnpm payee:seed` attests the seeded vendors as the attestor |
| Testnet data in the web app | `WARDLINE_DATA=testnet` (web), with the API in near mode | Home, Groups, Latest proofs and #/me read `/v1/activity`, `/v1/activity/stats`, `/v1/communities` and `/v1/people`. The footer says NEAR testnet. Off unless set; a failing route shows an error, never sim numbers |
| Local test signer | `WARDLINE_LOCAL_SIGNER=1` (API) and `VITE_WARDLINE_LOCAL_SIGNER=1` (web dev server) | The browser acts as a testnet cast account from your credential store: Join, vote, execute, redeem. Both refuse to start unless bound to 127.0.0.1 and on testnet, and a production build refuses it |
| Several RPC endpoints | `WARDLINE_NEAR_RPC_URL=url1,url2,...` | Each request fails over to the next on an error or a rate limit |
| A DEX for WARD | `WARDLINE_WARD_TRADE_URL` | Shows "Trade WARD" next to the price |

## Run it on testnet

Needs the keys in `%USERPROFILE%.wardline	estnetcredentials.json` (or `~/.wardline/testnet`) and the gateway key and `NEAR_AI_API_KEY` in `.env`. `pnpm testnet:preflight` checks every key against the chain and prints public keys only. In PowerShell:

```powershell
# 1. The API in near mode, with the local test signer (127.0.0.1 only)
$env:WARDLINE_CHAIN_MODE="near"; $env:WARDLINE_REGISTRY_MODE="near"; $env:WARDLINE_LOCAL_SIGNER="1"; $env:WARDLINE_OWNER_AUTH="off"
$env:WARDLINE_NEAR_RPC_URL="https://near-testnet.drpc.org,https://rpc.testnet.fastnear.com,https://test.rpc.fastnear.com"
pnpm --filter @wardline/api build; pnpm --filter @wardline/api start

# 2. In a second window: the web app on testnet data, with the local test signer
$env:WARDLINE_DATA="testnet"; $env:VITE_WARDLINE_LOCAL_SIGNER="1"; $env:WARDLINE_DEV_API="http://127.0.0.1:8787"
pnpm --filter @wardline/web dev
```

Open http://127.0.0.1:5173. To act as a cast account, choose Connect wallet, then **Local test signer (testnet, this machine only)**, and pick an account such as `dana.wardline-labs.testnet`. Every action it takes is a real testnet transaction, signed with that account's key from your credential store; the header marks it as the local test signer.

The activity behind the pages:

```powershell
pnpm testnet:setup      # creates and funds the cast (safe to run again; --dry-run sends nothing)
pnpm testnet:batch      # live NEAR AI calls through the gateway, refusals, deposits, a WARD vote (--dry-run, --calls N)
pnpm testnet:audit      # checks every row against testnet RPC; the API serves only audited rows
pnpm --filter @wardline/web test:e2e:testnet   # drives every function in Chromium against the running stack
```

## Testnet communities

The Mission Street hacker house, Nightshade DAO, Hayes Valley house, Aurora Lab and Kelp Collective are fictional communities run by the Wardline team on NEAR testnet, with five solo builders and three liquidity providers. Their activity is scripted (`scripts/testnet`), but every part of it is real:

- Every AI call is a live NEAR AI call (DeepSeek V4.1 Flash), proven by its TEE signature and settled on the meter, with its fee paid to the pool in Circle testnet USDC.
- Refusals are real too: a swapped model is reserved, fails the proof against the recorded GLM-5.3 Flash answer and is released; a leaked key is stopped at its allowance.
- Mission Street funds its budget from its own Sputnik DAO by council proposal and vote. The other four fund theirs from a treasury account.
- Every number on the site comes from a contract view, and every row links to its transaction on testnet.nearblocks.io. `data/testnet/activity.jsonl` holds the rows; `pnpm testnet:audit` re-checks each one (hash, signer, contract method and result, block) and the API serves only rows that passed.

Numbers at the last audit (Nov 10, 15:30 UTC; `pnpm testnet:audit` re-derives them from the chain):

| | |
|---|---|
| Rows in the log, all matched to a transaction | 161 of 161, 0 misses |
| Live NEAR AI calls (DeepSeek V4.1 Flash, max 150 tokens) | 108 proven and settled, plus one plug-in check; $0.0196 in NEAR AI credit |
| Swapped-model answers refused (`MODEL_MISMATCH`) | 4 |
| Leaked-key reserves capped (`ALLOWANCE_EXHAUSTED`) | 10 |
| Pool | 2.03 USDC; 0.000258 USDC of fees earned; WARD at 1.000368 |
| Tiers | Mission Street Gold; Nightshade and Hayes Valley Silver; Aurora Lab Bronze after a claim; Kelp Bronze |
| Claims | One, 0.02 USDC for Aurora Lab, paid from Wardline's first-loss stake (WARD unchanged) |

A scheduled task adds a small batch every 6 hours until Nov 13, 20:00 UTC, each followed by the audit, so these numbers grow.

## How it works

```mermaid
flowchart LR
    LP[Anyone: USDC] -->|deposit| M[(Wardline Mutual<br/>our stake + WARD)]
    DAO[Group DAO treasury<br/>Sputnik or Trezu] -->|fund by vote| B[(Group budget<br/>meter)]
    A[Member's agent<br/>OpenAI client] -->|one line: baseURL| G[Wardline gateway]
    G -->|reserve| B
    G -->|request bytes| N[NEAR AI Cloud TEE]
    N -->|response + signature| G
    G -->|signer attested for this model?| R[(Model registry)]
    G -->|proven: settle| B
    B -->|fee by tier: 2%, 1.5%, 1%| M
    B -->|clean record| T[Reputation tier]
    W[WARD holders] -->|vote: fees, coverage, models, payouts| M
    M -->|wrong approval: our stake first, then WARD| DAO
```

## What is on-chain vs. off-chain

| Piece | Where | Notes |
| --- | --- | --- |
| Group budgets, allowances, reserve, settle, release | NEAR contract `contracts/meter` | `meter.wardline-labs.testnet`, moves Circle testnet USDC |
| Which TEE signer is attested for which model | NEAR contract `contracts/model-registry` | `model-registry.wardline-labs.testnet` |
| The Mutual: first-loss stake, WARD (NEP-141), claims, 7-day redemption | NEAR contract `contracts/cover-pool` | `pool.wardline-labs.testnet` |
| Group governance | Sputnik DAO v2 | `packages/dao-adapter` builds and reads the proposals. On testnet, `mission-dao.wardline-labs.testnet` funds its budget by council vote |
| Reputation tiers | NEAR contract `contracts/meter` | `get_reputation`, `list_reputations`: proven and refused calls, tier, fee, coverage. Calls capped at an allowance leave no state, so their count comes from the audited activity log, one refused reserve transaction each |
| WARD-holder voting | NEAR contract `contracts/cover-pool` | `propose`, `vote`, `execute`, signed by each holder's own wallet. Sim mode keeps the simulation in `services/api/src/chain/sim-mutual.ts` |
| Payee registry and per-business vaults | NEAR contracts `contracts/payee-registry`, `contracts/vault` | For invoice payments |
| Gateway, payee check, receipts, site | Off chain: `services/api`, `apps/web` | |
| Model inference and response signatures | NEAR AI Cloud | |

### Honest limits

- Testnet only. Mainnet USDC is a configuration value and has never been used.
- The Mutual is protocol-backed coverage on testnet, not insurance. WARD is yield-bearing and loss-sharing; its price can fall.
- In sim mode, reputation tiers and WARD voting are simulated; the live sim starts with three groups that have a history, and two LPs. In near mode both read the contracts.
- On the testnet contracts: executing a WARD proposal records the decision as an event but does not yet change the meter's fees or coverage; a vote weighs the voter's WARD when they vote, not at the proposal's snapshot; redemptions unlock after the pool's `withdraw_delay_days`, currently 0 on testnet (7 in the contract's default); and `file_claim`, `deposit`, `request_withdraw` (cover pool) and `fund` (meter) do not check their caller. The scripts and the site never use the unchecked paths.
- Token counts are not signed. A TEE signature shows which attested model signed the exact response bytes; the charge uses the provider's reported usage, capped at the reservation.
- The attestor is trusted. Signers enter the registry from NEAR AI attestation reports; checking the TDX and GPU quotes inside them is not done independently here.
- `provider_tee` signatures exist only for models NEAR AI serves itself. Gateway signatures are refused as proof of the model. Streaming responses are refused for now.
- The payee check verifies control of an account and its link to a domain, at a stated trust level. It does not establish who legally owns a business.
- Nothing is hosted right now; everything above runs locally.
- This was built during the NEAR hackathon. More in [docs/LIMITATIONS.md](docs/LIMITATIONS.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Tracks

| Track | Why |
| --- | --- |
| `social` Social Money (lead) | Shared AI budgets funded from a group's own Sputnik or Trezu treasury, programmable rewards (2% of every proven payment to WARD holders), collective ownership of the Mutual through WARD, and reputation-based access: clean groups pay less and get more coverage |
| `privacy` Privacy & Private AI | Pays only for responses signed inside NEAR AI's TEEs, re-verifying each signature against attested signers before money moves |
| `business` Autonomous Business | Agents get metered budgets, allowances and a payee check, so they pay for models and vendors without a human on every call |
| `realworld` Real-World Money | Circle USDC for deposits, model spend and invoice payments; vendors verify their payout accounts on their own domain |
| `security` AI Security & Defense | Hard caps, refusal of swapped models and replays, look-alike detection before a DAO votes, and a red-team benchmark |

## Repository

| Path | What |
| --- | --- |
| `services/api` | Gateway (`/v1/ai`), the Mutual (`/v1/mutual`, `/v1/pool`, `/v1/mutual/proposals`), groups and tiers (`/v1/groups`, `/v1/reputation/:budget`), payee check (`/v1/check`, `/v1/resolve`), demo scenes |
| `apps/web` | The Mutual home, Groups, Proof engine, Demo, Connect and the owner app |
| `packages/sdk` | `@wardline/sdk`: `openai()`, `getCall`, `verifyProof`, payee checks |
| `packages/dao-adapter` | Sputnik DAO v2 proposals for group budgets, allowances, providers, payout changes and claims |
| `services/mcp` | MCP server for agents |
| `services/demo-provider` | Offline upstreams: recorded NEAR AI traffic, `cheapai`, a local test TEE |
| `packages/x402-guard` | Checks each x402 offer's `payTo` before paying |
| `contracts` | NEAR contracts: meter, model registry, cover pool, payee registry, vault |
| `fixtures/nearai` | Real NEAR AI requests, responses, signatures and attestation reports, recorded once |
| `services/redteam`, `evidence/redteam` | Red-team benchmark and its committed results |

Docs: [docs/DAO.md](docs/DAO.md) (governance), [docs/PAYEE_SHIELD.md](docs/PAYEE_SHIELD.md) (payee check), [docs/REDTEAM.md](docs/REDTEAM.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/LIMITATIONS.md](docs/LIMITATIONS.md), [apps/web/public/llms.txt](apps/web/public/llms.txt) (for agents), [docs/skills/wardline-payee-check](docs/skills/wardline-payee-check/SKILL.md).

## Disclosures

- No pre-hackathon code: the first commit is 2026-11-03.
- Most code was written with Claude Code, directed and reviewed by the team.
- Main libraries: `near-api-js`, `near-sdk` (Rust), `viem`, `@noble/curves`, `hono`, `better-sqlite3`, `zod`, `react`, `vite`, `@near-wallet-selector/*`, `@modelcontextprotocol/sdk`, `openai`, `vitest`, `@playwright/test`; for brand assets `@resvg/resvg-js` (MPL-2.0, dev only) and `png-to-ico`. Font: Geist (SIL OFL 1.1), self-hosted.
- External services: NEAR AI Cloud, Circle USDC on NEAR, NEAR RPC (FastNear, QuickNode optional), Sputnik DAO.
- The full list with licenses: [docs/DISCLOSURES.md](docs/DISCLOSURES.md). To report a vulnerability: [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
