# Wardline brand: Horizon

Wardline is a credit union for the AI economy. The brand has one idea: every payment lands on one side of a line. Above the line: proven and paid. Below the line: refused, blocked or capped, and refunded. Copy says "above the line" and "below the line" wherever it shows proven and refused outcomes.

All copy lives in `apps/web/src/brand.ts`. All colors and fonts live in `apps/web/src/theme/tokens.css`.

## The mark

A halftone sphere cut by one clean line at -10 degrees. Dots above the line are light, dots below are violet. Each dot's size comes from shading a sphere under a light.

- One generator draws every mark: `apps/web/src/brand/horizon.ts` (`horizonDots`). The React `<HorizonMark>`, the hero, the group horizons and `scripts/brand/generate-assets.ts` all use it, so the mark is identical everywhere.
- Standard mark: viewBox `0 0 220 220`, cx 110, cy 110, R 92, step 11, light `[-0.55, -0.6]`, top `#F5F3F7`, bottom `#7B6CFF`.
- Ink version for light backgrounds: top `#1A0F21`, bottom `#5B4BE0`.
- Favicon: the mark on a `#0E0912` rounded square (radius 22%) with a coarser step (16) and a slightly larger sphere, so the dots and the line still read at 16px.
- Wordmark: "Wardline" in Geist 700, letter-spacing -0.04em, the mark to its left at about 1.5x the cap height. The lockup always links home.
- Each group has its own horizon: the light angle comes from a hash of its budget id (`seededLight`).
- Each call has a fingerprint: a 5x5 left-right mirrored grid of squares from a hash of its call id (FNV-1a, then xorshift; a cell is on when the hash % 3 != 0). Light squares above the line, red below. Used in the proofs table.

Assets (regenerate with `pnpm brand:assets`, which writes into `apps/web/public`):

| File | What |
| --- | --- |
| `favicon.svg`, `favicon.ico` (16, 32, 48), `favicon-32.png` | The favicon |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `site.webmanifest` | Touch and app icons, theme and background `#0E0912` |
| `og-image.png` (1200x630) | The hero sphere on the right with its line across the image, the headline in Geist 700 on the left |
| `brand/wardline-mark.svg`, `brand/wardline-mark-ink.svg` | The mark, light on dark and ink on light |
| `brand/wardline-lockup.svg`, `brand/wardline-lockup-ink.svg` | Mark and wordmark, with Geist embedded |

## Color

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | #0E0912 | Page background |
| `--surface` | #150D1B | Cards |
| `--surface-2` | #1C1323 | Code, selected choices, hover |
| `--rule` / `--rule-2` / `--rule-strong` | #241A2B / #2A2030 / #3A2E45 | Hairlines, table rows, secondary button borders, the hero line |
| `--text` / `--text-2` / `--muted` | #F5F3F7 / #C3BACB / #A79DB0 | Text, body text, small labels |
| `--violet` | #7B6CFF | Dots, data, chart marks, the current-page underline |
| `--violet-btn` | #6A5AF9, hover #5A4AE8 | Primary buttons, white text |
| `--violet-text` | #A59BFF | Links and tier labels on dark, the focus ring |
| `--violet-ink` | #4B3BD9 | Violet text on light |
| `--red` / `--red-text` | #FF5C73 / #FF7A8C | Below the line only |
| `--paper` / `--ink` / `--ink-2` | #F5F3F7 / #1A0F21 / #4A4052 | Light sections |

The red rule: red means below the line (refused, blocked, capped, a loss). Nothing else is red: not errors of other kinds, not decoration, not a rejected vote.

Every text pair passes 4.5:1. For example, `--muted` on `--bg` is about 7.6:1, white on `--violet-btn` about 5.1:1, `--red-text` on `--bg` about 7.8:1, `--ink-2` on `--paper` about 8:1.

## Type

- Geist for everything, self-hosted as one variable woff2 (weights 300 to 800) in `apps/web/public/fonts`, SIL OFL 1.1.
- No monospace face. Geist Mono's zero is slashed, and the zero rule forbids a slashed or dotted zero in anything that contains numbers. Account ids, hashes and code all contain digits, so they are set in Geist with tabular figures.
- Numbers use `font-variant-numeric: tabular-nums`.
- Scale: hero `clamp(52px, 6.2vw, 96px)`, 700, -0.055em, line-height 0.95. Section headings 48 to 56px, 700, -0.05em, line-height 1. Card headings 20 to 26px, 600 to 700, -0.02 to -0.03em. Body 17px, line-height 1.55. Small labels 13 to 14px in `--muted`.
- Sentence case everywhere. No all-caps labels.

## Components

- Container max 1280px, 40px side padding (20px under 600px).
- Sticky header: `rgba(14,9,18,.88)` with a backdrop blur and a 1px `--rule` bottom border. Lockup left, pages in the middle (current page in `--text` with a 2px `--violet` underline), "Connect wallet" on the right (the connected account once set).
- Buttons: radius 12px, min-height 48px (44px in dense places), weight 700. Primary `--violet-btn`. Secondary transparent with a 1px `--rule-strong` border. On light sections the primary is `--ink`.
- Cards: `--surface`, 1px `--rule` border, radius 18 to 20px, no shadows on dark. One soft shadow is allowed under the member card on the light section.
- Tables: hairline `--rule-2` rows, 13px `--muted` headers, tabular numbers, a horizontal scroll box on small screens.
- Tiers are plain text, "Gold", "Silver", "Bronze", in `--violet-text`. Never pills.
- Vote bars: 4px tall, `--violet` for, `--red` against, on `--rule-2`.
- Focus ring: 2px `#A59BFF`, offset 2px, on every interactive element. Text fields show it only while the keyboard is in use.
- WARD price chart: a dashed line at 1.0000 (the launch price); the price line is light above it and red below it (one path, two clip paths); a violet dot on the latest price.

## Motion

One animated moment, the hero, specified exactly:

1. The line draws first: a 1.2px `--rule-strong` hairline at -10 degrees through the sphere's center, extended far past the sphere so it crosses the whole hero behind the headline (the SVG overflows, the section clips it). `stroke-dashoffset` 1 to 0 over 1.2s, `cubic-bezier(.7,0,.2,1)`.
2. The sphere assembles outward from the line: dots above rise into place from `translateY(14px) scale(.3)`, dots below drop from `translateY(-14px) scale(.3)`. 1.1s, `cubic-bezier(.2,.8,.2,1)`, each delayed `0.9s + |offset| * 0.0045s`.
3. The light drifts forever: every 50ms `t += 0.025`, light `[cos(t) * 0.8, -0.3 + sin(t) * 0.45]`, radii recomputed, with no React render per frame. It slows down (to as little as 4 frames a second, the light moving at the same speed) when frames arrive late, and pauses while the tab is hidden or the hero is off screen.

With motion on, the dots are drawn on a `<canvas>` from the same generator and the cut line is an SVG hairline. The first build updated 915 SVG `r` attributes per frame, which made the browser lay out the whole sphere every frame: about 5 seconds of main-thread blocking on a mid-range phone in Lighthouse. The canvas draws the dots in about 20 batched fills per frame (one per colour and opacity step) and at about 20 frames a second during the assembly, which removes that cost. Under reduced motion the sphere is the static SVG.
4. Under `prefers-reduced-motion`: no cut, no assembly, no drift; a static sphere with light `[-0.55, -0.6]`.

The headline, sub and buttons fade up once (0.7s) at 0.3s, 0.5s and 0.7s.

Below the hero, each block of the home page fades up once, the first time it reaches the lower part of the screen (`apps/web/src/v2/reveal.ts`): 28px of lift, opacity 0 to 1, 0.9s on `cubic-bezier(.16, 1, .3, 1)`, blocks that arrive together staggered by 90ms. Blocks already on screen at load are left alone, a block never hides again after it has shown, and under `prefers-reduced-motion` nothing is hidden at all. Sections meet through space and tone, never a rule: the page alternates `--bg` and `--surface` bands that feather into each other over about 220px (both are dark purples, so the blend has no grey in it), and the one light section is a full-width band with straight edges and the same container as every other section, so the break is crisp. A rounded floating box and a gradient were both tried and read as odd; do not bring either back. A gradient between dark and light reads as a smudge; do not use one.

The first screen is the hero alone: it is at least as tall as the window (minus the header), the sphere and the copy share one vertical centre, and the live strip sits at its foot. The header's pages are centred on the page, not between the logo and the buttons, and the current page's underline sits on the header rule.

"Watch a payment cross the line" is words on the left and a diagram on the right, on one clock of about seven seconds. The words are page text that switches on as the story reaches it. The diagram is the mechanism: the line, three gates (Receipt, Payee, Budget), the paid path rising above the line with 2% peeling off to the pool, and the swapped payment failing the first gate, dropping below the line and returning to its budget on a dashed refund path.

Where an animation is a count or a bar, it plays once when it scrolls into view (`useInView` in `v2/motion.ts`) and is simply finished under reduced motion: the comparison's dots pop in one by one while the number counts up as each red dot lands, vote bars and the groups' proven-call bars fill, the money diagrams grow, and the builders' code writes itself in line by line before the one line lights up.

The last section repeats the hero's sphere and line, inside the same container as the copy and centred with it (the line starts left of the sphere and runs off to the right, as in the hero), so the page ends where it began.

Votes and groups are one section, "Run by the people who hold it": the open votes on the left, the safest groups on the right, no connect-wallet row (a Vote button with no wallet opens the wallet picker itself). Keep it high level: a bar and one line per vote, a rank, a tier, a bar and a fee per group.

Blocks also fade and lift away as they leave the top of the screen. It is scroll-driven (`animation-timeline: view()`), gated with `@supports` and `prefers-reduced-motion: no-preference`, and uses `filter` and `translate` so it never fights the entrance, which uses `opacity` and `transform`. Tall blocks are split into their parts so nothing still being read is dimmed.

Motion that answers a person's action is also allowed: a dialog opening, a spinner while a wallet signs, demo results appearing row by row after "Run scene". Nothing follows the mouse.

## Never

- Red for anything that is not below the line.
- Pastels, pill-shaped badges or chips, gradient washes, emoji, marquees or tickers, animated lines other than the hero cut.
- All-caps labels, em dashes, hype words.
- Hackathon or testnet disclaimers outside the README's honest-limits section.
- "Stable", "guaranteed" or "principal-protected" for WARD. WARD is yield-bearing and loss-sharing. The Mutual is protocol-backed coverage, not insurance.
