import { lazy, Suspense } from "react";
import { Loading } from "./components/Loading";
import { Home } from "./views/site/Home";
import { SiteFooter, SiteHeader } from "./views/site/SiteChrome";
import { useLinkRouting, useRoute, type SitePage } from "./router";

// Home is in the main bundle. Every other page, and the owner app, loads on first visit, so the
// first paint never waits for wallet, EVM or Solana code it does not use.
const page = <M,>(load: () => Promise<M>, name: keyof M) => lazy(async () => ({ default: (await load())[name] as React.ComponentType }));
const About = page(() => import("./views/site/About"), "About");
const Connect = page(() => import("./views/site/Connect"), "Connect");
const Demo = page(() => import("./views/site/Demo"), "Demo");
const Groups = page(() => import("./views/site/Groups"), "Groups");
const Me = page(() => import("./views/site/Me"), "Me");
const Proof = page(() => import("./views/site/Proof"), "Proof");
const Scoring = page(() => import("./views/site/Scoring"), "Scoring");
const TryIt = page(() => import("./views/site/TryIt"), "TryIt");
const Vault = page(() => import("./views/site/Vault"), "Vault");
const Verify = page(() => import("./views/site/Verify"), "Verify");

/** While a page loads: its top section at the real size, so nothing jumps. */
function PageFallback() {
  return (
    <main aria-busy="true">
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

const PAGES: Record<SitePage, React.ComponentType> = { home: Home, me: Me, groups: Groups, proof: Proof, try: TryIt, demo: Demo, developers: Connect, verify: Verify, about: About, vault: Vault, scoring: Scoring };

export function App() {
  useLinkRouting();
  const route = useRoute();
  if (route.kind === "app") {
    return (
      <Suspense fallback={<main className="signin"><Loading /></main>}>
        <OwnerApp tab={route.tab} invoice={route.invoice} />
      </Suspense>
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
          <Page />
        </Suspense>
      </div>
      <SiteFooter page={route.page} />
    </>
  );
}
