/**
 * "Watch a payment cross the line" (docs/design/v2/Explainer.dc.html): ten seconds, played once when
 * scrolled into view, then held on its last frame. A proven payment rises above the line and is paid; a swapped-model
 * payment is refused, drops below and is refunded. Two layouts: the reference's 1440 x 520 stage
 * (scaled down to 1000px), and a phone stage whose text is wrapped and placed clear of the line.
 */
import { useCallback, useRef } from "react";
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

interface Text {
  x: number;
  y: number;
  size: number;
  /** Wrap width; lines go down from y by `lh`. */
  maxW?: number;
  align?: CanvasTextAlign;
}
interface Layout {
  w: number;
  h: number;
  cx: number;
  cy: number;
  ringR: number;
  dotR: number;
  startX: number;
  lh: number;
  caption: Text;
  checks: { iconX: number; textX: number; y0: number; dy: number; size: number; maxW: number };
  failedY: number;
  paid: Text;
  paidSub: Text;
  refused: Text;
  refusedSub: Text;
  end1: [number, number];
  end2: [number, number];
  closing: Text;
}

/** The reference stage, 1440 x 520. */
export const WIDE: Layout = {
  w: 1440,
  h: 520,
  cx: 720,
  cy: 260,
  ringR: 26,
  dotR: 8,
  startX: 100,
  lh: 1.3,
  caption: { x: 100, y: 410, size: 17 },
  checks: { iconX: 790, textX: 812, y0: 112, dy: 32, size: 17, maxW: 600 },
  failedY: 144,
  paid: { x: 1160, y: 58, size: 26, align: "right" },
  paidSub: { x: 1160, y: 90, size: 16, align: "right" },
  refused: { x: 1160, y: 440, size: 26, align: "right" },
  refusedSub: { x: 1160, y: 472, size: 16, align: "right" },
  end1: [1200, 74],
  end2: [1200, 456],
  closing: { x: 56, y: 488, size: 28 },
};

/** The phone stage, 390 x 650: results on the left, the dots end on the right, every line wrapped. */
export const NARROW: Layout = {
  w: 390,
  h: 650,
  cx: 195,
  cy: 300,
  ringR: 22,
  dotR: 7,
  startX: 20,
  lh: 1.35,
  caption: { x: 20, y: 390, size: 15, maxW: 340 },
  checks: { iconX: 34, textX: 52, y0: 140, dy: 34, size: 15, maxW: 318 },
  failedY: 174,
  paid: { x: 20, y: 46, size: 22 },
  paidSub: { x: 20, y: 76, size: 14, maxW: 300 },
  refused: { x: 20, y: 500, size: 22 },
  refusedSub: { x: 20, y: 530, size: 14, maxW: 300 },
  end1: [362, 52],
  end2: [362, 506],
  closing: { x: 20, y: 592, size: 22, maxW: 340 },
};

/** Below this width the phone stage is used, scaled up to at most 1.4x. */
export const NARROW_BELOW = 1000;
const NARROW_MAX_SCALE = 1.4;

export function stageFor(width: number): { layout: Layout; scale: number } {
  if (width >= NARROW_BELOW) return { layout: WIDE, scale: Math.min(1, width / WIDE.w) };
  return { layout: NARROW, scale: Math.min(NARROW_MAX_SCALE, width / NARROW.w) };
}

const VIO = [123, 108, 255],
  RED = [255, 92, 115],
  WHITE = [245, 243, 247],
  VTXT = [165, 155, 255];
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: number[], b: number[], u: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * clamp01(u)));

function wrap(ctx: CanvasRenderingContext2D, s: string, maxW: number | undefined): string[] {
  if (!maxW) return [s];
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      out.push(line);
      line = word;
    } else line = next;
  }
  out.push(line);
  return out;
}

/** Draws the story at time t on a canvas whose CSS size is w x h. */
export function drawExplainer(ctx: CanvasRenderingContext2D, t: number, layout: Layout, scale: number, offsetX: number): void {
  const L = layout,
    T = TIMELINE;
  ctx.save();
  ctx.translate(offsetX, 0);
  ctx.scale(scale, scale);
  const fade = (a: number, b: number, c?: number, d?: number) => Math.min(clamp01((t - a) / (b - a)), c === undefined || d === undefined ? 1 : 1 - clamp01((t - c) / (d - c)));
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

  // The proof check ring at the centre: pulses while it checks, red while it refuses.
  let pulse = 0;
  let ringC = VIO;
  if (t >= T.pulse1[0] && t < T.pulse1[1] + 0.3) pulse = Math.min(clamp01((t - T.pulse1[0]) / 0.2), 1 - clamp01((t - T.pulse1[1]) / 0.3));
  if (t >= T.pulse2[0] && t < T.pulse2[1] + 0.3) pulse = Math.min(clamp01((t - T.pulse2[0]) / 0.2), 1 - clamp01((t - T.pulse2[1]) / 0.3));
  if (t >= T.ringRed[0] && t < T.ringBack[0] + T.ringBack[1]) ringC = mix(VIO, RED, (t - T.ringRed[0]) / T.ringRed[1]);
  if (t >= T.ringBack[0]) ringC = mix(RED, VIO, (t - T.ringBack[0]) / T.ringBack[1]);
  const rr = L.ringR * (1 + 0.12 * pulse);
  ctx.save();
  ctx.shadowColor = rgba(ringC, pulse);
  ctx.shadowBlur = 22 * pulse;
  ctx.strokeStyle = rgba(ringC, 0.35 + 0.65 * pulse);
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = rgba(ringC, 0.08 + 0.12 * pulse);
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.fill();

  const text = (s: string, at: Text, weight: number, col: string, a: number) => {
    if (a <= 0) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.textAlign = at.align ?? "left";
    ctx.textBaseline = "middle";
    ctx.font = `${weight} ${at.size}px Geist, system-ui, sans-serif`;
    wrap(ctx, s, at.maxW).forEach((line, i) => ctx.fillText(line, at.x, at.y + i * at.size * L.lh));
    ctx.globalAlpha = 1;
  };
  const icon = (kind: "check" | "cross", x: number, y: number, u: number, col: string, a: number) => {
    if (a <= 0 || u <= 0) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (kind === "check") {
      const k1 = Math.min(1, u * 1.6);
      ctx.moveTo(x - 9, y + 1);
      ctx.lineTo(x - 9 + 6 * k1, y + 1 + 6 * k1);
      if (u > 0.62) ctx.lineTo(x - 3 + 12 * clamp01((u - 0.62) / 0.38), y + 7 - 14 * clamp01((u - 0.62) / 0.38));
    } else {
      const a1 = clamp01(u * 2),
        b1 = clamp01(u * 2 - 1);
      ctx.moveTo(x - 7, y - 7);
      ctx.lineTo(x - 7 + 14 * a1, y - 7 + 14 * a1);
      if (b1 > 0) {
        ctx.moveTo(x + 7, y - 7);
        ctx.lineTo(x + 7 - 14 * b1, y - 7 + 14 * b1);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const E = EXPLAINER;
  text(E.caption1, L.caption, 400, "#C3BACB", fade(T.caption1[0], T.caption1[1], T.caption1[2], T.caption1[3]));
  text(E.caption2, L.caption, 400, "#C3BACB", fade(T.caption2[0], T.caption2[1], T.caption2[2], T.caption2[3]));
  const C = L.checks;
  E.checks.forEach((s, i) => {
    const y = C.y0 + i * C.dy,
      start = T.checks[i]!,
      a = fade(start, start + 0.3, T.checksOut[0], T.checksOut[1]);
    icon("check", C.iconX, y, easeOut((t - start) / 0.3), "#A59BFF", a);
    text(s, { x: C.textX, y, size: C.size, maxW: C.maxW }, 500, "#F5F3F7", a);
  });
  const fa = fade(T.failed[0], T.failed[1], T.failed[2], T.failed[3]);
  icon("cross", C.iconX, L.failedY, easeOut((t - T.failed[0]) / 0.3), "#FF7A8C", fa);
  text(E.failed, { x: C.textX, y: L.failedY, size: C.size, maxW: C.maxW }, 500, "#FF7A8C", fa);
  text(E.paid, L.paid, 700, "#F5F3F7", fade(T.paid[0], T.paid[1]));
  text(E.paidSub, L.paidSub, 400, "#A79DB0", fade(T.paidSub[0], T.paidSub[1]));
  text(E.refused, L.refused, 700, "#FF7A8C", fade(T.refused[0], T.refused[1]));
  text(E.refusedSub, L.refusedSub, 400, "#A79DB0", fade(T.refusedSub[0], T.refusedSub[1]));
  text(E.closing, L.closing, 700, "#F5F3F7", fade(T.closing[0], T.closing[1]));

  // The two payments.
  const dot = (x: number, y: number, col: number[], a: number) => {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = rgba(col, 0.9);
    ctx.shadowBlur = 20;
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

/** The closing line starts at the title's left edge, wherever the column sits (J). Stage units, or null. */
function closingX(cv: HTMLCanvasElement, titleId: string, ox: number, scale: number): number | null {
  const title = document.getElementById(titleId);
  if (!title) return null;
  const left = title.getBoundingClientRect().left - cv.getBoundingClientRect().left;
  return Number.isFinite(left) && left >= 0 ? (left - ox) / scale : null;
}

function Stage({ titleId }: { titleId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const freezeAt = frozenFrame("explainer");
  const draw = useCallback((t: number) => {
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
    const x = closingX(cv, titleId, ox, scale);
    drawExplainer(ctx, t, x === null ? layout : { ...layout, closing: { ...layout.closing, x } }, scale, ox);
  }, [titleId]);
  useCanvasAnimation(ref, draw, { duration: TIMELINE.end, finalAt: TIMELINE.final, startOnView: true, freezeAt });
  return <canvas ref={ref} className="explainer-stage" role="img" aria-label={EXPLAINER.label} data-testid="explainer-stage" />;
}

/** The section. `id` lets the hero's secondary button scroll here. */
export function Explainer({ id = "watch", headingLevel = 2 }: { id?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="explainer" id={id} aria-labelledby={`${id}-title`} tabIndex={-1}>
      <div className="wrap explainer-head">
        <div>
          <H className="h2" id={`${id}-title`}>
            {EXPLAINER.title}
          </H>
          <p className="explainer-sub">{EXPLAINER.sub}</p>
        </div>
      </div>
      <div className="explainer-frame">
        <Stage titleId={`${id}-title`} />
      </div>
      {/* The canvas, as text: the same story in order. */}
      <ol className="sr-only">
        <li>{EXPLAINER.caption1}. {EXPLAINER.checks.join(". ")}. {EXPLAINER.paid}: {EXPLAINER.paidSub}.</li>
        <li>{EXPLAINER.caption2}. {EXPLAINER.failed}. {EXPLAINER.refused}: {EXPLAINER.refusedSub}.</li>
        <li>{EXPLAINER.closing}</li>
      </ol>
      <div className="wrap">
        <div className="explainer-cols">
          {EXPLAINER.columns.map(([title, body, side]) => (
            <div key={title}>
              <h3 className={side === "below" ? "below-text" : undefined}>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
