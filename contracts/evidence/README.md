# Spend Gym evidence registry

Append-only NEAR registry for suite commitments, declared agent manifests, run registration, and terminal assessment results.

The issuer is explicit and the hackathon deployment is team-issued. The contract does not claim that the evaluator was honest, that a hidden suite remained secret, or that the declared release was the code that actually ran.

## Build

```bash
cargo build --target wasm32-unknown-unknown --release -p spend-gym-evidence
```
