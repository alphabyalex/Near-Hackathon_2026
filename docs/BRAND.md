# Wardline brand

Wardline is the product name, in the UI and in the code.
Wardline: the line between your agent and your money.
The visual source of truth is `apps/web/design/wardline-reference.html`. Open it in a browser before changing any UI.

## Logo
- Mark: the Eclipse sphere. A halftone dot sphere cut flat by a red row of dots; dots above the cut are faded.
  - `apps/web/public/brand/wardline-mark.svg` uses `currentColor` for the dots (inline it to recolor)
  - `wardline-mark-ink.svg` for light backgrounds, `wardline-mark-paper.svg` for dark backgrounds
  - `favicon.svg` is the mark on a black rounded tile
- Wordmark: "Wardline" in Geist 600, letter-spacing -0.055em, set next to the mark (gap about 10px at nav size).
- Clicking the logo always goes home.

## Color
| Token | Hex | Use |
|---|---|---|
| paper | #F2F0EB | page background |
| paper-2 | #E9E6DF | selected tab, subtle fills |
| ink | #0B0B0A | text, primary buttons |
| ink-2 | #2E2C28 | body text |
| muted | #5F5B53 | secondary text |
| rule | #D6D2C9 | hairlines |
| red | #E1251B | the limit. Use sparingly: the cut line, active tab underline, hover rules, FLAG |
| red-ink | #B5121B | red text on paper (passes contrast) |
| amber | #9A6A00 | reserved funds |
| green | #1F7A4D | settled, live |
| night | #0B0B0A / #141412 | dark sections (vault, terminal) |

Light first. Dark is only for sections that earn it (the attack terminal, the vault page).

## Type
- UI and headings: IBM Plex Sans (400/500/600). Headings weight 500, tight tracking (-0.035em to -0.045em).
- Codes, numbers, hashes: Wardline Mono = Spline Sans Mono, self-hosted from `public/fonts` (plain zero). Never use IBM Plex Mono, Geist Mono, JetBrains Mono, Red Hat Mono or any font with a dotted or slashed zero.
- Numbers always `font-variant-numeric: tabular-nums`.

## Components
- Primary button: black block, square corners, label only, red line draws along the bottom on hover.
- Secondary: text link with a dotted underline that becomes a solid red line on hover.
- Tabs: plain text; active tab has a 1.5px red underline; hover shows a faint underline. No pills, no boxes.
- Focus: 1.5px red outline only for keyboard focus (`:focus-visible`). No browser focus rings on click.
- Lists of features are ruled rows (name left, one line right), with a red rule that draws on hover. No icon grids.
- Limits are dot bars: settled dots ink, reserved dots amber, empty dots light, a red tick at the cap.
- Status words are exactly: requested, reserved, settled, rejected by policy, review needed, flagged, outcome uncertain. Always icon plus text.

## Motion
Subtle and purposeful: sphere drift, faded dots twinkling, red cut row pulsing, the limit line drawing in, dot bars filling, the attack log replaying. Everything off under `prefers-reduced-motion`.

## Never
- Hackathon, demo, testnet-disclaimer or "no value" copy in the UI. This is a product.
- Filler text. One short line where a paragraph would go.
- AI-slop patterns: purple or blue gradients, glows, glassmorphism, badge above the H1, identical icon cards, numbered 1-2-3 steps, stat banners, colored left or top borders on cards, emoji, "Get started" style CTAs, rounded pill buttons.
- Em dashes in any copy.
