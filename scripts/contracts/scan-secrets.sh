#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail=0

if git grep -I -n -E 'BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|seed[ _-]?phrase[[:space:]]*[:=][[:space:]]*[A-Za-z]|mnemonic[[:space:]]*[:=][[:space:]]*[A-Za-z]' -- . ':!scripts/contracts/scan-secrets.sh'; then
  echo "Potential private key or seed material found" >&2
  fail=1
fi

if git grep -I -n -E 'ed25519:[1-9A-HJ-NP-Za-km-z]{80,}|secp256k1:[1-9A-HJ-NP-Za-km-z]{80,}' -- . ':!scripts/contracts/.env.example' ':!scripts/contracts/scan-secrets.sh'; then
  echo "Potential encoded private key found" >&2
  fail=1
fi

if git grep -I -n $'\xE2\x80\x94' -- .; then
  echo "Em dash found in authored files" >&2
  fail=1
fi

if git ls-files | grep -E '(^|/)(\.env($|\.)|credentials/|private-keys/|.*\.(pem|key)$)' | grep -v '/\.env\.example$' >/dev/null; then
  echo "A prohibited secret-bearing path is tracked" >&2
  fail=1
fi

if git grep -I -n -E 'https://(archival-)?rpc\.mainnet\.near\.org|"network"[[:space:]]*:[[:space:]]*"mainnet"' -- . ':!scripts/contracts/scan-secrets.sh'; then
  echo "Mainnet configuration found" >&2
  fail=1
fi

if git ls-files | grep -E '(^|/)(target|dist|node_modules|contracts/res)/' >/dev/null; then
  echo "Generated build output is tracked" >&2
  fail=1
fi

exit "$fail"
