# Horizon v2 reference designs

Reference implementations for the A20 build. Port their drawing code, timings and layout into apps/web. They are not app code and are not imported anywhere.

- `Main.dc.html`: live hero. Line draw-in, sphere assembly, light drift, stats strip and latest-proof line.
- `Explainer.dc.html`: "Watch a payment cross the line". The full 10-second timeline is in `draw(t)`.
- `Groups.dc.html`: groups as spheres. Sizing (`radius`), tier density (`step`, shadow floor) and staggered assembly.
- `Share.dc.html`: Your share. Personal sphere seeded from the account name (`seed`, `drawMark`) and the value count-up.
- `stewdio-preview.html`: frame previewer for the two Stewdio animations (Horizon hero, Payment crosses the line), with the same scene timings.

These are design-canvas files (`.dc.html`). Markup is in `<x-dc>`, logic is in the `class Component` script, and holes like `{{x}}` come from `renderVals()`. The `sphere()` function in each file is the shared halftone renderer, and should match the app's `horizonDots` look.

The numbers shown (12.15 USDC, 46 proven calls, and so on) are a snapshot of NEAR testnet on Nov 10, 2026. The app must read live data instead.
