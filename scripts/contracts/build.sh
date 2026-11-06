#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

cargo build --workspace --target wasm32-unknown-unknown --release --locked
mkdir -p contracts/res
cp target/wasm32-unknown-unknown/release/spend_gym_vault.wasm contracts/res/
cp target/wasm32-unknown-unknown/release/spend_gym_evidence.wasm contracts/res/
cp target/wasm32-unknown-unknown/release/spend_gym_mock_token.wasm contracts/res/
cp target/wasm32-unknown-unknown/release/spend_gym_test_proxy.wasm contracts/res/

sha256sum contracts/res/*.wasm
