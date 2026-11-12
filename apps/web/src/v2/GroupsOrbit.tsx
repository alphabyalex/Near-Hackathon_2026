/**
 * The orbit (docs/design/v2/GroupsOrbit.dc.html): every group and solo builder sits on one tilted (-10°)
 * dotted orbit, depth-scaled, with back bodies small and faded. Choosing one (a click, the arrows, the
 * arrow keys, or a swipe on a phone) turns the orbit with easing until it reaches the front, where it
 * grows to its true size (by proven calls, density by tier) and assembles. It moves only when a person
 * acts, never on a loop, and nothing follows the mouse. Every sphere comes from sphere.ts.
 */
import "./orbit.css";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { GroupSummary } from "../api/ai";
import { ORBIT, REP } from "../brand";
import { feeText } from "../components/TierBadge";
import { NEAR_NETWORK } from "../config";
import { boxOf, frozenFrame, useCanvasAnimation } from "./motion";
import { clamp01, easeOut, fitCanvas, groupSphere, LIGHT, paintDots, sphereDots, type Tier } from "./sphere";

/** Every number you might tune: layout, sizes, fades, timings (seconds) and the drawing colours. */
export const ORBIT_MOTION = {
  tiltDeg: -10,
  /** The overlays and the orbit sit in a frame at most this wide, centred in the full-bleed stage. */
  frameMax: 1440,
  /** Below this canvas width the orbit uses the phone layout. Matches orbit.css. */
  phoneBelow: 720,
  /** Desktop orbit, as fractions of the frame (the reference's 860, 470 and 150 on 1440 by 900; a little higher, clear of the panel). */
  desktop: { cx: 860 / 1440, cy: 0.47, rx: 470 / 1440, ryOfRx: 150 / 470, refW: 1440, refH: 900, minScale: 0.62, maxScale: 1.12 },
  /** Narrow desktops (up to 1100px, see orbit.css): the orbit moves up and right, clear of the panel. */
  narrow: { below: 1100, cx: 0.63, cy: 0.41 },
  /** Phone orbit, as fractions of the canvas. */
  phone: { cx: 0.5, cy: 0.42, rx: 0.42, ryOfRx: 0.36, scaleOfW: 1 / 860, minScale: 0.36, maxScale: 0.5 },
  /** The front body is its true size times this; back bodies shrink to backMin plus backRange times depth. */
  frontScale: 1.2,
  backMin: 0.28,
  backRange: 0.42,
  /** The front body sits this many radii above its point on the orbit. */
  frontLift: 0.55,
  /** The front body grows from this share of its size as it assembles. */
  arriveFrom: 0.55,
  /** Back bodies: opacity from backAlpha to backAlpha plus backAlphaRange as they come forward. */
  backAlpha: 0.35,
  backAlphaRange: 0.55,
  /** Smallest dot spacing and line gap for a shrunken body, in CSS pixels. */
  minStep: 4,
  minGap: 2,
  /** Timings: the turn, then the assembly at the front. */
  rotate: 0.9,
  assembleDelay: 0.3,
  assemble: 0.9,
  fps: 30,
  /** A tap within this many pixels of a small body still picks it. */
  hitMin: 26,
  /** A swipe is at least this far sideways, and more sideways than down. */
  swipeMin: 40,
  /** Labels under back bodies. */
  label: { size: 11, sizeRange: 3, gap: 18, alpha: 0.4, alphaRange: 0.6, maxChars: 28, phoneChars: 14, phoneNear: 0.8 },
  frontRank: { size: 13, gap: 24 },
  colors: {
    orbit: "rgba(167,157,176,0.22)",
    dash: [2, 6] as number[],
    line: "rgba(167,157,176,0.45)",
    label: "#C3BACB",
    labelHover: "#F5F3F7",
    rank: "#A59BFF",
  },
  font: "Geist, system-ui, sans-serif",
} as const;

export type OrbitFilter = "all" | "groups" | "solo";
export const FILTERS: readonly OrbitFilter[] = ["all", "groups", "solo"];

/** One body on the orbit: a group, or a solo builder. */
export interface OrbitEntry {
  id: string;
  name: string;
  owner: string;
  solo: boolean;
  members: number;
  tier: Tier;
  calls: number;
  refused: number;
  feeBps: number;
  clean: number;
  nextAt: number | null;
  /** 1 for the most proven calls on the whole network, whatever the filter. */
  rank: number;
}

const SOLO_NAME = /\s*\(solo\)\s*$/i;
/**
 * A solo builder is a community of one: /v1/communities gives it members_count 1 (members here), an
 * id of bgt_ind_<name> and a name like "Ivan (solo)". Any one of these is enough.
 */
export const isSolo = (g: Pick<GroupSummary, "members" | "budget_id" | "name">): boolean => g.members <= 1 || g.budget_id.startsWith("bgt_ind_") || SOLO_NAME.test(g.name);

const tierOf = (t: string): Tier => (t === "gold" || t === "silver" ? t : "bronze");

/** Every group and solo builder, most proven calls first, ranked. */
export function toEntries(groups: GroupSummary[]): OrbitEntry[] {
  return [...groups]
    .sort((a, b) => b.proven_calls - a.proven_calls || a.name.localeCompare(b.name))
    .map((g, i) => {
      const solo = isSolo(g);
      return {
        id: g.budget_id,
        name: solo ? g.name.replace(SOLO_NAME, "") || g.owner : g.name,
        owner: g.owner,
        solo,
        members: g.members,
        tier: tierOf(g.tier),
        calls: g.proven_calls,
        refused: g.refused_calls,
        feeBps: g.fee_bps,
        clean: g.clean_calls,
        nextAt: g.next_tier_at,
        rank: i + 1,
      };
    });
}

export const filterEntries = (entries: OrbitEntry[], f: OrbitFilter): OrbitEntry[] => (f === "all" ? entries : entries.filter((e) => e.solo === (f === "solo")));

export const filterCounts = (entries: OrbitEntry[]): Record<OrbitFilter, number> => ({
  all: entries.length,
  groups: entries.filter((e) => !e.solo).length,
  solo: entries.filter((e) => e.solo).length,
});

/** The shortest way round from index `from` to index `to` on an orbit of n: positive turns forward. */
export function shortestDelta(from: number, to: number, n: number): number {
  if (n <= 0) return 0;
  let d = (((to - from) % n) + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

/**
 * The angle of body i when the orbit's continuous position is `pos` (body k is at the front when pos is
 * k). The front is at π/2, the near side of the ellipse; the next body sits to its right.
 */
export const orbitAngle = (i: number, pos: number, n: number): number => Math.PI / 2 + (pos - i) * ((Math.PI * 2) / Math.max(1, n));
/** 0 at the far side of the orbit, 1 at the front. */
export const depthOf = (angle: number): number => (Math.sin(angle) + 1) / 2;

export interface OrbitFrame {
  w: number;
  h: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Multiplies every sphere size and dot spacing. */
  scale: number;
  phone: boolean;
}

/** Where the orbit sits in a canvas of w by h CSS pixels. */
export function orbitFrame(w: number, h: number): OrbitFrame {
  const M = ORBIT_MOTION;
  if (w < M.phoneBelow) {
    const P = M.phone;
    const rx = w * P.rx;
    return { w, h, cx: w * P.cx, cy: h * P.cy, rx, ry: rx * P.ryOfRx, scale: Math.max(P.minScale, Math.min(P.maxScale, w * P.scaleOfW)), phone: true };
  }
  const D = M.desktop;
  const fw = Math.min(w, M.frameMax);
  const left = (w - fw) / 2;
  const rx = fw * D.rx;
  const scale = Math.max(D.minScale, Math.min(D.maxScale, fw / D.refW, h / D.refH));
  const narrow = w <= M.narrow.below;
  return { w, h, cx: left + fw * (narrow ? M.narrow.cx : D.cx), cy: h * (narrow ? M.narrow.cy : D.cy), rx, ry: rx * D.ryOfRx, scale, phone: false };
}

/** One body as drawn: centre, radius, dot spacing, opacity and assembly progress. */
export interface Body {
  index: number;
  entry: OrbitEntry;
  x: number;
  y: number;
  R: number;
  step: number;
  gap: number;
  floor: number;
  depth: number;
  alpha: number;
  as: number;
  front: boolean;
}

export interface OrbitState {
  /** The orbit's continuous position (see orbitAngle). */
  pos: number;
  /** The body at the front, and the one leaving it (-1 for none). */
  sel: number;
  leaving: number;
  /** 0 to 1: how far the turn has gone, and how far the front body has assembled. */
  turn: number;
  arrive: number;
}

/**
 * Lays every body out for one frame. Pure, so the depth scaling and the turn are unit tested. Sizes are
 * against `maxCalls`, the busiest group on the whole network, so a filter never inflates a small record.
 */
export function orbitBodies(entries: OrbitEntry[], frame: OrbitFrame, s: OrbitState, maxCalls = Math.max(0, ...entries.map((e) => e.calls))): Body[] {
  const M = ORBIT_MOTION;
  const n = entries.length;
  const max = Math.max(1, maxCalls);
  const tilt = (M.tiltDeg * Math.PI) / 180;
  const cosT = Math.cos(tilt),
    sinT = Math.sin(tilt);
  return entries.map((entry, index) => {
    const a = orbitAngle(index, s.pos, n);
    const ex = Math.cos(a) * frame.rx,
      ey = Math.sin(a) * frame.ry;
    const x = frame.cx + ex * cosT - ey * sinT;
    const y0 = frame.cy + ex * sinT + ey * cosT;
    const depth = depthOf(a);
    const spec = groupSphere(entry.calls, max, entry.tier, frame.scale);
    const base = spec.R;
    const backR = base * (M.backMin + M.backRange * depth);
    const backAlpha = M.backAlpha + M.backAlphaRange * depth;
    const frontR = base * M.frontScale;
    const front = index === s.sel;
    let R = backR,
      lift = 0,
      alpha = backAlpha,
      as = 1;
    if (front) {
      R = frontR * (M.arriveFrom + (1 - M.arriveFrom) * easeOut(s.arrive));
      lift = R * M.frontLift;
      alpha = 1;
      as = easeOut(s.arrive * 1.1);
    } else if (index === s.leaving) {
      // The body that was at the front shrinks back onto the orbit as it turns away.
      const k = easeOut(s.turn);
      R = frontR + (backR - frontR) * k;
      lift = R * M.frontLift * (1 - k);
      alpha = 1 + (backAlpha - 1) * k;
    }
    const k = R / base;
    return {
      index,
      entry,
      x,
      y: y0 - lift,
      R,
      step: Math.max(M.minStep, spec.step * frame.scale * k),
      gap: Math.max(M.minGap, spec.gap * frame.scale * k),
      floor: spec.floor,
      depth,
      alpha,
      as,
      front,
    };
  });
}

/** The front-most body under (x, y), or null. */
export function hitBody(bodies: Body[], x: number, y: number): Body | null {
  let best: Body | null = null;
  for (const b of bodies) {
    if (Math.hypot(b.x - x, b.y - y) >= Math.max(ORBIT_MOTION.hitMin, b.R)) continue;
    if (!best || b.depth > best.depth || b.front) best = b;
  }
  return best;
}

const short = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Paints one frame: the dotted orbit, the -10° line, the bodies back to front, their labels and rank marks. */
function paint(ctx: CanvasRenderingContext2D, frame: OrbitFrame, bodies: Body[], hover: number, arrive: number): void {
  const M = ORBIT_MOTION;
  const C = M.colors;
  ctx.save();
  ctx.translate(frame.cx, frame.cy);
  ctx.rotate((M.tiltDeg * Math.PI) / 180);
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.orbit;
  ctx.setLineDash(C.dash);
  ctx.beginPath();
  ctx.ellipse(0, 0, frame.rx, frame.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(-frame.w * 1.5, 0);
  ctx.lineTo(frame.w * 1.5, 0);
  ctx.stroke();
  ctx.restore();

  const L = M.label;
  const sorted = [...bodies].sort((p, q) => (p.front ? 1 : q.front ? -1 : p.depth - q.depth));
  for (const b of sorted) {
    ctx.globalAlpha = b.alpha;
    paintDots(ctx, sphereDots({ cx: b.x, cy: b.y, R: b.R, step: b.step, light: LIGHT, floor: b.floor, gap: b.gap }), b.R, b.as);
  }
  ctx.globalAlpha = 1;
  // Labels after every sphere, so a nearer sphere never hides a name.
  for (const b of sorted) {
    const top3 = b.entry.rank <= 3;
    if (b.front) {
      if (!top3 || arrive <= 0) continue;
      ctx.globalAlpha = clamp01(arrive);
      ctx.fillStyle = C.rank;
      ctx.textAlign = "center";
      ctx.font = `600 ${M.frontRank.size}px ${M.font}`;
      ctx.fillText(ORBIT.mark(b.entry.rank), b.x, b.y + b.R + M.frontRank.gap);
      ctx.globalAlpha = 1;
      continue;
    }
    // On a phone only the neighbours of the front body and the top 3 are named, so labels never collide.
    const near = b.depth >= L.phoneNear;
    if (frame.phone && !near && !top3) continue;
    const hot = b.index === hover;
    const size = Math.round(L.size + L.sizeRange * b.depth);
    ctx.font = `500 ${size}px ${M.font}`;
    ctx.textAlign = "left";
    const name = frame.phone && !near ? "" : short(b.entry.name, frame.phone ? L.phoneChars : L.maxChars);
    const mark = top3 ? `${b.entry.rank}` : "";
    const sep = mark && name ? "  " : "";
    const total = ctx.measureText(mark + sep + name).width;
    let x = b.x - total / 2;
    const y = b.y + b.R + L.gap * (0.7 + 0.3 * b.depth);
    ctx.globalAlpha = hot ? 1 : L.alpha + L.alphaRange * b.depth;
    if (mark) {
      ctx.fillStyle = C.rank;
      ctx.fillText(mark + sep, x, y);
      x += ctx.measureText(mark + sep).width;
    }
    if (name) {
      ctx.fillStyle = hot ? C.labelHover : C.label;
      ctx.fillText(name, x, y);
    }
    ctx.globalAlpha = 1;
  }
}

const explorerAddress = (account: string): string => `https://${NEAR_NETWORK === "mainnet" ? "" : "testnet."}nearblocks.io/address/${encodeURIComponent(account)}`;

function Panel({ e }: { e: OrbitEntry }) {
  const top = e.nextAt === null;
  const nextTier = e.tier === "bronze" ? REP.names.silver : REP.names.gold;
  const need = e.nextAt ?? 0;
  const progress = top ? 1 : clamp01(e.clean / Math.max(1, need));
  return (
    <div className="ob-panel" data-testid="group-detail" data-budget={e.id} data-tier={e.tier}>
      <p className="ob-rankline">
        <span className="ob-rank num">{e.rank <= 3 ? ORBIT.rankTop(e.rank) : ORBIT.rank(e.rank)}</span>
        <span className="ob-kind">{e.solo ? ORBIT.solo : ORBIT.groupOf(e.members)}</span>
      </p>
      <p className="ob-name">{e.name}</p>
      <dl className="ob-stats">
        <div>
          <dt>{ORBIT.proven}</dt>
          <dd className="num">{e.calls.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>{ORBIT.tier}</dt>
          <dd>{REP.names[e.tier]}</dd>
        </div>
        <div>
          <dt>{ORBIT.fee}</dt>
          <dd className="num">{feeText(e.feeBps)}</dd>
        </div>
        <div>
          <dt>{ORBIT.refused}</dt>
          <dd className={e.refused > 0 ? "num ob-red" : "num"}>{e.refused.toLocaleString("en-US")}</dd>
        </div>
      </dl>
      <div className="ob-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="ob-next">{top ? ORBIT.top : ORBIT.next(Math.min(e.clean, need), need, nextTier)}</p>
    </div>
  );
}

const Chevron = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function Head() {
  return (
    <header className="ob-head">
      <p className="ob-kicker">{ORBIT.kicker}</p>
      <h1 className="ob-title">{ORBIT.title}</h1>
      <p className="ob-lede">{ORBIT.lede}</p>
    </header>
  );
}

/** The orbit's moving parts, kept in refs so a draw never waits for React. */
interface Motion {
  from: number;
  to: number;
  pos: number;
  leaving: number;
}

/**
 * The Groups page's orbit. `groups` is null while loading; `status` (a loading line or a problem) then
 * shows under the heading.
 */
export function GroupsOrbit({ groups, status }: { groups: GroupSummary[] | null; status?: ReactNode }) {
  const all = useMemo(() => (groups ? toEntries(groups) : []), [groups]);
  const [filter, setFilter] = useState<OrbitFilter>("all");
  const [sel, setSel] = useState(0);
  const [run, setRun] = useState(0);
  const list = useMemo(() => filterEntries(all, filter), [all, filter]);
  const n = list.length;
  const at = Math.min(sel, Math.max(0, n - 1));

  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useRef<Motion>({ from: 0, to: 0, pos: 0, leaving: -1 });
  const bodies = useRef<Body[]>([]);
  const hover = useRef(-1);
  const lastT = useRef(0);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const maxCalls = useMemo(() => Math.max(0, ...all.map((e) => e.calls)), [all]);
  const live = useRef({ list, sel: at, maxCalls });
  live.current = { list, sel: at, maxCalls };

  const draw = useCallback((t: number) => {
    lastT.current = t;
    const cv = canvas.current;
    if (!cv) return;
    const { w, h } = boxOf(cv);
    if (!w || !h) return;
    const ctx = fitCanvas(cv, w, h);
    if (!ctx) return;
    const M = ORBIT_MOTION;
    const m = motion.current;
    const turn = clamp01(t / M.rotate);
    m.pos = m.from + (m.to - m.from) * easeOut(turn);
    const arrive = clamp01((t - M.assembleDelay) / M.assemble);
    const frame = orbitFrame(w, h);
    const { list: L, sel: s, maxCalls: top } = live.current;
    const laid = orbitBodies(L, frame, { pos: m.pos, sel: s, leaving: m.leaving, turn, arrive }, top);
    bodies.current = laid;
    paint(ctx, frame, laid, hover.current, arrive);
  }, []);

  const duration = Math.max(ORBIT_MOTION.rotate, ORBIT_MOTION.assembleDelay + ORBIT_MOTION.assemble);
  // A new turn, a new filter, or the groups arriving plays the motion again from its start.
  useCanvasAnimation(canvas, draw, { duration, fps: ORBIT_MOTION.fps, freezeAt: frozenFrame("orbit"), restartKey: `${run}:${all.length}` });

  const select = useCallback((i: number) => {
    const { list: L, sel: s } = live.current;
    const count = L.length;
    if (!count) return;
    const to = ((i % count) + count) % count;
    if (to === s) return;
    const m = motion.current;
    m.from = m.pos;
    m.to = m.to + shortestDelta(s, to, count);
    m.leaving = s;
    setSel(to);
    setRun((r) => r + 1);
  }, []);
  const step = (d: number) => select(at + d);

  const pickFilter = (f: OrbitFilter) => {
    if (f === filter) return;
    motion.current = { from: 0, to: 0, pos: 0, leaving: -1 };
    hover.current = -1;
    setFilter(f);
    setSel(0);
    setRun((r) => r + 1);
  };

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    const { x, y } = toCanvas(e);
    const hit = hitBody(bodies.current, x, y);
    if (hit) select(hit.index);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== "mouse") return;
    const { x, y } = toCanvas(e);
    const hit = hitBody(bodies.current, x, y);
    const idx = hit && !hit.front ? hit.index : -1;
    e.currentTarget.style.cursor = hit && !hit.front ? "pointer" : "";
    if (idx !== hover.current) {
      hover.current = idx;
      draw(lastT.current);
    }
  };
  const onPointerLeave = () => {
    if (hover.current === -1) return;
    hover.current = -1;
    draw(lastT.current);
  };
  // Swipes: touch-action pan-y leaves vertical scrolling to the browser; a sideways swipe turns the orbit.
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x,
      dy = e.clientY - s.y;
    if (Math.abs(dx) >= ORBIT_MOTION.swipeMin && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swiped.current = true;
      step(dx < 0 ? 1 : -1);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      select(e.key === "Home" ? 0 : n - 1);
    }
  };

  const current = list[at];
  const counter = ORBIT.counter(at + 1, n);
  const rankText = current ? (current.rank <= 3 ? ORBIT.rankTop(current.rank) : ORBIT.rank(current.rank)) : "";

  return (
    <section className="ob" aria-label={ORBIT.kicker} data-testid="group-orbit">
      <canvas
        ref={canvas}
        className="ob-canvas"
        tabIndex={n > 0 ? 0 : -1}
        role="group"
        aria-roledescription="orbit"
        aria-label={ORBIT.orbitLabel}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        data-count={n}
        data-selected={current?.id}
      />
      <div className="ob-frame">
        <Head />
        {status && <div className="ob-status">{status}</div>}
        {groups && (
          <>
            <div className="ob-filters" role="group" aria-label={ORBIT.filtersLabel}>
              {FILTERS.map((f) => (
                <button key={f} type="button" className="ob-tab" aria-pressed={filter === f} onClick={() => pickFilter(f)}>
                  {ORBIT.filters[f]}
                </button>
              ))}
            </div>
            {current ? <Panel e={current} /> : <p className="ob-panel ob-empty">{ORBIT.empty[filter]}</p>}
            {current && (
              <p className="sr-only" aria-live="polite">
                {ORBIT.announce(current.name, rankText, counter)}
              </p>
            )}
            <div className="ob-nav">
              {n > 0 && <span className="ob-counter num">{counter}</span>}
              <button type="button" className="ob-arrow" onClick={() => step(-1)} aria-label={ORBIT.prev} disabled={n < 2}>
                <Chevron d="M15 6l-6 6 6 6" />
              </button>
              <button type="button" className="ob-arrow" onClick={() => step(1)} aria-label={ORBIT.nextLabel} disabled={n < 2}>
                <Chevron d="M9 6l6 6-6 6" />
              </button>
              {current && (
                <a className="ob-open" href={explorerAddress(current.owner)} target="_blank" rel="noreferrer">
                  {ORBIT.open}
                  <span className="sr-only">, {ORBIT.openRest(current.name)}</span>
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
