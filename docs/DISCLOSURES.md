# Disclosures

What a judge or reviewer should know about where this code came from and what it depends on.

## Pre-hackathon code

None. The first commit in this repository is 2026-11-03 (`efc795d`), after the hackathon was announced on 2026-10-19. Everything here was written during the hackathon by the four team members. No earlier project, template or fork was reused.

## AI-generated code

Most of the code, tests and documentation in this repository were written with Claude Code (Anthropic), directed and reviewed by the team. Each team member worked with an AI coding assistant on their own area. Commits made with Claude Code carry a `Co-Authored-By: Claude` trailer.

The invoice agent under `services/agent` calls a language model at runtime through NEAR AI Cloud. The red-team benchmark used a language model to write the text of fictional scam emails and invoices; the cases, parameters and expected verdicts are set by code. Those model outputs are committed under `fixtures/redteam` and `fixtures/nearai` and replayed offline, so tests and the README walkthrough make no model calls.

## Other chains

All settlement, budgets, the cover pool and governance are on NEAR. The payee check also verifies payout accounts on EVM chains (Base Sepolia, `eip155:84532`) and Solana devnet, because vendors may be paid there, and the x402 guard checks x402 offers on Base Sepolia. No funds move on those chains in this repository.

## External services

| Service | What for | Needed for the README walkthrough |
| --- | --- | --- |
| NEAR AI Cloud (`cloud-api.near.ai`) | Model calls for the metered gateway and the invoice agent; `provider_tee` response signatures; model attestation reports | No. Real traffic was recorded once into `fixtures/nearai` (9 calls) and is replayed |
| Circle USDC on NEAR | The only money token. Testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, free from Circle's testnet faucet | No. Sim mode simulates balances |
| NEAR RPC (FastNear public RPC, QuickNode optional) | Reading accounts, keys and contract state on NEAR testnet | No |
| Sputnik DAO v2 (and Trezu, which uses it) | A group's shared AI budget, allowances, payouts and pool decisions are DAO proposals | No. Sim mode uses an in-memory Sputnik |
| NEAR wallets (Meteor, MyNearWallet), injected EIP-1193 wallets, Phantom | Signing in, approving, verifying a business, depositing into the pool | No. The end-to-end tests use scripted wallets |

## Third-party libraries

Direct dependencies of every `package.json` and `Cargo.toml` in the repository, with the license of the installed version. Transitive dependencies are in `pnpm-lock.yaml` and `contracts/Cargo.lock`. Regenerate this table with `node scripts/disclosures/generate.mjs`. Everything is MIT, Apache-2.0 or similar except two development-only tools under MPL-2.0 (`@axe-core/playwright` for accessibility tests, `@resvg/resvg-js` for rendering brand assets); neither ships in the app.

<!-- libraries:start -->

### npm (36 packages)

| Package | Version | License | Used as | Used by |
| --- | --- | --- | --- | --- |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | dev | @wardline/web |
| `@hono/node-server` | 2.1.6 | MIT | runtime | @wardline/api, @wardline/demo-provider, @wardline/web |
| `@hot-labs/near-connect` | 0.12.0 | MIT | runtime | @wardline/web |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT | runtime | @wardline/mcp |
| `@noble/curves` | 2.4.0 | MIT | runtime | @wardline/api, @wardline/sdk, @wardline/web, @wardline/x402-guard |
| `@noble/hashes` | 2.4.0 | MIT | runtime | @wardline/api, @wardline/sdk, @wardline/web, @wardline/x402-guard |
| `@playwright/test` | 1.65.0 | Apache-2.0 | dev | @wardline/web |
| `@resvg/resvg-js` | 2.6.2 | MPL-2.0 | dev | wardline |
| `@scure/base` | 2.4.0 | MIT | runtime | @wardline/api, @wardline/sdk, @wardline/web, @wardline/x402-guard |
| `@testing-library/react` | 16.3.3 | MIT | dev | @wardline/web |
| `@types/better-sqlite3` | 9.6.0 | MIT | dev | @wardline/api |
| `@types/node` | 26.6.6 | MIT | dev | @wardline/agent, @wardline/api, @wardline/contract-scripts, @wardline/dao-adapter, @wardline/demo-provider, @wardline/evaluator, @wardline/mcp, @wardline/payee-check, @wardline/redteam, @wardline/sandbox-tests, @wardline/schemas, @wardline/sdk, @wardline/vault-client, @wardline/vault-sim, @wardline/x402-guard |
| `@types/react` | 19.3.0 | MIT | dev | @wardline/web |
| `@types/react-dom` | 19.3.0 | MIT | dev | @wardline/web |
| `@vitejs/plugin-react` | 6.2.1 | MIT | dev | @wardline/web |
| `@x402/core` | 2.30.0 | Apache-2.0 | dev | @wardline/x402-guard |
| `@x402/fetch` | 2.30.0 | Apache-2.0 | dev | @wardline/x402-guard |
| `axe-core` | 4.14.0 | MPL-2.0 | dev | @wardline/web |
| `better-sqlite3` | 12.9.0 | MIT | runtime | @wardline/api |
| `canonicalize` | 5.1.0 | Apache-2.0 | runtime | @wardline/agent, @wardline/redteam, @wardline/sdk, @wardline/x402-guard |
| `concurrently` | 9.2.5 | MIT | dev | wardline |
| `fake-indexeddb` | 6.2.7 | Apache-2.0 | dev | @wardline/sdk |
| `hono` | 4.13.16 | MIT | runtime | @wardline/api |
| `jsdom` | 26.1.0 | MIT | dev | @wardline/web |
| `near-api-js` | 7.4.0 | (MIT AND Apache-2.0) | runtime | @wardline/api, @wardline/contract-scripts, @wardline/dao-adapter, @wardline/sandbox-tests, @wardline/vault-client |
| `near-sandbox` | 0.3.5 | MIT | runtime | @wardline/sandbox-tests |
| `openai` | 6.10.0 | Apache-2.0 | dev | @wardline/api, wardline |
| `png-to-ico` | 3.0.2 | MIT | dev | wardline |
| `react` | 19.3.1 | MIT | runtime | @wardline/web |
| `react-dom` | 19.3.1 | MIT | runtime | @wardline/web |
| `tsx` | 4.23.15 | MIT | dev | @wardline/agent, @wardline/api, @wardline/contract-scripts, @wardline/evaluator, @wardline/payee-check, @wardline/redteam, @wardline/web, wardline |
| `typescript` | 7.0.2 | Apache-2.0 | dev | @wardline/agent, @wardline/api, @wardline/contract-scripts, @wardline/dao-adapter, @wardline/demo-provider, @wardline/evaluator, @wardline/mcp, @wardline/payee-check, @wardline/redteam, @wardline/sandbox-tests, @wardline/schemas, @wardline/sdk, @wardline/vault-client, @wardline/vault-sim, @wardline/web, @wardline/x402-guard |
| `viem` | 2.57.16 | MIT | runtime | @wardline/api, @wardline/demo-provider, @wardline/sdk, @wardline/web |
| `vite` | 8.3.5 | MIT | dev | @wardline/web |
| `vitest` | 4.1.12 | MIT | dev | @wardline/agent, @wardline/api, @wardline/dao-adapter, @wardline/demo-provider, @wardline/evaluator, @wardline/mcp, @wardline/payee-check, @wardline/redteam, @wardline/sandbox-tests, @wardline/schemas, @wardline/sdk, @wardline/vault-client, @wardline/vault-sim, @wardline/web, @wardline/x402-guard |
| `zod` | 4.6.7 | MIT | runtime | @wardline/agent, @wardline/api, @wardline/evaluator, @wardline/mcp, @wardline/redteam, @wardline/schemas, @wardline/sdk, @wardline/vault-client, @wardline/web, @wardline/x402-guard, wardline |

### Rust crates (3 crates)

| Crate | Version | License | Used by |
| --- | --- | --- | --- |
| `hex` | 0.4.3 | MIT OR Apache-2.0 | wardline-meter |
| `near-contract-standards` | 5.30.1 | MIT OR Apache-2.0 | wardline-mock-token |
| `near-sdk` | 5.30.1 | MIT OR Apache-2.0 | wardline-cover-pool, wardline-evidence, wardline-meter, wardline-mock-token, wardline-model-registry, wardline-payee-registry, wardline-test-proxy, wardline-vault |

### Fonts and assets

| Asset | License |
| --- | --- |
| Geist 1.9.2 (Vercel), variable woff2 in apps/web/public/fonts and TTF in scripts/brand/fonts, license in OFL-Geist.txt | SIL Open Font License 1.1 |
| Azeret Mono (The Azeret Project Authors), variable woff2 in apps/web/public/fonts, used only for code; license in OFL-AzeretMono.txt | SIL Open Font License 1.1 |
| Wardline brand assets in apps/web/public (favicons, icons, social card, marks), generated by scripts/brand/generate-assets.ts | MIT, as the repository |

<!-- libraries:end -->
