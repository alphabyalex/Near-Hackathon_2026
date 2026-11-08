# Wardline

Wardline checks who an AI agent is about to pay. Vendors link their payout accounts on NEAR, EVM chains or Solana to their website domain. Wardline verifies control of each account and its link to the domain, and reports the trust level. Agents resolve a domain to its linked account, or check a raw address before paying. Read [docs/PAYEE_SHIELD.md](docs/PAYEE_SHIELD.md).

## Try it

Needs Node 20.19 or later and pnpm 12. Run these from the repo root. No keys or accounts are needed. Commands are for a POSIX shell.

### 1. Build

Run:

```sh
pnpm install
pnpm build
```

See: both commands exit 0.

### 2. Start the API in stub mode

Run this in its own terminal and leave it running:

```sh
WARDLINE_PAYEE_ENGINE=stub WARDLINE_REGISTRY_MODE=memory pnpm --filter @wardline/api start
```

See: `Wardline API on http://127.0.0.1:8787 (payee engine stub, registry memory)` and `Owner routes at /owner`. The first run also writes a development signing key to the gitignored `.env`.

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

### 6. Run the tests

Run:

```sh
pnpm test
```

See: every package passes and the command exits 0. This does not need the API to be running.

Red-team benchmark, offline from committed fixtures: run `pnpm --filter @wardline/redteam bench`, see the catch rates in docs/REDTEAM.md.

## Where things are

| Path | What it is |
| --- | --- |
| `services/api` | API: `/v1/check`, `/v1/resolve`, vendors, receipts |
| `packages/sdk` | `@wardline/sdk`, hosted and direct modes |
| `packages/x402-guard` | `@wardline/x402-guard`, checks each x402 offer before paying |
| `services/mcp` | `@wardline/mcp`, MCP server for agents |
| `apps/web/public/llms.txt` | Onboarding for agents |
| `docs/skills/wardline-payee-check` | The same as an agent skill |
| `contracts`, `packages/vault-client`, `packages/vault-sim` | NEAR contracts and clients |
| `services/agent`, `services/evaluator` | Invoice agent and the Gym |
