#!/usr/bin/env bash
# Builds every contract to contracts/out/<name>.wasm using the pinned toolchain in
# contracts/rust-toolchain.toml. Needs Linux, macOS or WSL, plus cargo-near (see contracts/vault/README.md).
set -euo pipefail

cd "$(dirname "$0")/../../contracts"
mkdir -p out

for crate in vault evidence mock-token test-proxy; do
  (cd "$crate" && cargo near build non-reproducible-wasm --no-abi --locked)
  name="redline_$(echo "$crate" | tr '-' '_')"
  cp "${CARGO_TARGET_DIR:-target}/near/$name/$name.wasm" "out/$crate.wasm" 2>/dev/null \
    || cp "${CARGO_TARGET_DIR:-target}/near/$name.wasm" "out/$crate.wasm"
done

ls -l out/*.wasm
sha256sum out/*.wasm
