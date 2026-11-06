# Spend Gym Test Dollar

Mock NEP-141 token for local sandbox and NEAR testnet only.

- Name: Spend Gym Test Dollar
- Symbol: sgUSD
- Decimals: 6
- Economic value: none

The entire initial supply is minted once to the initializer-supplied owner account. There is no post-initialization mint method.

## Build

```bash
cargo build --target wasm32-unknown-unknown --release -p spend-gym-mock-token
```
