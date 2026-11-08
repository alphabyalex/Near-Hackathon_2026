# apps/web

Owner: Alexander

Wardline site and operator dashboard (Vite + React). Reads all data from the API through the `/api` dev proxy.

Read `docs/BRAND.md` before changing any UI. The visual source of truth is `design/wardline-reference.html`.

Colors and fonts live in `src/theme/tokens.css`. Layout lives in `src/theme/base.css`. `src/components/data/dots.ts` is generated from the mark and the reference, so do not edit it by hand.

Invoice text is untrusted. It is rendered as plain text, so never use `dangerouslySetInnerHTML`.
