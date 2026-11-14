/**
 * Horizon: a halftone sphere cut by one clean line at -10 degrees. Dots above the line are light,
 * dots below are violet, and each dot's size comes from shading a sphere under a light. Every mark,
 * favicon, lockup and the hero are drawn from horizonDots, so the mark is identical everywhere.
 * Plain TypeScript with no DOM, so scripts/brand/generate-assets.ts can import it too.
 */

export interface HorizonDot {
  x: number;
  y: number;
  r: number;
  fill: string;
  /** Signed distance from the line: negative above it, positive below. */
  off: number;
}

export interface HorizonOptions {
  cx: number;
  cy: number;
  R: number;
  step: number;
  light: [number, number];
  top: string;
  bottom: string;
  /**
   * The Horizon v2 look (docs/design/v2, `sphere()`): a square grid, a shade floor so the far side
   * keeps small dots, a gap of `gap` px around the line, and `off` as the perpendicular distance from
   * the line. Left out, the classic mark: offset rows, no floor, the gap from the step.
   */
  v2?: { floor: number; gap: number };
}

/** The v2 sphere (the reference designs' `sphere()`), unassembled: every dot at full size. */
function horizonDotsV2(o: HorizonOptions, v2: { floor: number; gap: number }): HorizonDot[] {
  const out: HorizonDot[] = [];
  const a = (-10 * Math.PI) / 180,
    nx = -Math.sin(a),
    ny = Math.cos(a);
  let lx = o.light[0],
    ly = o.light[1];
  const l2 = lx * lx + ly * ly;
  let lz = l2 < 1 ? Math.sqrt(1 - l2) : 0;
  const ln = Math.hypot(lx, ly, lz) || 1;
  lx /= ln;
  ly /= ln;
  lz /= ln;
  const R = o.R;
  for (let gy = -R; gy <= R + 0.001; gy += o.step) {
    for (let gx = -R; gx <= R + 0.001; gx += o.step) {
      const d2 = gx * gx + gy * gy;
      if (d2 > R * R) continue;
      const sd = gx * nx + gy * ny; // signed distance from the line: negative above it
      if (Math.abs(sd) < v2.gap / 2) continue;
      const z = Math.sqrt(Math.max(0, 1 - d2 / (R * R)));
      const sh = v2.floor + (1 - v2.floor) * Math.max(0, (gx / R) * lx + (gy / R) * ly + z * lz);
      out.push({ x: o.cx + gx, y: o.cy + gy, r: o.step * 0.48 * sh, fill: sd < 0 ? o.top : o.bottom, off: sd });
    }
  }
  return out;
}

export function horizonDots(o: HorizonOptions): HorizonDot[] {
  if (o.v2) return horizonDotsV2(o, o.v2);
  const out: HorizonDot[] = [];
  let L = [o.light[0], o.light[1], 0.75];
  const m = Math.hypot(L[0]!, L[1]!, L[2]!);
  L = L.map((v) => v / m);
  const slope = Math.tan((-10 * Math.PI) / 180);
  for (let y = o.cy - o.R; y <= o.cy + o.R; y += o.step) {
    const row = Math.round((y - (o.cy - o.R)) / o.step);
    for (let x = o.cx - o.R + (row % 2 ? o.step / 2 : 0); x <= o.cx + o.R; x += o.step) {
      const nx = (x - o.cx) / o.R,
        ny = (y - o.cy) / o.R,
        q = nx * nx + ny * ny;
      if (q > 1) continue;
      const off = y - (o.cy + (x - o.cx) * slope); // signed distance from the line
      if (Math.abs(off) < o.step * 0.75) continue; // the gap is the line
      const i = Math.max(0, nx * L[0]! + ny * L[1]! + Math.sqrt(1 - q) * L[2]!);
      out.push({ x, y, r: 0.4 + o.step * 0.47 * Math.pow(i, 0.85), fill: off < 0 ? o.top : o.bottom, off });
    }
  }
  return out;
}

export const HORIZON_COLORS = {
  light: { top: "#F5F3F7", bottom: "#7B6CFF" },
  ink: { top: "#1A0F21", bottom: "#5B4BE0" },
} as const;

/** The standard mark: viewBox 0 0 220 220. */
export const MARK: HorizonOptions = { cx: 110, cy: 110, R: 92, step: 11, light: [-0.55, -0.6], ...HORIZON_COLORS.light };
/** The hero sphere: viewBox 0 0 600 600. */
export const HERO: HorizonOptions = { cx: 300, cy: 300, R: 270, step: 17, light: [-0.55, -0.6], ...HORIZON_COLORS.light };
/** The line's angle and slope, for drawing it outside the sphere. */
export const LINE_DEG = -10;
export const LINE_SLOPE = Math.tan((LINE_DEG * Math.PI) / 180);

/** FNV-1a, 32 bit. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift32 stream seeded by a string. */
export function xorshift(seed: string): () => number {
  let s = fnv1a(seed) || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

/** A group's own light: an angle from a hash of its budget id, so every group has its own horizon. */
export function seededLight(id: string): [number, number] {
  const angle = ((fnv1a(id) % 3600) / 3600) * Math.PI * 2;
  return [Math.cos(angle) * 0.7, Math.sin(angle) * 0.7];
}

/**
 * A 5x5 left-right mirrored grid from a hash of a call id: FNV-1a seeds xorshift, and a cell is on
 * when the hash % 3 != 0. Returns 25 booleans, row by row.
 */
export function fingerprintCells(id: string): boolean[] {
  const next = xorshift(id);
  const half: boolean[][] = [];
  for (let r = 0; r < 5; r++) half.push([next() % 3 !== 0, next() % 3 !== 0, next() % 3 !== 0]);
  const cells: boolean[] = [];
  for (const [a, b, c] of half) cells.push(a!, b!, c!, b!, a!);
  return cells;
}

const n2 = (v: number) => Math.round(v * 100) / 100;

/** Circles as SVG markup, for asset files. */
export function dotsMarkup(dots: HorizonDot[]): string {
  return dots.map((d) => `<circle cx="${n2(d.x)}" cy="${n2(d.y)}" r="${n2(d.r)}" fill="${d.fill}"/>`).join("");
}
