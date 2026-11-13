/**
 * "Watch a payment cross the line" (docs/design/v2/Explainer.dc.html): about seven seconds, played once when
 * scrolled into view, then held on its last frame. A payment rides the line through three gates (the
 * receipt, the payee, the budget); the proven one rises above the line and is paid, with 2% peeling off
 * to the pool. A swapped-model payment fails the first gate, drops below the line, and its money is
 * refunded to the budget it came from.
 *
 * Two parts that share one clock: the words are real page text in the left column (each line comes in as
 * the story reaches it), and the diagram on the right is a canvas. Two layouts: 640 x 500 for a wide
 * column, 390 x 340 for a phone.
 */
import { useCallback, useRef, type RefObject } from "react";
import { EXPLAINER } from "../brand";
import { boxOf, frozenFrame, useCanvasAnimation, useInView } from "./motion";
import { clamp01, easeInOut, easeOut, fitCanvas } from "./sphere";

/** The story's beats in the seconds they were drawn at; TIMELINE plays them at SPEED. */
const SPEED = 0.7;
const sec = (x: number) => Math.round(x * SPEED * 1000) / 1000;

type Pair = readonly [number, number];
type Trio = readonly [number, number, number];

/** Every time in the story, in seconds. */
export const TIMELINE: {
  end: number;
  final: number;
  line: number;
  caption1: Pair;
  arrive1: Trio;
  checks: Trio;
  go1: Pair;
  exit1: Pair;
  paid: Pair;
  pool: Pair;
  caption2: Pair;
  go2: Pair;
  failed: Pair;
  exit2: Pair;
  refused: Pair;
  refund: Pair;
  closing: Pair;
} = {
  end: sec(9.4),
  final: sec(9.2),
  line: sec(1),
  /** The words: a payment is introduced, passes each gate, and is paid. */
  caption1: [sec(0.9), sec(1.3)],
  /** When payment 1 arrives at each gate. */
  arrive1: [sec(1.7), sec(2.5), sec(3.3)],
  /** When each gate's check is drawn (a moment after the payment arrives). */
  checks: [sec(1.75), sec(2.55), sec(3.35)],
  /** Payment 1 leaves the start, and later the last gate for the paid side. */
  go1: [sec(0.9), sec(1.7)],
  exit1: [sec(3.6), sec(4.4)],
  paid: [sec(4.4), sec(4.8)],
  pool: [sec(4.5), sec(5.2)],
  /** Payment 2: the swap. It fails the first gate, then drops to the refund side. */
  caption2: [sec(4.9), sec(5.3)],
  go2: [sec(5), sec(5.8)],
  failed: [sec(5.85), sec(6.15)],
  exit2: [sec(6.3), sec(7.1)],
  refused: [sec(7.1), sec(7.5)],
  refund: [sec(7.5), sec(8.5)],
  closing: [sec(8.6), sec(9.2)],
};

interface Layout {
  w: number;
  h: number;
  /** Where the line crosses the middle of the stage. */
  cx: number;
  cy: number;
  ringR: number;
  dotR: number;
  startX: number;
  /** The x of each gate along the line. */
  gates: [number, number, number];
  label: number;
  /** The paid end, its small pool dot, and the refused end. */
  end1: [number, number];
  pool: [number, number];
  end2: [number, number];
  /** How far a path runs along the line before it bends away. */
  bend: number;
}

/** The diagram for a wide column. */
export const WIDE: Layout = { w: 640, h: 500, cx: 320, cy: 260, ringR: 15, dotR: 7, startX: 44, gates: [150, 250, 350], label: 14, end1: [556, 100], pool: [556, 156], end2: [556, 420], bend: 80 };

/** The diagram for a phone. */
export const NARROW: Layout = { w: 390, h: 340, cx: 195, cy: 170, ringR: 12, dotR: 6, startX: 26, gates: [96, 156, 216], label: 12, end1: [330, 56], pool: [330, 100], end2: [330, 284], bend: 46 };

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
  VTXT = [165, 155, 255],
  GREY = [167, 157, 176];
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: number[], b: number[], u: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * clamp01(u)));

type Pt = [number, number];
const lerp = (a: Pt, b: Pt, u: number): Pt => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
function cubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, u: number): Pt {
  const v = 1 - u;
  const k = [v * v * v, 3 * u * v * v, 3 * u * u * v, u * u * u];
  return [k[0]! * p0[0] + k[1]! * c1[0] + k[2]! * c2[0] + k[3]! * p3[0], k[0]! * p0[1] + k[1]! * c1[1] + k[2]! * c2[1] + k[3]! * p3[1]];
}

/** Everything the diagram needs from a layout: the line, each gate's centre and the two bent paths. */
function geometry(L: Layout) {
  const tan = Math.tan((-10 * Math.PI) / 180);
  const yl = (x: number) => L.cy + tan * (x - L.cx);
  const at = (x: number): Pt => [x, yl(x)];
  const start = at(L.startX);
  const gates = L.gates.map(at) as [Pt, Pt, Pt];
  // A path leaves the line heading the same way, then bends to its end.
  const bendFrom = (g: Pt, end: Pt): [Pt, Pt] => [[g[0] + L.bend, g[1] - L.bend * 0.18], [end[0] - (end[0] - g[0]) * 0.35, end[1]]];
  const [r1, r2] = bendFrom(gates[2], L.end1);
  const [d1, d2] = bendFrom(gates[0], L.end2);
  const refundEnd: Pt = [start[0] + 2, start[1] + L.dotR + 8];
  return {
    yl,
    start,
    gates,
    rise: { p0: gates[2], c1: r1, c2: r2, p3: L.end1 },
    drop: { p0: gates[0], c1: d1, c2: d2, p3: L.end2 },
    refund: { p0: L.end2, c1: [L.end2[0] - 150, L.end2[1] + 64] as Pt, c2: [start[0] + 130, start[1] + 150] as Pt, p3: refundEnd },
  };
}

interface Seg {
  t0: number;
  t1: number;
  a: Pt;
  b: Pt;
  curve?: (u: number) => Pt;
}
/** Where a payment is at time t: it waits at the end of one segment until the next begins. */
function along(segs: Seg[], t: number): Pt {
  const first = segs[0]!;
  if (t <= first.t0) return first.a;
  for (const s of segs) {
    if (t < s.t0) return s.a;
    if (t <= s.t1) {
      const u = (t - s.t0) / (s.t1 - s.t0);
      return s.curve ? s.curve(easeInOut(u)) : lerp(s.a, s.b, easeInOut(u));
    }
  }
  return segs[segs.length - 1]!.b;
}

/** Draws the diagram at time t on a canvas whose CSS size is w x h. */
export function drawExplainer(ctx: CanvasRenderingContext2D, t: number, layout: Layout, scale: number, offsetX: number): void {
  const L = layout,
    T = TIMELINE,
    E = EXPLAINER;
  const G = geometry(L);
  ctx.save();
  ctx.translate(offsetX, 0);
  ctx.scale(scale, scale);
  const fade = (a: number, b: number) => clamp01((t - a) / (b - a));

  // The line, drawn across in the first second.
  const p = easeInOut(t / T.line);
  ctx.strokeStyle = "rgba(167,157,176,0.7)";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0, G.yl(0));
  ctx.lineTo(L.w * p, G.yl(L.w * p));
  ctx.stroke();

  const label = (s: string, x: number, y: number, a: number, align: CanvasTextAlign = "center", col = "#A79DB0") => {
    if (a <= 0) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.font = `500 ${L.label}px Geist, system-ui, sans-serif`;
    ctx.fillText(s, x, y);
    ctx.globalAlpha = 1;
  };
  const appear = fade(sec(0.5), sec(1.1));
  label(E.start, G.start[0] + 8, G.start[1] - 28, appear);

  // The three gates. Payment 1 ticks each; payment 2 turns the first red and crosses it out.
  const tick = (cx: number, cy: number, u: number, r: number, col: string, a: number) => {
    if (u <= 0 || a <= 0) return;
    const k = r / 15;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const a1 = clamp01(u * 1.6);
    ctx.moveTo(cx - 5.5 * k, cy + 0.5 * k);
    ctx.lineTo(cx - 5.5 * k + 3.5 * k * a1, cy + 0.5 * k + 3.5 * k * a1);
    if (u > 0.62) {
      const b = clamp01((u - 0.62) / 0.38);
      ctx.lineTo(cx - 2 * k + 7.5 * k * b, cy + 4 * k - 8.5 * k * b);
    }
    ctx.stroke();
    ctx.restore();
  };
  const cross = (cx: number, cy: number, u: number, r: number, col: string) => {
    if (u <= 0) return;
    const k = r / 15;
    const a1 = clamp01(u * 2),
      b1 = clamp01(u * 2 - 1);
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - 4.5 * k, cy - 4.5 * k);
    ctx.lineTo(cx - 4.5 * k + 9 * k * a1, cy - 4.5 * k + 9 * k * a1);
    if (b1 > 0) {
      ctx.moveTo(cx + 4.5 * k, cy - 4.5 * k);
      ctx.lineTo(cx + 4.5 * k - 9 * k * b1, cy - 4.5 * k + 9 * k * b1);
    }
    ctx.stroke();
    ctx.restore();
  };
  G.gates.forEach((g, i) => {
    const passed = clamp01((t - T.checks[i]!) / 0.28 / SPEED);
    const arrived = T.arrive1[i]!;
    let pulse = t >= arrived && t < arrived + 0.35 ? Math.sin(((t - arrived) / 0.35) * Math.PI) : 0;
    let colour = mix(GREY, VTXT, passed);
    let failed = 0;
    if (i === 0) {
      failed = clamp01((t - T.failed[0]) / 0.25);
      if (t >= T.go2[1] && t < T.go2[1] + 0.4) pulse = Math.max(pulse, Math.sin(((t - T.go2[1]) / 0.4) * Math.PI));
      if (failed > 0) colour = mix(VTXT, RED, failed);
    }
    const r = L.ringR * (1 + 0.12 * pulse);
    ctx.strokeStyle = rgba(colour, 0.55 + 0.45 * Math.max(passed, pulse));
    ctx.lineWidth = 1.6;
    ctx.fillStyle = rgba(colour, 0.06 + 0.1 * Math.max(passed, pulse));
    ctx.beginPath();
    ctx.arc(g[0], g[1], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    tick(g[0], g[1], passed, L.ringR, rgba(colour, 1), 1 - failed);
    if (i === 0) cross(g[0], g[1], failed, L.ringR, "#FF7A8C");
    label(E.gates[i]!, g[0], g[1] - L.ringR - 18, appear);
  });

  // The paths each payment leaves behind once it has left the line.
  const stroke = (col: number[], a: number, pts: Pt[]) => {
    ctx.strokeStyle = rgba(col, a);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1])));
    ctx.stroke();
  };
  const sample = (f: (u: number) => Pt, u: number): Pt[] => Array.from({ length: 31 }, (_, i) => f((u * i) / 30));
  const rise = (u: number) => cubic(G.rise.p0, G.rise.c1, G.rise.c2, G.rise.p3, u);
  const drop = (u: number) => cubic(G.drop.p0, G.drop.c1, G.drop.c2, G.drop.p3, u);
  const u1 = easeInOut(clamp01((t - T.exit1[0]) / (T.exit1[1] - T.exit1[0])));
  const u2 = easeInOut(clamp01((t - T.exit2[0]) / (T.exit2[1] - T.exit2[0])));
  if (u1 > 0) stroke(VTXT, 0.55, sample(rise, u1));
  if (u2 > 0) stroke(RED, 0.55, sample(drop, u2));

  // The refunded money finds its way back to the budget it came from.
  const rf = easeInOut(clamp01((t - T.refund[0]) / (T.refund[1] - T.refund[0])));
  const back = (u: number) => cubic(G.refund.p0, G.refund.c1, G.refund.c2, G.refund.p3, u);
  if (rf > 0) {
    ctx.save();
    ctx.setLineDash([5, 6]);
    stroke(RED, 0.7, sample(back, rf));
    ctx.restore();
    if (rf >= 1) {
      const a = back(0.97),
        b = back(1);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.save();
      ctx.translate(b[0], b[1]);
      ctx.rotate(ang);
      ctx.strokeStyle = rgba(RED, 0.9);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-8, -5);
      ctx.lineTo(0, 0);
      ctx.lineTo(-8, 5);
      ctx.stroke();
      ctx.restore();
    }
    const mid = back(0.5);
    label(E.refundLabel, mid[0], mid[1] + 24, fade(T.refund[0] + 0.25, T.refund[1]), "center", "#FF7A8C");
  }

  // Where the payments end up, named once they get there.
  label(E.aboveLabel, L.end1[0], L.end1[1] - 26, fade(T.paid[0], T.paid[1]));
  label(E.belowLabel, L.end2[0], L.end2[1] - 28, fade(T.refused[0], T.refused[1]));

  const dot = (x: number, y: number, r: number, col: number[], a: number) => {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = rgba(col, 0.7);
    ctx.shadowBlur = 10;
    ctx.fillStyle = rgba(col, 1);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const [g1, g2, g3] = G.gates;
  const line1: Seg[] = [
    { t0: T.go1[0], t1: T.arrive1[0], a: G.start, b: g1 },
    { t0: T.arrive1[0] + 0.3, t1: T.arrive1[1], a: g1, b: g2 },
    { t0: T.arrive1[1] + 0.3, t1: T.arrive1[2], a: g2, b: g3 },
    { t0: T.exit1[0], t1: T.exit1[1], a: g3, b: L.end1, curve: (u) => rise(u) },
  ];
  const line2: Seg[] = [
    { t0: T.go2[0], t1: T.go2[1], a: G.start, b: g1 },
    { t0: T.exit2[0], t1: T.exit2[1], a: g1, b: L.end2, curve: (u) => drop(u) },
  ];
  const q1 = along(line1, t);
  dot(q1[0], q1[1], L.dotR, mix(WHITE, VTXT, (t - T.exit1[0]) / 0.4), fade(T.go1[0] - 0.1, T.go1[0] + 0.15));
  const q2 = along(line2, t);
  dot(q2[0], q2[1], L.dotR, mix(WHITE, RED, (t - T.failed[0]) / 0.3), fade(T.go2[0] - 0.1, T.go2[0] + 0.15));

  // 2% of the paid amount peels off to the pool.
  const pf = easeOut(clamp01((t - T.pool[0]) / (T.pool[1] - T.pool[0])));
  if (pf > 0) {
    const q = lerp(L.end1, L.pool, pf);
    dot(q[0], q[1], L.dotR * 0.6, VTXT, 1);
    label(E.poolLabel, L.pool[0], L.pool[1] + 24, fade(T.pool[1] - 0.2, T.pool[1] + 0.2));
  }
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

/** The three ways a payment can end, each with a small diagram of where the money goes. */
function OutcomeVisual({ kind }: { kind: "paid" | "refunded" | "covered" }) {
  const V = EXPLAINER.visual;
  if (kind === "paid")
    return (
      <div className="ovis">
        <div className="obar">
          <span className="oseg prov" style={{ flexBasis: "98%" }} />
          <span className="oseg pool" style={{ flexBasis: "2%" }} />
        </div>
        <p className="ocap">
          <span>{V.provider}</span>
          <span>{V.pool}</span>
        </p>
      </div>
    );
  if (kind === "refunded")
    return (
      <div className="ovis">
        <div className="obar back">
          <span className="oseg red" style={{ flexBasis: "100%" }} />
        </div>
        <p className="ocap">
          <span>{V.stays}</span>
        </p>
      </div>
    );
  return (
    <div className="ovis">
      <div className="obar">
        <span className="oseg stake" style={{ flexBasis: "34%" }} />
        <span className="oseg ward" style={{ flexBasis: "66%" }} />
      </div>
      <p className="ocap">
        <span>{V.stake}</span>
        <span>{V.holders}</span>
      </p>
    </div>
  );
}

/** Where the money goes: its own section, after the diagram. */
export function Outcomes() {
  const [ref, seen] = useInView<HTMLDivElement>();
  const kinds = ["paid", "refunded", "covered"] as const;
  return (
    <section className="sec outcomes" aria-labelledby="outcomes-title">
      <div className="wrap">
        <h2 className="h2" id="outcomes-title">
          {EXPLAINER.outcomesTitle}
        </h2>
        <div className="outcome-cols" ref={ref} data-inview={seen || undefined}>
          {EXPLAINER.columns.map(([title, body, side], i) => (
            <div key={title} className={`outcome ${side}`} style={{ ["--i" as string]: i }}>
              <OutcomeVisual kind={kinds[i]!} />
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
