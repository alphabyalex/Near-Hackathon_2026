# apps/web

Owner: Alexander

Wardline site and operator dashboard (Vite + React). Reads all data from the API through the `/api` dev proxy.

Read `docs/BRAND.md` (Horizon) before changing any UI.

Colors and fonts live in `src/theme/tokens.css`. Every mark comes from `src/brand/horizon.ts`; regenerate the favicons, icons, lockups and social card with `pnpm brand:assets` from the repository root.

Invoice text is untrusted. It is rendered as plain text, so never use `dangerouslySetInnerHTML`.
