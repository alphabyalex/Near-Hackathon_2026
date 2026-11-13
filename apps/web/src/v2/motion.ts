/**
 * One loop for every Horizon v2 canvas: one-shot entrances drawn at about 30fps, stopped when off screen,
 * when the tab is hidden, and when finished. Under prefers-reduced-motion only the final frame is drawn.
 * Nothing here listens to the mouse.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

export const prefersReducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * `?frame=<name>:<seconds>` in the page URL holds one animation at that second, for screenshots and
 * review, for example `/?frame=explainer:4.5#/how-it-works`. Real data still drives everything else.
 */
export function frozenFrame(name: string, search: string = typeof window === "undefined" ? "" : window.location.search): number | null {
  const raw = new URLSearchParams(search).getAll("frame");
  for (const v of raw) {
    const [n, s] = v.split(":");
    if (n === name && s !== undefined && Number.isFinite(Number(s))) return Number(s);
  }
  return null;
}

export interface AnimationOptions {
  /** Seconds. After this the final frame stays and the loop stops. Infinity keeps drawing (a slow drift). */
  duration: number;
  /** The frame reduced motion shows, and the one a finished animation rests on. Defaults to `duration`. */
  finalAt?: number | undefined;
  /** Frames a second, or a function of time (the hero drops to a slower rate once only the drift is left). */
  fps?: number | ((t: number) => number);
  /** Start the first time the element is a third on screen, not on mount. */
  startOnView?: boolean;
  /** Hold this frame (see frozenFrame). */
  freezeAt?: number | null;
  /** A new value plays the animation again from 0, for motion a person starts (the Groups orbit turning). */
  restartKey?: unknown;
}

/**
 * Calls draw(t) with t in seconds since the animation started. The element (usually the canvas) is
 * observed for visibility and size; a resize redraws the current frame. data-motion on it reads
 * "waiting", "playing", "paused", "done" or "still".
 */
export function useCanvasAnimation(target: RefObject<HTMLElement | null>, draw: (t: number) => void, opts: AnimationOptions): void {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const { duration, finalAt, fps = 30, startOnView = false, freezeAt = null, restartKey } = opts;
  const fpsRef = useRef(fps);
  fpsRef.current = fps;

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const final = finalAt ?? duration;
    const mark = (state: string) => el.setAttribute("data-motion", state);
    let t = 0;
    const paint = (at: number) => {
      t = at;
      drawRef.current(at);
    };

    const still = prefersReducedMotion() || freezeAt !== null;
    let onScreen = true;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => paint(t));
    const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
    let alive = true;
    // Canvas text waits for Geist, then the current frame is drawn again.
    fontsReady?.then(() => alive && paint(t));

    if (still) {
      paint(freezeAt ?? final);
      mark("still");
      resizeObserver?.observe(el);
      return () => {
        alive = false;
        resizeObserver?.disconnect();
      };
    }

    let started = !startOnView;
    let done = false;
    let raf = 0;
    let origin = 0;
    let last = 0;
    const frame = (now: number) => {
      raf = 0;
      if (!onScreen || document.hidden) {
        mark("paused");
        origin = 0;
        return;
      }
      // After a pause the clock carries on from the frame it stopped at.
      if (!origin) origin = now - t * 1000;
      const elapsed = (now - origin) / 1000;
      const rate = typeof fpsRef.current === "function" ? fpsRef.current(elapsed) : fpsRef.current;
      if (now - last >= 1000 / rate - 4) {
        last = now;
        if (elapsed >= duration) {
          paint(final);
          done = true;
          mark("done");
          return;
        }
        paint(elapsed);
        mark("playing");
      }
      raf = requestAnimationFrame(frame);
    };
    const resume = () => {
      if (started && !done && !raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
    };

    paint(0);
    mark(started ? "playing" : "waiting");
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              onScreen = entry?.isIntersecting ?? true;
              if (onScreen && !started && (entry?.intersectionRatio ?? 1) >= 0.3) started = true;
              resume();
            },
            { threshold: [0, 0.3] },
          );
    intersection?.observe(el);
    if (!intersection) started = true;
    resizeObserver?.observe(el);
    const onVisibility = () => resume();
    document.addEventListener("visibilitychange", onVisibility);
    resume();
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      intersection?.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [target, duration, finalAt, startOnView, freezeAt, restartKey]);
}

/** The element's CSS size, read where a draw needs it. */
export const boxOf = (el: HTMLElement): { w: number; h: number } => ({ w: el.clientWidth || el.getBoundingClientRect().width, h: el.clientHeight || el.getBoundingClientRect().height });

/**
 * True once the element has been a third on screen, and stays true. Under prefers-reduced-motion, or without
 * IntersectionObserver, it is true from the start, so a page that animates in on view is simply finished.
 */
export function useInView<T extends HTMLElement>(threshold = 0.3): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => prefersReducedMotion() || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}
