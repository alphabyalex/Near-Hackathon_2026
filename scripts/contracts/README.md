# Spend Gym contract operations

These commands are restricted to local NEAR sandbox and NEAR testnet. They reject every other `NEAR_NETWORK` value and reject RPC URLs containing `mainnet`.

## Build

```bash
pnpm contracts:build
```

The build uses Rust 1.95.0, near-sdk 5.30.0, and `wasm32-unknown-unknown`. It writes four ignored Wasm files under `contracts/res`: the vault, evidence registry, mock token, and sandbox-only proxy.

## Testnet deployment and seed

Copy `scripts/contracts/.env.example` into a secure local environment. Never commit the populated values. The owner private key must control `SPENDGYM_OWNER_ACCOUNT_ID`. Agent A and B private keys become restricted function-call keys and are never written to the deployment manifest.

```bash
pnpm typecheck
pnpm contracts:build
pnpm --filter @spendgym/contracts-scripts deploy:testnet
```

The script creates token, evidence, two vault, two agent, and two synthetic vendor subaccounts under the owner. Each account is created with a temporary bootstrap key. The script installs exactly one function-call key restricted to `request_payment` on each agent's own vault, then deletes the agent bootstrap full-access key. After deployment and seeding, it also deletes the bootstrap keys from the token, evidence, vault, and synthetic vendor accounts and verifies that no keys remain on those accounts. It seeds different vendor caps, routine and adversarial payables, funds both vaults with mock sgUSD, and writes only public data to `scripts/contracts/deployments/testnet.json`.

The script intentionally fails when an account already exists. Use a new `SPENDGYM_DEPLOYMENT_PREFIX` for a new reproducible deployment rather than mutating unknown state.

## Prove key permissions

```bash
pnpm --filter @spendgym/contracts-scripts inspect:keys
```

The command reads live access keys for both agent accounts. It fails unless each agent has exactly one key, no full-access key, the expected vault receiver, only `request_payment` in its method list, and a finite positive allowance. The deployment itself also verifies that the token, evidence, vault, and synthetic vendor accounts have no remaining access keys.

## Bypass the AI with the real restricted key

```bash
pnpm --filter @spendgym/contracts-scripts attack:restricted-key
```

The command uses Agent A's restricted key directly and attempts unknown, over-cap, early, replayed, cross-tenant, and owner-only actions. Contract-level policy failures print structured vault responses. Protocol-level access-key failures print transaction rejections. The script never treats a rejected transaction as a successful payment.

## Safety

- Use only sgUSD, which has no economic value.
- Use only sandbox or testnet.
- Never store a private key, seed phrase, credential file, real invoice, or real vendor payment data in Git.
- A timeout or transport error is observation ambiguity. Reconcile on-chain state before considering another request.
