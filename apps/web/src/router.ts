import { useEffect, useMemo, useSyncExternalStore } from "react";

export type SitePage = "home" | "vault" | "scoring" | "about";
export type DashboardTab = "overview" | "invoices" | "evaluation" | "controls";
export type Route = { kind: "site"; page: SitePage } | { kind: "app"; tab: DashboardTab; invoice: string | null };

const SITE_PAGES: readonly string[] = ["vault", "scoring", "about"];
const TABS: readonly string[] = ["overview", "invoices", "evaluation", "controls"];

function decode(part: string | undefined): string | null {
  if (!part) return null;
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** Anything unrecognized falls back to home, or to the overview inside the dashboard. */
export function parseRoute(hash: string): Route {
  const [first, second, third] = hash.replace(/^#\/?/, "").split("/");
  if (first === "app") {
    const tab = second && TABS.includes(second) ? (second as DashboardTab) : "overview";
    return { kind: "app", tab, invoice: tab === "invoices" ? decode(third) : null };
  }
  return { kind: "site", page: first && SITE_PAGES.includes(first) ? (first as SitePage) : "home" };
}

let current = typeof window === "undefined" ? "" : window.location.hash;
const subscribers = new Set<() => void>();

const toTop = (): void => window.scrollTo({ top: 0, behavior: "instant" });

function publish(hash: string): void {
  if (hash === current) return;
  current = hash;
  subscribers.forEach((notify) => notify());
}

/** Sets the route directly, so links still work where hashchange is blocked, such as an embedded preview. */
export function navigate(hash: string): void {
  try {
    window.history.pushState(null, "", hash);
  } catch {
    // A sandboxed frame can refuse history writes. The route below still changes.
  }
  publish(hash);
  toTop();
}

function fromLocation(): void {
  const before = current;
  publish(window.location.hash);
  if (current !== before) toTop();
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
