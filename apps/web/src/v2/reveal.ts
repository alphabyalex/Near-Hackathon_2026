/**
 * Scroll reveals for the home page: each block fades up once, the first time it comes into view.
 * Anything already on screen at load is left alone, so nothing flashes. Under prefers-reduced-motion,
 * or without IntersectionObserver, nothing is hidden at all. The hidden state is only ever set here,
 * by the same code that clears it, so a failure leaves the page fully visible.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./motion";

/** What reveals: the direct children of every section's wrap. */
const TARGETS = ".sec > .wrap > *, .sec > .cta-art";
const STAGGER_MS = 90;

/** Reveal blocks in `root` as they scroll in. `watch` changes when new sections mount (data arriving). */
export function useReveal(root: RefObject<HTMLElement | null>, watch: unknown): void {
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );

  // Layout effect: new blocks are hidden before the browser paints them.
  useLayoutEffect(() => {
    const host = root.current;
    if (!host || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
    if (!observer.current) {
      observer.current = new IntersectionObserver(
        (entries) => {
          const showing = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          showing.forEach((entry, i) => {
            const el = entry.target as HTMLElement;
            observer.current?.unobserve(el);
            el.style.setProperty("--rv-d", `${i * STAGGER_MS}ms`);
            el.setAttribute("data-rv", "in");
            // Hand the element back to its own styles once it has settled.
            const settle = (ev: Event) => {
              if ((ev as TransitionEvent).propertyName !== "transform") return;
              el.removeEventListener("transitionend", settle);
              el.removeAttribute("data-rv");
              el.style.removeProperty("--rv-d");
            };
            el.addEventListener("transitionend", settle);
          });
        },
        { rootMargin: "0px 0px -9% 0px", threshold: 0 },
      );
    }
    const fold = window.innerHeight;
    host.querySelectorAll<HTMLElement>(TARGETS).forEach((el) => {
      const state = el.getAttribute("data-rv");
      if (state === "in") return;
      // Still hidden from an earlier pass (the observer may have been rebuilt since): watch it again.
      if (state === "out") {
        observer.current?.observe(el);
        return;
      }
      const top = el.getBoundingClientRect().top;
      // On screen already (or above it, after a reload mid-page): leave visible.
      if (top < fold * 0.91) return;
      el.setAttribute("data-rv", "out");
      observer.current?.observe(el);
    });
  }, [root, watch]);
}
