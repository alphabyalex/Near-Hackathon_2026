# Deployment manifests

`testnet.json` is written by `deploy-and-seed`. It holds only public facts: accounts, code hashes, key permissions, seeded vendors and payables, and the sha256 of each wasm. Private keys never go here: they stay in `~/.wardline/<network>/`.

Check it against the chain with `pnpm --filter @wardline/contract-scripts inspect-keys`.
