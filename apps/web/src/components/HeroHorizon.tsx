import { useEffect, useMemo, useRef, useState } from "react";
import { HERO, horizonDots, LINE_SLOPE, shadeRadius } from "../brand/horizon";

const reduced = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const LABEL = "A sphere of dots cut by one line. Dots above the line are light, dots below are violet.";
/** The line draws in 1.2s; each dot starts at 0.9s plus 4.5ms per unit of distance from it, for 1.1s. */
const DOT_START_MS = 900;
const DOT_MS = 1100;
const DOT_STAGGER = 4.5;
const FRAME_MS = 50;
/** The slowest the drift goes on a struggling device: 4 frames a second. */
const MAX_FRAME_MS = 250;

/** cubic-bezier(.2,.8,.2,1), the assembly easing, solved for x by Newton's method. */
function ease(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const p1x = 0.2, p1y = 0.8, p2x = 0.2, p2y = 1;
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  let t = x;
  for (let i = 0; i < 6; i++) {
    const fx = ((ax * t + bx) * t + cx) * t - x;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= fx / d;
  }
  return ((ay * t + by) * t + cy) * t;
}

/** The line through the sphere's centre, extended far past it so it crosses the whole hero. */
function CutLine({ animate }: { animate: boolean }) {
  const x1 = -2400,
    x2 = 3000;
  const y = (x: number) => HERO.cy + (x - HERO.cx) * LINE_SLOPE;
  return <line className={animate ? "hero-cut" : "hero-cut drawn"} x1={x1} y1={y(x1)} x2={x2} y2={y(x2)} pathLength={1} />;
}

/** Reduced motion: the static sphere under the standard light, as SVG. */
function StaticSphere({ dots }: { dots: ReturnType<typeof horizonDots> }) {
  return (
    <svg className="hero-horizon still" viewBox="0 0 600 600" role="img" aria-label={LABEL} data-static="true">
      <CutLine animate={false} />
      {dots.map((d) => (
        <circle key={`${d.x}-${d.y}`} cx={d.x} cy={d.y} r={d.r} fill={d.fill} />
      ))}
    </svg>
  );
}

/**
 * The hero sphere. On load the line draws (SVG), then the dots assemble outward from it (above rise,
 * below drop), then the light drifts forever at about 20fps. The dots are drawn on a canvas from the
 * same generator: redrawing 915 circles there costs a few milliseconds, where changing 915 SVG
 * radii makes the browser lay out the whole sphere every frame. No React render per frame; the loop
 * slows down on a struggling device and pauses while the tab is hidden or the hero is off screen.
 * Under reduced motion it is the static SVG sphere. It never follows the mouse.
 */
export function HeroHorizon() {
  const [still] = useState(reduced);
  const dots = useMemo(() => horizonDots(HERO), []);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (still || !canvas.current || !box.current) return;
    const cv = canvas.current;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const order = dots.map((d) => DOT_START_MS + Math.abs(d.off) * DOT_STAGGER);
    const assembled = Math.max(...order) + DOT_MS;
    const radii = Float32Array.from(dots, (d) => d.r);
    let scale = 1;
    const size = () => {
      const w = cv.clientWidth || 600;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(w * dpr);
      scale = (w * dpr) / 600;
    };
    size();

    // Dots are filled in batches: one path per colour and opacity step, not one fill per dot.
    const LEVELS = 10;
    const fills = [...new Set(dots.map((d) => d.fill))];
    const draw = (elapsed: number) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, 600, 600);
      const paths = new Map<string, Path2D>();
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i]!;
        let r = radii[i]!;
        let y = d.y;
        let level = LEVELS;
        if (elapsed < assembled) {
          const e = ease((elapsed - order[i]!) / DOT_MS);
          if (e <= 0.02) continue;
          y += (1 - e) * 14 * (d.off < 0 ? 1 : -1);
          r *= 0.3 + 0.7 * e;
          level = Math.max(1, Math.round(e * LEVELS));
        }
        const key = `${d.fill}|${level}`;
        let path = paths.get(key);
        if (!path) paths.set(key, (path = new Path2D()));
        path.moveTo(d.x + r, y);
        path.arc(d.x, y, r, 0, Math.PI * 2);
      }
      for (const fill of fills) {
        ctx.fillStyle = fill;
        for (let level = 1; level <= LEVELS; level++) {
          const path = paths.get(`${fill}|${level}`);
          if (!path) continue;
          ctx.globalAlpha = level / LEVELS;
          ctx.fill(path);
        }
      }
      ctx.globalAlpha = 1;
    };

    let start = 0;
    let raf = 0;
    let onScreen = true;
    let t = Math.atan2(-0.667, -0.6875) + Math.PI * 2; // where the static light sits
    let last = 0;
    let prev = 0;
    let gap = 16;
    let interval = FRAME_MS;
    let frames = 0;
    const frame = (now: number) => {
      raf = 0;
      if (!onScreen || document.hidden) return;
      if (!start) start = now;
      const elapsed = now - start;
      if (elapsed < assembled) {
        // The assembly draws at about 20fps, leaving the main thread room between frames.
        if (now - last >= 50) {
          last = now;
          draw(elapsed);
        }
        box.current?.setAttribute("data-phase", elapsed < DOT_START_MS ? "cut" : "assemble");
      } else {
        // The drift: about 20fps, slower when frames come late, the light moving at the same speed.
        if (prev) gap = gap * 0.8 + (now - prev) * 0.2;
        prev = now;
        if (gap > 40) interval = Math.min(MAX_FRAME_MS, interval * 1.5);
        else if (gap < 24) interval = Math.max(FRAME_MS, interval / 1.25);
        if (now - last >= interval) {
          t += 0.025 * Math.min(4, (now - (last || now - FRAME_MS)) / FRAME_MS);
          last = now;
          const light: [number, number] = [Math.cos(t) * 0.8, -0.3 + Math.sin(t) * 0.45];
          for (let i = 0; i < dots.length; i++) radii[i] = shadeRadius(HERO, dots[i]!.x, dots[i]!.y, light);
          draw(elapsed);
          frames++;
          box.current?.setAttribute("data-phase", "drift");
          box.current?.setAttribute("data-frames", String(frames));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    const resume = () => {
      if (!raf && onScreen && !document.hidden) {
        prev = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    resume();
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      resume();
    });
    io?.observe(box.current);
    const onVisibility = () => resume();
    document.addEventListener("visibilitychange", onVisibility);
    const onResize = () => {
      size();
      draw(start ? performance.now() - start : 0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, [still, dots]);

  if (still) return <StaticSphere dots={dots} />;
  return (
    <div ref={box} className="hero-horizon live" role="img" aria-label={LABEL} data-static="false" data-phase="cut">
      <svg className="hero-line" viewBox="0 0 600 600" aria-hidden="true">
        <CutLine animate />
      </svg>
      <canvas ref={canvas} className="hero-dots" aria-hidden="true" />
    </div>
  );
}
