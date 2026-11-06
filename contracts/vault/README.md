# contracts/vault

Owner: Tharun

Redline's payment vault, one contract per business. It only pays approved bills to approved vendors within hard limits, and those limits hold even if the agent is fully compromised.

**The spec is [docs/VAULT_RULES.md](../../docs/VAULT_RULES.md).** Read that first: every rule, method, caller check, status change and rejection code is there. This file only covers building and code layout.

## Pinned versions

| Tool | Version | Where it is pinned |
| --- | --- | --- |
| Rust | 1.95.0 | [contracts/rust-toolchain.toml](../rust-toolchain.toml) |
| near-sdk, near-contract-standards | 5.30.1 | [contracts/Cargo.toml](../Cargo.toml), with [Cargo.lock](../Cargo.lock) committed |
| cargo-near | 0.22.0 | Install from the release below |
| near-sandbox | 0.3.5 npm package, node 2.14.0 | [tests/sandbox/package.json](../../tests/sandbox/package.json) |

## Build and test

Needs Linux, macOS or WSL. `near-sandbox` has no Windows build, and a OneDrive folder makes cargo very slow, so on Windows clone the repo inside WSL.

```bash
rustup target add wasm32-unknown-unknown --toolchain 1.95.0

# cargo-near: use the verified release. `cargo install cargo-near` needs a large C++ toolchain build.
curl -fsSLO https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz
curl -fsSLO https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz.sha256
sha256sum -c cargo-near-x86_64-unknown-linux-gnu.tar.gz.sha256
tar -xzf cargo-near-x86_64-unknown-linux-gnu.tar.gz
install -m755 "$(find . -type f -name cargo-near)" ~/.cargo/bin/cargo-near

# Unit tests, including exact time edges and replayed callbacks
cd contracts && cargo test --workspace

# Wasm for everything: writes contracts/out/*.wasm
bash scripts/contracts/build.sh

# Real chain tests: see tests/sandbox
pnpm --filter @redline/sandbox-tests test:sandbox
```

Use `cargo near build`, not plain `cargo build`: it runs `wasm-opt` with the features the NEAR runtime expects.

## Code layout

| File | Contents |
| --- | --- |
| [src/lib.rs](src/lib.rs) | State and every method. `decide_request` and `decide_owner_pay` are read-only and hold the checks in spec order. |
| [src/types.rs](src/types.rs) | Stored records, inputs and JSON views, named to match `packages/schemas`. |
| [src/events.rs](src/events.rs) | NEP-297 events, standard `redline`. |
| [src/tests.rs](src/tests.rs) | Unit tests for what a sandbox cannot do exactly. |

## Changing a rule

1. Change [docs/VAULT_RULES.md](../../docs/VAULT_RULES.md).
2. Change `src/lib.rs` and [packages/vault-sim/src/vault-sim.ts](../../packages/vault-sim/src/vault-sim.ts) together.
3. Run the parity suite. It fails if the two disagree.
4. A deployed vault has no keys and cannot be upgraded, so rerun the deploy with a new root account.

## Other contracts in this workspace

- [contracts/evidence](../evidence): the evidence registry.
- `contracts/mock-token`: Spend Gym Test Dollar (sgUSD, 6 decimals), a NEP-141 test token with no value, built on `near-contract-standards`. Its only addition is an owner-only `mint`.
- `contracts/test-proxy`: test only, and never deployed to testnet. A call forwarder and a scriptable fake token that can hold a transfer open, fail it, or return an unexpected value.
