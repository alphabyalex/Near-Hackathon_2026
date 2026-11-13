import { useEffect, useMemo, useSyncExternalStore } from "react";

export type SitePage = "home" | "wallet" | "groups" | "proof" | "try" | "developers" | "verify" | "about" | "vault" | "scoring";
export type DashboardTab = "overview" | "share" | "group" | "invoices" | "review" | "keys" | "evaluation" | "controls";
export type Route = { kind: "site"; page: SitePage; /** A section to scroll to, from #/<page>/<section>. */ section?: string } | { kind: "app"; tab: DashboardTab; invoice: string | null };

const SITE_PAGES: readonly string[] = ["wallet", "groups", "proof", "try", "developers", "verify", "about", "vault", "scoring"];
/**
 * Old routes that moved. Links to them land on the new page, and the address bar shows the new route.
 * Your share (#/me) became the Balance page; How it works (and #/demo before it) became the steps on About.
 */
const MOVED: Record<string, string> = { connect: "developers", me: "wallet", "how-it-works": "about/steps", demo: "about/steps" };

/** "#/connect" becomes "#/developers", "#/me" becomes "#/wallet"; anything else is unchanged. */
export function redirected(hash: string): string {
  const [first, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const to = first ? MOVED[first] : undefined;
  return to ? `#/${[to, ...rest].join("/")}` : hash;
}
const TABS: readonly string[] = ["overview", "share", "group", "invoices", "review", "keys", "evaluation", "controls"];

function decode(part: string | undefined): string | null {
  if (!part) return null;
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** Anything unrecognized falls back to home (the Mutual; #/mutual is an alias), or to the overview inside the dashboard. */
export function parseRoute(hash: string): Route {
  const [first, second, third] = hash.replace(/^#\/?/, "").split("/");
  if (first === "app") {
    const tab = second && TABS.includes(second) ? (second as DashboardTab) : "overview";
    return { kind: "app", tab, invoice: tab === "invoices" ? decode(third) : null };
  }
  const page: SitePage = first && SITE_PAGES.includes(first) ? (first as SitePage) : "home";
  // #/<page>/<section> scrolls to a section; for home that is #/mutual/<section>, since #/ has no name.
  return second && (page !== "home" || first === "mutual") ? { kind: "site", page, section: second } : { kind: "site", page };
}

/** Swaps a moved route for its new one in the address bar, without adding a history entry. */
function redirect(hash: string): string {
  const to = redirected(hash);
  if (to !== hash) {
    try {
      window.history.replaceState(null, "", to);
    } catch {
      // A sandboxed frame can refuse history writes; the page still renders the new route.
    }
  }
  return to;
}

let current = typeof window === "undefined" ? "" : redirect(window.location.hash);
const subscribers = new Set<() => void>();

const toTop = (): void => window.scrollTo({ top: 0, behavior: "instant" });

function publish(raw: string): void {
  const hash = redirect(raw);
  if (hash === current) return;
  const update = () => {
    current = hash;
    toTop();
    subscribers.forEach((notify) => notify());
  };
  if (
    typeof document !== "undefined" &&
    typeof (document as unknown as { startViewTransition?: (cb: () => void) => void }).startViewTransition === "function" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    (document as unknown as { startViewTransition: (cb: () => void) => void }).startViewTransition(update);
  } else {
    update();
  }
}

/** Sets the route directly, so links still work where hashchange is blocked, such as an embedded preview. */
export function navigate(hash: string): void {
  try {
    window.history.pushState(null, "", hash);
  } catch {
    // A sandboxed frame can refuse history writes. The route below still changes.
  }
  publish(hash);
}

function fromLocation(): void {
  publish(window.location.hash);
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  window.addEventListener("hashchange", fromLocation);
  window.addEventListener("popstate", fromLocation);
  return () => {
    subscribers.delete(notify);
    window.removeEventListener("hashchange", fromLocation);
    window.removeEventListener("popstate", fromLocation);
  };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => current);
  return useMemo(() => parseRoute(hash), [hash]);
}

/** Routes in-app link clicks in JS. New-tab style clicks keep their browser behavior. */
/**
 * Scrolls to the route's section (#/about/steps) once the page has drawn it. Pages load lazily, so it waits a
 * few frames for the element; the page's own scroll-to-top has already run by then.
 */
export function useSectionScroll(route: Route): void {
  const section = route.kind === "site" ? route.section : undefined;
  const page = route.kind === "site" ? route.page : null;
  useEffect(() => {
    if (!section) return;
    let frames = 0;
    let raf = 0;
    const find = () => {
      const el = document.getElementById(section);
      if (el) {
        el.scrollIntoView({ block: "start" });
        el.focus?.({ preventScroll: true });
        return;
      }
      if (++frames < 240) raf = requestAnimationFrame(find);
    };
    raf = requestAnimationFrame(find);
    return () => cancelAnimationFrame(raf);
  }, [page, section]);
}

export function useLinkRouting(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href");
      if (!href?.startsWith("#") || link?.target === "_blank") return;
      event.preventDefault();
      navigate(href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}
