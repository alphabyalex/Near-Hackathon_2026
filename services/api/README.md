# services/api

Owner: Alexander

Backend API, persistence, chain observer (Hono + better-sqlite3 + zod). Runs on http://127.0.0.1:8787.

All gateways are mocks for now. To swap one for the real implementation, change its line in `src/gateways/index.ts`.

While the gateways are mocks, state is reseeded on every start, so a restart also clears a paused vault.

The API binds to 127.0.0.1. `REDLINE_BIND_PUBLIC=true` binds the main port to all interfaces.

## Public routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /overview | Agent version, policy, usage, headroom, unresolved payments |
| GET | /evaluations | Evaluation runs |
| GET | /evaluations/:id | Report plus evidence check |

## Owner routes

Everything that changes vault or review state, plus the private dashboard reads, is a separate app in `src/owner-app.ts`. It is mounted at `/owner`, or served on its own port with `REDLINE_OWNER_PORT`, which binds to localhost unless `REDLINE_OWNER_BIND_PUBLIC=true`.

Every owner route needs a session. To get one:

1. `POST /owner/auth/challenge { account }` returns a message, a nonce and the recipient `redline-owner-login`. It expires in 5 minutes.
2. The account signs it with NEP-413 (wallet `signMessage`).
3. `POST /owner/auth/login { account, publicKey, signature, nonce }` checks the signature, that the key is a current full-access key, and that the account is in `REDLINE_OWNER_ACCOUNTS` or `REDLINE_APPROVER_ACCOUNTS`. It returns a token and sets an HttpOnly, SameSite=Strict cookie. Each challenge works once, even when the attempt fails.
4. Send the cookie or `Authorization: Bearer rs_...`. `POST /owner/auth/logout` ends the session.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | /owner/invoices, /owner/invoices/:id | owner, approver | Invoices |
| GET | /owner/review-queue | owner, approver | Open review items, soonest due first |
| GET | /owner/history | owner, approver | Vendors, policy changes, agent events, incidents |
| POST | /owner/intake | owner, approver | Submit invoice text and run the full flow |
| POST | /owner/review/:id/owner-pay | owner, approver | Pay the item's approved payable |
| POST | /owner/review/:id/reject | owner, approver | Close the item with no payment |
| POST | /owner/vault/pause | owner, approver | Pause agent payments |
| POST | /owner/vault/unpause | owner | Resume agent payments |
| GET, POST | /owner/agent/simulation | owner (POST) | Simulated compromised agent |
| GET, POST | /owner/api-keys | owner | List or create payer API keys |
| POST | /owner/api-keys/:id/revoke | owner | Revoke a key |
| POST | /owner/payees/approve | owner, approver | Approve an active account for a payer, which raises it to T3 |

`REDLINE_OWNER_AUTH=off` makes every caller a local owner, for the dashboard on your own machine, which has no sign-in screen yet. The API refuses to start that way when owner routes are reachable from outside.

## Payee API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /v1/check | `PayeeCheckRequest` to `PayeeCheckResult`, with a signed receipt |
| POST | /v1/resolve | `PayeeResolveRequest` to `PayeeResolveResult`, with a signed receipt |
| POST | /v1/payments/record | `{ payer, domain, account }`. Feeds `PAYEE_CHANGED` |
| GET | /v1/vendors | All vendors |
| GET | /v1/vendors/:domain | One vendor |
| POST | /v1/vendors/verify | `{ domain }`. Fetches and verifies the vendor's proof file, then attests it |
| GET | /.well-known/redline-attestor.json | The public key receipts verify against |

API keys (`Authorization: Bearer rk_...`) belong to one payer and have their own daily limit, 10,000 by default. Passing `payer` to `/v1/check` or `/v1/resolve` needs that payer's key. `/v1/payments/record` needs a key with the `record` scope, or a NEP-413 signature by the payer's NEAR account over `redline-payment-record:v1:<timestamp>:<canonical body>` with recipient `redline-payment-record`, sent as `x-redline-public-key`, `x-redline-signature`, `x-redline-nonce` and `x-redline-timestamp`. Signatures are good for 5 minutes and once.

Calls without a key allow 200 per day per IP. Past that it answers 402 with x402 payment requirements. `REDLINE_TRUST_PROXY=1` takes the IP from `X-Forwarded-For`; leave it off unless a proxy sets that header.

`REDLINE_PAYEE_ENGINE` is `stub` or `live`, and `REDLINE_REGISTRY_MODE` is `memory` or `near`. A mode that cannot be met stops the API at startup, rather than falling back to stub verdicts. Backends are chosen in `src/payee/runtime.ts`. The interfaces are in `@redline/sdk`.

Receipts are signed by `REDLINE_ATTESTOR_KEY`, a 32-byte ed25519 seed in hex. Outside production, a missing key is generated into the gitignored `.env`. In production it is required.

`better-sqlite3` is pinned to exactly 12.9.0. It is the newest npm release with prebuilt binaries for Node 20, 22, and 24. Later 12.x releases dropped Node 20 binaries, so installing them on Node 20 needs a C++ compiler.
