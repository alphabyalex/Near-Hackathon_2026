#!/usr/bin/env bash
# Builds every contract to contracts/out/<name>.wasm using the pinned toolchain in
# contracts/rust-toolchain.toml. Needs Linux, macOS or WSL.
set -euo pipefail

cd "$(dirname "$0")/../../contracts"
mkdir -p out

target_dir="${CARGO_TARGET_DIR:-target}"

if command -v cargo-near >/dev/null 2>&1; then
  for crate in vault evidence mock-token test-proxy payee-registry model-registry meter cover-pool; do
    (cd "$crate" && cargo near build non-reproducible-wasm --no-abi --locked)
    name="wardline_$(echo "$crate" | tr '-' '_')"
    cp "${target_dir}/near/$name/$name.wasm" "out/$crate.wasm" 2>/dev/null \
      || cp "${target_dir}/near/$name.wasm" "out/$crate.wasm"
  done
else
  cargo build --workspace --target wasm32-unknown-unknown --release --locked
  for crate in vault evidence mock-token test-proxy payee-registry model-registry meter cover-pool; do
    name="wardline_$(echo "$crate" | tr '-' '_')"
    cp "${target_dir}/wasm32-unknown-unknown/release/$name.wasm" "out/$crate.wasm"
  done
fi

ls -l out/*.wasm
sha256sum out/*.wasm
