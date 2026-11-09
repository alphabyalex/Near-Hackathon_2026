import { useEffect, useMemo, useRef, useState } from "react";
import { HERO, horizonDots, LINE_SLOPE, shadeRadius } from "../brand/horizon";

const reduced = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** When the light drift starts: after the line draws and the last dot settles. */
const SETTLE_MS = 3400;
const FRAME_MS = 50;

/**
 * The hero sphere. On load the line draws, then the dots assemble outward from it (above rise,
 * below drop), then the light drifts forever. The drift updates each circle's r through refs in a
 * requestAnimationFrame loop throttled to about 20fps, with no React render per frame, and pauses
 * while the tab is hidden or the hero is off screen. Under reduced motion it is a static sphere.
 * It never follows the mouse.
 */
export function HeroHorizon() {
  const [still] = useState(reduced);
  const dots = useMemo(() => horizonDots(HERO), []);
  const circles = useRef<(SVGCircleElement | null)[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  // The line through the sphere's centre, extended far past it so it crosses the whole hero.
  const x1 = -2400,
    x2 = 3000;
  const y = (x: number) => HERO.cy + (x - HERO.cx) * LINE_SLOPE;

  useEffect(() => {
    if (still) return;
    let t = Math.atan2(-0.667, -0.6875) + Math.PI * 2; // starts where the static light sits
    let raf = 0;
    let last = 0;
    let onScreen = true;
    let started = false;
    const frame = (now: number) => {
      raf = 0;
      if (!onScreen || document.hidden) return;
      if (now - last >= FRAME_MS) {
        last = now;
        t += 0.025;
        const light: [number, number] = [Math.cos(t) * 0.8, -0.3 + Math.sin(t) * 0.45];
        for (let i = 0; i < dots.length; i++) {
          const d = dots[i]!;
          circles.current[i]?.setAttribute("r", shadeRadius(HERO, d.x, d.y, light).toFixed(2));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    const resume = () => {
      if (started && !raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const begin = window.setTimeout(() => {
      started = true;
      resume();
    }, SETTLE_MS);
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      resume();
    });
    if (svg.current && io) io.observe(svg.current);
    const onVisibility = () => resume();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(begin);
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [still, dots]);

  return (
    <svg ref={svg} className={still ? "hero-horizon still" : "hero-horizon"} viewBox="0 0 600 600" role="img" aria-label="A sphere of dots cut by one line. Dots above the line are light, dots below are violet." data-static={still ? "true" : "false"}>
      <line className="hero-cut" x1={x1} y1={y(x1)} x2={x2} y2={y(x2)} pathLength={1} />
      {dots.map((d, i) => (
        <circle
          key={`${d.x}-${d.y}`}
          ref={(el) => {
            circles.current[i] = el;
          }}
          className={still ? undefined : d.off < 0 ? "rise" : "drop"}
          style={still ? undefined : { animationDelay: `${(0.9 + Math.abs(d.off) * 0.0045).toFixed(3)}s` }}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={d.fill}
        />
      ))}
    </svg>
  );
}
