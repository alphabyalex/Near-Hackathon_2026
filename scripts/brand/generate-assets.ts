/**
 * Writes every brand asset into apps/web/public from the one Horizon generator, so the mark is
 * identical in the favicon, the icons, the lockups, the social card and the site.
 *
 *   pnpm brand:assets
 *
 * Rasterized with @resvg/resvg-js (text set in Geist from scripts/brand/fonts), .ico built with png-to-ico.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";
import { dotsMarkup, HERO, HORIZON_COLORS, horizonDots, LINE_SLOPE, MARK, type HorizonOptions } from "../../apps/web/src/brand/horizon.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = join(ROOT, "apps/web/public");
const FONTS = join(ROOT, "scripts/brand/fonts");
const BG = "#0E0912";
const RULE = "#3A2E45";
const FONT_FILES = [join(FONTS, "Geist-Bold.ttf"), join(FONTS, "Geist-Medium.ttf")];

mkdirSync(join(PUBLIC, "brand"), { recursive: true });

const svgDoc = (w: number, h: number, body: string, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${extra}>${body}</svg>\n`;

function png(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Geist" } }).render().asPng();
}

function write(rel: string, data: string | Buffer): void {
  writeFileSync(join(PUBLIC, rel), data);
  console.log(`wrote apps/web/public/${rel}`);
}

const mark = (o: HorizonOptions) => dotsMarkup(horizonDots(o));

// The mark, light on dark and ink on light. Transparent background, viewBox 0 0 220 220.
write("brand/wardline-mark.svg", svgDoc(220, 220, mark(MARK)));
write("brand/wardline-mark-ink.svg", svgDoc(220, 220, mark({ ...MARK, ...HORIZON_COLORS.ink })));

// Lockups: "Wardline" in Geist 700, letter-spacing -0.04em, the mark at about 1.5x the cap height.
const FS = 48;
const CAP = FS * 0.7; // Geist's cap height is 0.7 em
const MARK_H = CAP * 1.5;
const word = (fill: string) => `<text font-family="Geist" font-weight="700" font-size="${FS}" letter-spacing="${-0.04 * FS}" fill="${fill}">Wardline</text>`;
const measure = new Resvg(svgDoc(600, 100, `<g transform="translate(0 70)">${word("#000")}</g>`), { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Geist" } }).getBBox();
const textW = Math.ceil(measure ? measure.width : 200);
const GAP = MARK_H * 0.32;
const LW = Math.ceil(MARK_H + GAP + textW + 2);
const LH = Math.ceil(MARK_H + 8);
const geistFace = `<style>@font-face{font-family:"Geist";font-weight:100 900;src:url(data:font/woff2;base64,${readFileSync(join(PUBLIC, "fonts/geist-variable.woff2")).toString("base64")}) format("woff2")}</style>`;
function lockup(colors: { top: string; bottom: string }, text: string, embedFont: boolean): string {
  const s = MARK_H / 220;
  const baseline = LH / 2 + CAP / 2;
  return svgDoc(LW, LH, `${embedFont ? geistFace : ""}<g transform="translate(0 4) scale(${s})">${mark({ ...MARK, ...colors })}</g><g transform="translate(${MARK_H + GAP} ${baseline})">${word(text)}</g>`);
}
write("brand/wardline-lockup.svg", lockup(HORIZON_COLORS.light, HORIZON_COLORS.light.top, true));
write("brand/wardline-lockup-ink.svg", lockup(HORIZON_COLORS.ink, HORIZON_COLORS.ink.top, true));

// Favicon: the mark on a #0E0912 rounded square (radius 22%), coarser so the dots and the line read at 16px.
const FAV: HorizonOptions = { ...MARK, R: 98, step: 16, light: [-0.45, -0.5] };
const favicon = svgDoc(220, 220, `<rect width="220" height="220" rx="${220 * 0.22}" fill="${BG}"/>${mark(FAV)}`);
write("favicon.svg", favicon);
const sizes = { 16: png(favicon, 16), 32: png(favicon, 32), 48: png(favicon, 48) };
write("favicon-32.png", sizes[32]);
write("favicon.ico", await pngToIco([sizes[16], sizes[32], sizes[48]]));
// Touch and app icons: full-bleed square (the platforms round the corners), the standard step.
const icon = svgDoc(220, 220, `<rect width="220" height="220" fill="${BG}"/><g transform="translate(22 22) scale(0.8)">${mark(MARK)}</g>`);
write("apple-touch-icon.png", png(icon, 180));
write("icon-192.png", png(icon, 192));
write("icon-512.png", png(icon, 512));
write(
  "site.webmanifest",
  JSON.stringify(
    {
      name: "Wardline",
      short_name: "Wardline",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      theme_color: BG,
      background_color: BG,
      display: "standalone",
      start_url: "/",
    },
    null,
    2,
  ) + "\n",
);

// Social card, 1200x630: the hero sphere on the right, its line running across the whole image.
{
  const W = 1200, H = 630;
  const s = 540 / 600;
  const ox = W - 540 - 30, oy = (H - 540) / 2;
  const cx = ox + HERO.cx * s, cy = oy + HERO.cy * s;
  const yAt = (x: number) => cy + (x - cx) * LINE_SLOPE;
  const line = `<line x1="0" y1="${yAt(0)}" x2="${W}" y2="${yAt(W)}" stroke="${RULE}" stroke-width="1.5"/>`;
  const sphere = `<g transform="translate(${ox} ${oy}) scale(${s})">${mark(HERO)}</g>`;
  const head = ["A credit union", "for the AI", "economy."]
    .map((t, i) => `<text x="72" y="${232 + i * 84}" font-family="Geist" font-weight="700" font-size="80" letter-spacing="-4.4" fill="#F5F3F7">${t}</text>`)
    .join("");
  const brand = `<g transform="translate(72 64) scale(${42 / 220})">${mark(MARK)}</g><text x="${72 + 52}" y="${64 + 31}" font-family="Geist" font-weight="700" font-size="30" letter-spacing="-1.2" fill="#F5F3F7">Wardline</text>`;
  const sub = `<text x="72" y="${232 + 3 * 84 + 22}" font-family="Geist" font-weight="500" font-size="26" fill="#C3BACB">Every payment lands on one side of the line.</text>`;
  write("og-image.png", png(svgDoc(W, H, `<rect width="${W}" height="${H}" fill="${BG}"/>${line}${sphere}${brand}${head}${sub}`), W));
}
