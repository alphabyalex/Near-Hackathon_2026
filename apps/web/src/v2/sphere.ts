/**
 * Horizon v2 spheres on canvas. Every sphere comes from horizonDots (its v2 look, which matches the
 * reference designs' `sphere()`); this file only assembles and paints them. Plain functions, no React,
 * so the sizing and seeding rules are unit tested on their own.
 */
import { fnv1a, HORIZON_COLORS, horizonDots, type HorizonDot } from "../brand/horizon";

export const TOP = HORIZON_COLORS.light.top;
export const BOTTOM = HORIZON_COLORS.light.bottom;
/** Lit from the upper left, like the mark. */
export const LIGHT: [number, number] = [-0.55, -0.6];

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** Cubic ease out, the reference designs' `ease` / `eo`. */
export const easeOut = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
/** Cubic ease in and out, the reference designs' `eio`. */
export const easeInOut = (x: number): number => {
  const u = clamp01(x);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

/** One sphere's geometry and look, in CSS pixels. */
export interface SphereSpec {
  cx: number;
  cy: number;
  R: number;
  step: number;
  light: [number, number];
  floor: number;
  gap: number;
}

export const sphereDots = (s: SphereSpec): HorizonDot[] => horizonDots({ cx: s.cx, cy: s.cy, R: s.R, step: s.step, light: s.light, top: TOP, bottom: BOTTOM, v2: { floor: s.floor, gap: s.gap } });

/**
 * Sizes a canvas to its CSS box at the device pixel ratio, capped at 2, and returns a context drawing in
 * CSS pixels, cleared.
 */
export function fitCanvas(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const pw = Math.round(w * dpr),
    ph = Math.round(h * dpr);
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/**
 * The radius a dot has at assembly progress `as` (0 to 1): dots grow outward from the line, the
 * reference's `loc` ramp. 0 means not drawn yet.
 */
export function assembledRadius(d: HorizonDot, R: number, as: number): number {
  if (as <= 0) return 0;
  const loc = clamp01((as * 1.3 - Math.abs(d.off) / R) / 0.3);
  if (loc <= 0) return 0;
  const r = d.r * (1 - Math.pow(1 - loc, 3));
  return r < 0.35 ? 0 : r;
}

/** Paints dots at assembly progress `as`, one path per colour. */
export function paintDots(ctx: CanvasRenderingContext2D, dots: HorizonDot[], R: number, as: number): void {
  if (as <= 0) return;
  const paths = new Map<string, Path2D>();
  for (const d of dots) {
    const r = assembledRadius(d, R, as);
    if (!r) continue;
    let p = paths.get(d.fill);
    if (!p) paths.set(d.fill, (p = new Path2D()));
    p.moveTo(d.x + r, d.y);
    p.arc(d.x, d.y, r, 0, Math.PI * 2);
  }
  for (const [fill, p] of paths) {
    ctx.fillStyle = fill;
    ctx.fill(p);
  }
}

// Groups (Groups.dc.html): size from proven calls, density from tier.
export const GROUP_SPHERE = {
  /** Radius for a group with no proven calls, and the most added for the group with the most. */
  minR: 52,
  growR: 98,
  /** Phones: every radius times this, so a sphere row fits its scroll box. */
  phoneScale: 0.62,
  /** Dot spacing by tier: Gold is densest. */
  step: { gold: 9, silver: 12, bronze: 16 },
  /** Shade floor by tier: a cleaner record keeps more dots lit on the far side. */
  floor: { gold: 0.28, silver: 0.2, bronze: 0.14 },
  /** The gap around the line is 0.8 steps, at least 6px. */
  gapSteps: 0.8,
  minGap: 6,
  /** Canvas margin around the sphere, for the selection ring. */
  pad: 8,
  ringOffset: 6,
} as const;

export type Tier = keyof typeof GROUP_SPHERE.step;

/** A group's sphere: radius from its proven calls against the busiest group, dot spacing and floor from its tier. */
export function groupSphere(calls: number, maxCalls: number, tier: Tier, scale = 1): { R: number; step: number; floor: number; gap: number } {
  const share = maxCalls > 0 ? Math.min(1, Math.max(0, calls) / maxCalls) : 0;
  const R = Math.round((GROUP_SPHERE.minR + GROUP_SPHERE.growR * Math.sqrt(share)) * scale);
  const step = GROUP_SPHERE.step[tier] ?? GROUP_SPHERE.step.bronze;
  return { R, step, floor: GROUP_SPHERE.floor[tier] ?? GROUP_SPHERE.floor.bronze, gap: Math.max(GROUP_SPHERE.minGap, step * GROUP_SPHERE.gapSteps) };
}

// Your share (Share.dc.html): a personal sphere seeded from the account name.
export const PERSONAL_SPHERE = {
  /** Base dot spacing; the seed adds 0 to 3. */
  step: 12,
  stepSpread: 3,
  /** The light: x from -0.75 to -0.3, y from -0.7 to -0.4, always upper left. */
  light: { x: -0.75, xSpread: 0.45, y: -0.7, ySpread: 0.3 },
  floor: 0.2,
  /** As fractions of the canvas size (205 of 440 and 11 of 440 in the reference). */
  radius: 205 / 440,
  gap: 11 / 440,
} as const;

/** A string's FNV-1a hash as a number from 0 to 1. */
export const seedUnit = (text: string): number => fnv1a(text) / 4294967295;

/**
 * The personal sphere for an account: the same name always gives the same mark. One seed from the name,
 * one from its parts reversed (hyperios.testnet and testnet.hyperios).
 */
export function personalSphere(account: string): { step: number; light: [number, number] } {
  const r1 = seedUnit(account),
    r2 = seedUnit(account.split(".").reverse().join("."));
  const P = PERSONAL_SPHERE;
  return { step: P.step + Math.round(r2 * P.stepSpread), light: [P.light.x + P.light.xSpread * r1, P.light.y + P.light.ySpread * r2] };
}
