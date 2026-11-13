import { lazy, Suspense } from "react";
import { Loading } from "./components/Loading";
import { Home } from "./views/site/Home";
import { SiteFooter, SiteHeader } from "./views/site/SiteChrome";
import { useLinkRouting, useRoute, useSectionScroll, type SitePage } from "./router";

// Home is in the main bundle. Every other page, and the owner app, loads on first visit, so the
// first paint never waits for wallet, EVM or Solana code it does not use.
const page = <M,>(load: () => Promise<M>, name: keyof M) => lazy(async () => ({ default: (await load())[name] as React.ComponentType }));
const About = page(() => import("./views/site/About"), "About");
const Docs = page(() => import("./views/site/Docs"), "Docs");
const Groups = page(() => import("./views/site/Groups"), "Groups");
const Balance = page(() => import("./views/site/Balance"), "Balance");
const Proof = page(() => import("./views/site/Proof"), "Proof");
const Scoring = page(() => import("./views/site/Scoring"), "Scoring");
const TryIt = page(() => import("./views/site/TryIt"), "TryIt");
const Vault = page(() => import("./views/site/Vault"), "Vault");
const Verify = page(() => import("./views/site/Verify"), "Verify");

/** While a page loads: its top section at the real size, so nothing jumps. */
function PageFallback() {
  return (
    <main aria-busy="true" className="page-view">
      <section className="sec pagetop page-intro">
        <div className="wrap">
          <span className="skel skel-title" />
        </div>
      </section>
    </main>
  );
}

// The owner app loads on first visit to #/app, so public pages never download it.
const OwnerApp = lazy(() => import("./views/Dashboard").then((m) => ({ default: m.OwnerApp })));

const PAGES: Record<SitePage, React.ComponentType> = { home: Home, wallet: Balance, groups: Groups, proof: Proof, try: TryIt, docs: Docs, verify: Verify, about: About, vault: Vault, scoring: Scoring };

export function App() {
  useLinkRouting();
  const route = useRoute();
  useSectionScroll(route);
  if (route.kind === "app") {
    return (
      <div key={`app-${route.tab}`} className="page-view">
        <Suspense fallback={<main className="signin"><Loading /></main>}>
          <OwnerApp tab={route.tab} invoice={route.invoice} />
        </Suspense>
      </div>
    );
  }
  const Page = PAGES[route.page];
  return (
    <>
      <a className="skip" href="#content" onClick={(e) => { e.preventDefault(); document.getElementById("content")?.focus(); }}>
        Skip to content
      </a>
      <SiteHeader page={route.page} />
      <div id="content" tabIndex={-1} className="content-anchor">
        <Suspense fallback={<PageFallback />}>
          <div key={route.page} className="page-view">
            <Page />
          </div>
        </Suspense>
      </div>
      <SiteFooter page={route.page} />
    </>
  );
}
