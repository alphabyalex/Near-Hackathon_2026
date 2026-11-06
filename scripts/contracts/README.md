# scripts/contracts

Owner: Tharun

Build, deploy, attack and inspect. NEAR testnet and local sandbox only: mainnet is refused in code. Needs Linux, macOS or WSL for the build, and `pnpm install` once.

**A deployment already exists:** see [deployments/testnet.json](deployments/testnet.json), and the real output of [inspect-keys](deployments/testnet-inspect-keys.txt) and [malicious-signer](deployments/testnet-malicious-signer.txt).

## Build

```bash
bash scripts/contracts/build.sh   # writes contracts/out/*.wasm
```

## Deploy and seed

```bash
REDLINE_ROOT_ACCOUNT=<new-name>.testnet pnpm --filter @redline/contract-scripts deploy-and-seed
```

If the root account does not exist it is created from the public testnet faucet. To use one you already hold, also set `REDLINE_ROOT_KEY=ed25519:...`. The root needs about 12 NEAR.

What it does:
- Deploys REDL, the evidence registry and two vaults (Business A and Business B), all under the root.
- Creates `agent.vault-a.<root>` and `agent.vault-b.<root>`, each holding exactly one function-call key, restricted to `request_payment` on its own vault. They never had a full-access key.
- Seeds vendors with different per-vendor caps, POs and payables with due dates. Funds both vaults.
- Removes every key from the vaults, the token and the registry, so only their code can act. This is one way: a change after that means a new root.
- Writes the public manifest to [deployments/testnet.json](deployments/) with accounts, code hashes and key permissions.

It is safe to rerun: it skips what already exists. Rerun with `REDLINE_MANIFEST_DIGEST=sha256:...` and `REDLINE_ASSESSMENT_REF=<run_id>` to enroll the frozen agent version.

**Keys stay out of the repo.** They are written to `~/.redline/testnet/` with owner-only permissions:
- `credentials.json`: all generated keys.
- `signers.json`: the file `@redline/vault-client` reads through `REDLINE_VAULT_SIGNERS_FILE`.

## Attack it

```bash
pnpm --filter @redline/contract-scripts malicious-signer
```

Uses the agent's own restricted key and no AI at all. It tries unknown payables, replays, over-cap amounts, early payment, the other tenant's vault, owner methods, and more, and prints each attempt and the vault's answer. `--json` adds a machine-readable report.

The output separates two different defenses:
- `REJECTED BY VAULT <code>`: the contract ran its rules and returned a `VaultRejection`.
- `KEY NOT PERMITTED <reason>`: NEAR refused the transaction before any contract code ran.

It also pays one approved 1 REDL bill, because it can. The key can pay anything the owner approved, inside the limits. That is the boundary, and the script says so.

## Inspect keys

```bash
pnpm --filter @redline/contract-scripts inspect-keys
```

Reads live key lists from the chain, not the manifest, and exits non-zero if any agent, vault, guardian or contract account has a key it should not have.

## Trying it locally

These scripts also run on a sandbox: set `NEAR_NETWORK=sandbox` and `NEAR_RPC_URL`. `tests/sandbox/test/scripts.test.ts` does that end to end.
