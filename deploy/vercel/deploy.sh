#!/bin/sh
# Deploys the frontend to Vercel as a static build with the backend's address baked in.
#
#   deploy/vercel/deploy.sh <backend https URL> [project name]
#
# Why static: Vercel's project detection reads this monorepo as two services (the Vite app and the Hono API) and rejects
# a repo-root vercel.json, so the build runs here and only its output is uploaded. Nothing else leaves the machine.
# Needs: the Vercel CLI, logged in (vercel login), and pnpm install already run.
set -eu
API="${1:?usage: deploy/vercel/deploy.sh <backend https URL> [project name]}"
PROJECT="${2:-wardline}"
case "$API" in https://*) ;; *) echo "The backend URL must start with https://" >&2; exit 1;; esac
API="${API%/}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo "Commit or stash your changes first: the build must match a commit." >&2; exit 1; }
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
(cd "$ROOT/apps/web" && VITE_WARDLINE_API_URL="$API" npx vite build --outDir "$OUT/dist")
cat > "$OUT/vercel.json" <<'JSON'
{
  "outputDirectory": "dist",
  "framework": null,
  "buildCommand": "",
  "installCommand": "",
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "X-Frame-Options", "value": "DENY" }
    ] }
  ]
}
JSON
cd "$OUT"
vercel link --yes --project "$PROJECT" >/dev/null
vercel deploy --prod --yes
