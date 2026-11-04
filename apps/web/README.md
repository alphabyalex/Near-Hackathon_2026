# apps/web

Owner: Alexander

Operator and judge UI (Vite + React). Reads all data from the API through the `/api` dev proxy.

To rebrand, edit `src/theme/tokens.css`. All colors, fonts, radii, and spacing live there; nothing else hardcodes them.

Invoice text is untrusted. It is rendered as plain text, so never use `dangerouslySetInnerHTML`.
