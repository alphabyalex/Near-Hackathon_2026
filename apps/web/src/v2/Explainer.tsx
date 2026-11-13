/**
 * "Watch a payment cross the line" (docs/design/v2/Explainer.dc.html): ten seconds, played once when
 * scrolled into view, then held on its last frame. A proven payment rises above the line and is paid; a
 * swapped-model payment is refused, drops below and is refunded.
 *
 * Two parts that share one clock: the words are real page text in the left column (each line comes in as
 * the story reaches it), and the diagram on the right is a canvas that carries only the line, the proof
 * ring and the two payments. Two stage layouts: 640 x 500 for a wide column, 390 x 340 for a phone.
 */
import { useCallback, useRef, type RefObject } from "react";
import { EXPLAINER } from "../brand";
import { boxOf, frozenFrame, useCanvasAnimation } from "./motion";
import { clamp01, easeInOut, easeOut, fitCanvas } from "./sphere";

/** Every time in the story, in seconds (the reference's draw(t)). */
export const TIMELINE = {
  end: 10.2,
  final: 10,
  line: 1,
  /** Payment 1: in from the left, checked at the ring, then up to the paid corner. */
  p1: { fadeIn: [0.9, 1.2], travel: [1, 2], hold: 3.9, exit: 0.8, colorAt: 3.9, colorFor: 0.6 },
  caption1: [1, 1.4, 2.2, 2.6],
  checks: [2.3, 2.75, 3.2],
  checksOut: [3.7, 4],
  pulse1: [2, 3.6],
  paid: [4.5, 4.9],
  paidSub: [4.7, 5.1],
  /** Payment 2: the swap. Checked, refused (the ring turns red), then it drops to the refund corner. */
  p2: { fadeIn: [4.8, 5.1], travel: [4.9, 5.9], hold: 7, exit: 0.8, colorAt: 6.4, colorFor: 0.3 },
  caption2: [4.9, 5.3, 6, 6.4],
  failed: [6.3, 6.6, 7.3, 7.6],
  pulse2: [5.9, 6.9],
  ringRed: [6.1, 0.2],
  ringBack: [7.2, 0.4],
  refused: [7.6, 8],
  refusedSub: [7.8, 8.2],
  closing: [8.6, 9.3],
} as const;

interface Layout {
  w: number;
  h: number;
  cx: number;
  cy: number;
  ringR: number;
  dotR: number;
  startX: number;
  label: number;
  end1: [number, number];
  end2: [number, number];
}

/** The diagram for a wide column. */
export const WIDE: Layout = { w: 640, h: 500, cx: 320, cy: 250, ringR: 26, dotR: 7, startX: 56, label: 14, end1: [572, 92], end2: [572, 408] };

/** The diagram for a phone. */
export const NARROW: Layout = { w: 390, h: 340, cx: 195, cy: 170, ringR: 20, dotR: 6, startX: 40, label: 13, end1: [344, 58], end2: [344, 282] };

/** Below this canvas width the phone diagram is used, scaled up to at most 1.4x. */
export const NARROW_BELOW = 560;
const NARROW_MAX_SCALE = 1.4;
const WIDE_MAX_SCALE = 1.15;

export function stageFor(width: number): { layout: Layout; scale: number } {
  if (width >= NARROW_BELOW) return { layout: WIDE, scale: Math.min(WIDE_MAX_SCALE, width / WIDE.w) };
  return { layout: NARROW, scale: Math.min(NARROW_MAX_SCALE, width / NARROW.w) };
}

const VIO = [123, 108, 255],
  RED = [255, 92, 115],
  WHITE = [245, 243, 247],
  VTXT = [165, 155, 255];
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: number[], b: number[], u: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * clamp01(u)));

/** Draws the diagram at time t on a canvas whose CSS size is w x h. */
export function drawExplainer(ctx: CanvasRenderingContext2D, t: number, layout: Layout, scale: number, offsetX: number): void {
  const L = layout,
    T = TIMELINE,
    E = EXPLAINER;
  ctx.save();
  ctx.translate(offsetX, 0);
  ctx.scale(scale, scale);
  const fade = (a: number, b: number) => clamp01((t - a) / (b - a));
  const { cx, cy } = L;
  const tan = Math.tan((-10 * Math.PI) / 180);
  const yl = (x: number) => cy + tan * (x - cx);

  // The line, drawn across in the first second.
  const p = easeInOut(t / T.line);
  ctx.strokeStyle = "rgba(167,157,176,0.7)";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, yl(0));
  ctx.lineTo(L.w * p, yl(L.w * p));
  ctx.stroke();

  const label = (s: string, x: number, y: number, a: number, align: CanvasTextAlign = "center") => {
    if (a <= 0) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = "#A79DB0";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.font = `500 ${L.label}px Geist, system-ui, sans-serif`;
    ctx.fillText(s, x, y);
    ctx.globalAlpha = 1;
  };
  const appear = fade(0.6, 1.2);
  label(E.start, L.startX, yl(L.startX) + 30, appear);
  label(E.ring, cx, cy + L.ringR + 24, appear);

  // The proof check ring at the centre: pulses while it checks, red while it refuses.
  let pulse = 0;
  let ringC = VIO;
  if (t >= T.pulse1[0] && t < T.pulse1[1] + 0.3) pulse = Math.min(clamp01((t - T.pulse1[0]) / 0.2), 1 - clamp01((t - T.pulse1[1]) / 0.3));
  if (t >= T.pulse2[0] && t < T.pulse2[1] + 0.3) pulse = Math.min(clamp01((t - T.pulse2[0]) / 0.2), 1 - clamp01((t - T.pulse2[1]) / 0.3));
  if (t >= T.ringRed[0] && t < T.ringBack[0] + T.ringBack[1]) ringC = mix(VIO, RED, (t - T.ringRed[0]) / T.ringRed[1]);
  if (t >= T.ringBack[0]) ringC = mix(RED, VIO, (t - T.ringBack[0]) / T.ringBack[1]);
  const rr = L.ringR * (1 + 0.1 * pulse);
  ctx.strokeStyle = rgba(ringC, 0.45 + 0.55 * pulse);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rgba(ringC, 0.08 + 0.12 * pulse);
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.fill();

  // Where the payments end up, named once they get there.
  label(E.aboveLabel, L.end1[0], L.end1[1] - 26, fade(T.paid[0], T.paid[1]));
  label(E.belowLabel, L.end2[0], L.end2[1] + 28, fade(T.refused[0], T.refused[1]));

  // The two payments.
  const dot = (x: number, y: number, col: number[], a: number) => {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = rgba(col, 0.7);
    ctx.shadowBlur = 10;
    ctx.fillStyle = rgba(col, 1);
    ctx.beginPath();
    ctx.arc(x, y, L.dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const sx = L.startX,
    sy = yl(L.startX);
  const P1 = T.p1,
    P2 = T.p2;
  let x1 = sx,
    y1 = sy;
  if (t < P1.travel[1]) {
    const u = easeInOut((t - P1.travel[0]) / (P1.travel[1] - P1.travel[0]));
    x1 = sx + (cx - sx) * u;
    y1 = sy + (cy - sy) * u;
  } else if (t < P1.hold) {
    x1 = cx;
    y1 = cy;
  } else {
    const u = easeOut((t - P1.hold) / P1.exit);
    x1 = cx + (L.end1[0] - cx) * u;
    y1 = cy + (L.end1[1] - cy) * u;
  }
  // Each payment leaves a path behind it once it has left the ring: up for the paid one, down for the refused one.
  const trail = (col: number[], from: [number, number], to: [number, number], curve: boolean, u: number) => {
    if (u <= 0) return;
    ctx.strokeStyle = rgba(col, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const k = (u * i) / 24;
      const x = from[0] + (to[0] - from[0]) * k;
      const y = from[1] + (to[1] - from[1]) * (curve ? k * k : k);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  trail(VTXT, [cx, cy], L.end1, false, t < P1.hold ? 0 : easeOut((t - P1.hold) / P1.exit));
  trail(RED, [cx, cy], L.end2, true, t < P2.hold ? 0 : clamp01((t - P2.hold) / P2.exit));
  dot(x1, y1, mix(WHITE, VTXT, (t - P1.colorAt) / P1.colorFor), fade(P1.fadeIn[0], P1.fadeIn[1]));
  let x2 = sx,
    y2 = sy;
  if (t < P2.travel[1]) {
    const u = easeInOut((t - P2.travel[0]) / (P2.travel[1] - P2.travel[0]));
    x2 = sx + (cx - sx) * u;
    y2 = sy + (cy - sy) * u;
  } else if (t < P2.hold) {
    x2 = cx;
    y2 = cy;
  } else {
    const u = clamp01((t - P2.hold) / P2.exit);
    x2 = cx + (L.end2[0] - cx) * u;
    y2 = cy + (L.end2[1] - cy) * u * u;
  }
  dot(x2, y2, mix(WHITE, RED, (t - P2.colorAt) / P2.colorFor), fade(P2.fadeIn[0], P2.fadeIn[1]));
  ctx.restore();
}

/** The words keep time with the diagram: each line switches on when the story reaches it. */
const STEPS: readonly [string, number][] = [
  ["s1", TIMELINE.caption1[0]],
  ["c1", TIMELINE.checks[0]],
  ["c2", TIMELINE.checks[1]],
  ["c3", TIMELINE.checks[2]],
  ["r1", TIMELINE.paid[0]],
  ["s2", TIMELINE.caption2[0]],
  ["f2", TIMELINE.failed[0]],
  ["r2", TIMELINE.refused[0]],
  ["fin", TIMELINE.closing[0]],
];
export function syncSteps(el: HTMLElement, t: number): void {
  for (const [name, at] of STEPS) el.classList.toggle(`on-${name}`, t >= at);
}

function Stage({ host }: { host: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const freezeAt = frozenFrame("explainer");
  const draw = useCallback(
    (t: number) => {
      if (host.current) syncSteps(host.current, t);
      const cv = ref.current;
      if (!cv) return;
      const { w } = boxOf(cv);
      if (!w) return;
      const { layout, scale } = stageFor(w);
      const h = Math.round(layout.h * scale);
      if (cv.style.height !== `${h}px`) cv.style.height = `${h}px`;
      const ctx = fitCanvas(cv, w, h);
      if (!ctx) return;
      const ox = Math.max(0, (w - layout.w * scale) / 2);
      drawExplainer(ctx, t, layout, scale, ox);
    },
    [host],
  );
  useCanvasAnimation(ref, draw, { duration: TIMELINE.end, finalAt: TIMELINE.final, startOnView: true, freezeAt });
  return <canvas ref={ref} className="explainer-stage" role="img" aria-label={EXPLAINER.label} data-testid="explainer-stage" />;
}

const Tick = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 9.5l3.5 3.5 7.5-8" />
  </svg>
);
const Cross = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </svg>
);

/** The section: the words on the left, the diagram on the right. `id` lets the hero's secondary button scroll here. */
export function Explainer({ id = "watch", headingLevel = 2 }: { id?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const host = useRef<HTMLDivElement>(null);
  return (
    <section className="sec explainer" id={id} aria-labelledby={`${id}-title`} tabIndex={-1}>
      <div className="wrap">
        <div className="explainer-head">
          <H className="h2" id={`${id}-title`}>
            {EXPLAINER.title}
          </H>
          <p className="lede">{EXPLAINER.sub}</p>
        </div>
      </div>
      <div className="wrap">
        <div className="watch" ref={host}>
          <ol className="watch-steps">
            <li className="wstep one">
              <h3>{EXPLAINER.caption1}</h3>
              <ul className="wchecks">
                {EXPLAINER.checks.map((c, i) => (
                  <li key={c} data-k={`c${i + 1}`}>
                    <Tick />
                    {c}
                  </li>
                ))}
              </ul>
              <p className="wresult" data-k="r1">
                <b>{EXPLAINER.paid}</b>
                {EXPLAINER.paidSub}
              </p>
            </li>
            <li className="wstep two">
              <h3>{EXPLAINER.caption2}</h3>
              <ul className="wchecks">
                <li className="fail" data-k="f2">
                  <Cross />
                  {EXPLAINER.failed}
                </li>
              </ul>
              <p className="wresult below" data-k="r2">
                <b>{EXPLAINER.refused}</b>
                {EXPLAINER.refusedSub}
              </p>
            </li>
          </ol>
          <div className="watch-visual">
            <Stage host={host} />
          </div>
          <p className="watch-close" data-k="fin">
            {EXPLAINER.closing}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Where the money goes: its own section, after the diagram. */
export function Outcomes() {
  return (
    <section className="sec outcomes" aria-labelledby="outcomes-title">
      <div className="wrap">
        <h2 className="h2" id="outcomes-title">
          {EXPLAINER.outcomesTitle}
        </h2>
        <div className="outcome-cols">
          {EXPLAINER.columns.map(([title, body, side]) => (
            <div key={title} className={`outcome ${side}`}>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
