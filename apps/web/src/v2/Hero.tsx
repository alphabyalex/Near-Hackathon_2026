/**
 * The live hero (docs/design/v2/Main.dc.html). The line draws in, the sphere assembles outward from it,
 * then the headline, subline and buttons rise in. Under it, the live numbers from NEAR testnet (or the
 * simulation) and the latest payment. After the entrance only a 24-second light drift keeps going, at a
 * low frame rate, and it stops off screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { HOME } from "../brand";
import { DATA_SOURCE } from "../data/source";
import { useLiveHero, type LiveNumbers } from "../data/live";
import { formatUsdc } from "../format";
import { boxOf, frozenFrame, prefersReducedMotion, useCanvasAnimation } from "./motion";
import { Rolling } from "./Rolling";
import { BOTTOM, easeOut, fitCanvas, paintDots, sphereDots, TOP } from "./sphere";

/** Every number in the hero's motion, in CSS pixels and seconds. Reference: a 1440 wide hero. */
export const HERO_MOTION = {
  design: 1440,
  sphere: { fromCenter: 340, cy: 332, R: 292, step: 15, gap: 13, floor: 0.2, light: [-0.5, -0.58] as [number, number] },
  /** The line starts 500px left of the sphere's centre, but never over the copy column. */
  line: { lead: 500, fade: 300, width: 1.5, rgb: "167,157,176", alpha: 0.7, draw: 1.2, copyWidth: 508 },
  assemble: { delay: 0.6, duration: 1.8 },
  /** The light drifts once the sphere is built: one slow cycle every 24 seconds, drawn at 12fps. */
  drift: { start: 2.4, period: 24, x: 0.14, y: 0.06, fps: 12 },
  fps: 30,
  /** Phones: the sphere sits above the copy. */
  phone: { below: 760, maxR: 150, top: 24, step: 13, gap: 11 },
  /** How long a changed number's cell edge glows, in ms. */
  glowMs: 1400,
} as const;

const LABEL = "A sphere of dots cut by one line. Dots above the line are light, dots below are violet.";

/** Height of the live strip at the foot of the hero, so the sphere can centre in the space above it. */
const STRIP_H = 214;

/** The sphere and line for a hero of this size (h, when known, centres the sphere above the strip). */
export function heroGeometry(w: number, h?: number): { cx: number; cy: number; R: number; step: number; gap: number; x0: number; phone: boolean } {
  const M = HERO_MOTION;
  if (w < M.phone.below) {
    const R = Math.min(M.phone.maxR, Math.round((w - 40) * 0.42));
    return { cx: w / 2, cy: M.phone.top + R, R, step: M.phone.step, gap: M.phone.gap, x0: 0, phone: true };
  }
  const k = Math.min(1, w / M.design);
  const cx = w / 2 + M.sphere.fromCenter * k;
  const wrapLeft = Math.max(40, (w - 1280) / 2 + 40);
  const R = Math.round(M.sphere.R * k);
  const cy = h && h > STRIP_H + 2 * (R + 16) ? (h - STRIP_H) / 2 + 8 : M.sphere.cy * k + (1 - k) * 60;
  return { cx, cy, R, step: M.sphere.step, gap: M.sphere.gap, x0: Math.max(cx - M.line.lead * k, wrapLeft + M.line.copyWidth), phone: false };
}

function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const freezeAt = frozenFrame("hero");
  const draw = useCallback((t: number) => {
    const cv = ref.current;
    if (!cv) return;
    const { w, h } = boxOf(cv);
    if (!w || !h) return;
    const ctx = fitCanvas(cv, w, h);
    if (!ctx) return;
    const M = HERO_MOTION;
    const g = heroGeometry(w, h);
    const tan = Math.tan((-10 * Math.PI) / 180);
    const y = (x: number) => g.cy + tan * (x - g.cx);
    // The line, fading in from its left end.
    const drawn = easeOut(t / M.line.draw);
    const x1 = g.x0 + (w - g.x0) * drawn;
    if (drawn > 0) {
      const grad = ctx.createLinearGradient(g.x0, 0, g.x0 + (g.phone ? w * 0.3 : M.line.fade), 0);
      grad.addColorStop(0, `rgba(${M.line.rgb},0)`);
      grad.addColorStop(1, `rgba(${M.line.rgb},${M.line.alpha})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = M.line.width;
      ctx.beginPath();
      ctx.moveTo(g.x0, y(g.x0));
      ctx.lineTo(x1, y(x1));
      ctx.stroke();
    }
    // The sphere, assembling outward from the line, then the light's slow drift.
    const drift = t > M.drift.start ? Math.sin(((t - M.drift.start) / M.drift.period) * Math.PI * 2) : 0;
    const light: [number, number] = [M.sphere.light[0] + M.drift.x * drift, M.sphere.light[1] + M.drift.y * drift];
    const dots = sphereDots({ cx: g.cx, cy: g.cy, R: g.R, step: g.step, light, floor: M.sphere.floor, gap: g.gap });
    paintDots(ctx, dots, g.R, easeOut((t - M.assemble.delay) / M.assemble.duration));
  }, []);
  // Reduced motion and the final frame: the built sphere under the resting light.
  useCanvasAnimation(ref, draw, { duration: Infinity, finalAt: HERO_MOTION.drift.start, fps: (t) => (t < HERO_MOTION.drift.start ? HERO_MOTION.fps : HERO_MOTION.drift.fps), freezeAt });
  return <canvas ref={ref} className="hero-canvas" role="img" aria-label={LABEL} data-testid="hero-canvas" />;
}

const price4 = (scaled: string) => (Number(scaled) / 1e6).toFixed(4);

/** One number in the strip. Its top edge glows once when the value changes: violet, or red for Kept below it. */
function Cell({ label, value, note, below = false }: { label: string; value: string; note: string; below?: boolean }) {
  const [glow, setGlow] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setGlow(true);
    const off = setTimeout(() => setGlow(false), HERO_MOTION.glowMs);
    return () => clearTimeout(off);
  }, [value]);
  return (
    <div className={`live-cell${glow ? " glow" : ""}${below ? " below" : ""}`}>
      <dt>{label}</dt>
      <dd className="live-value num">
        <Rolling value={value} />
      </dd>
      <dd className="live-note">{note}</dd>
    </div>
  );
}

function LiveStrip({ numbers }: { numbers: LiveNumbers | null }) {
  const L = HOME.live;
  if (!numbers) {
    return (
      <dl className="live-cells skel-row" aria-busy="true" data-testid="hero-loading">
        {[L.pooled, L.price, L.paid, L.kept].map((label) => (
          <div className="live-cell" key={label}>
            <dt>{label}</dt>
            <dd className="live-value num skel-text">00.00</dd>
            <dd className="live-note skel-text">000000000000</dd>
          </div>
        ))}
      </dl>
    );
  }
  const p = BigInt(numbers.price),
    launch = BigInt(numbers.launch);
  return (
    <dl className="live-cells" data-testid="home-stats">
      <Cell label={L.pooled} value={formatUsdc(numbers.pooled)} note={L.pooledNote} />
      <Cell label={L.price} value={price4(numbers.price)} note={L.priceNote(price4(numbers.launch), p === launch ? null : p > launch)} />
      <Cell label={L.paid} value={numbers.paid.toLocaleString("en-US")} note={L.paidNote} />
      <Cell label={L.kept} value={numbers.kept.toLocaleString("en-US")} note={L.keptNote} below />
    </dl>
  );
}

/** The home hero. `onWatch` scrolls to Watch a payment cross the line. */
export function Hero({ onJoin, onWatch }: { onJoin: () => void; onWatch: () => void }) {
  const { numbers, proof } = useLiveHero();
  const still = prefersReducedMotion();
  return (
    <section className={still ? "hero still" : "hero"} aria-labelledby="hero-title">
      <HeroCanvas />
      <div className="wrap hero-copy">
        <h1 className="hero-h1 rise-1" id="hero-title">
          {HOME.heroLead} {HOME.heroRest}.
        </h1>
        <p className="hero-sub rise-2">{HOME.sub}</p>
        <div className="actions rise-3">
          <button type="button" className="btn" onClick={onJoin}>
            {HOME.primary}
          </button>
          <button type="button" className="btn ghost" onClick={onWatch}>
            {HOME.secondary}
          </button>
        </div>
      </div>
      <section className="wrap hero-live" aria-label={HOME.live.label}>
        {DATA_SOURCE === "testnet" && (
          <p className="live-label">
            <span className="live-dot" aria-hidden="true" />
            {HOME.live.testnet}
          </p>
        )}
        <LiveStrip numbers={numbers} />
        <div className="live-proof-slot" aria-live="polite">
          {proof && (
            <p key={proof.key} className={`live-proof ${proof.side}`} data-testid="latest-proof">
              <span className="live-proof-dot" aria-hidden="true" />
              <span className="sr-only">{HOME.live.latest}: </span>
              <b className="live-who">{proof.who}</b>
              {proof.model && <span className="live-model">{proof.model}</span>}
              <span className="live-verdict">{proof.verdict}</span>
              {proof.amount && <span className="live-amount num">{proof.amount}</span>}
              {proof.explorer && (
                <a className="live-tx" href={proof.explorer} target="_blank" rel="noreferrer">
                  {HOME.live.view}
                </a>
              )}
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
