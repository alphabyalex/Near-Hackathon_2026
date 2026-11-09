import { lazy, Suspense } from "react";
import { Loading } from "./components/Loading";
import { About } from "./views/site/About";
import { Connect } from "./views/site/Connect";
import { Demo } from "./views/site/Demo";
import { Groups } from "./views/site/Groups";
import { Home } from "./views/site/Home";
import { Me } from "./views/site/Me";
import { Proof } from "./views/site/Proof";
import { Scoring } from "./views/site/Scoring";
import { SiteFooter, SiteHeader } from "./views/site/SiteChrome";
import { TryIt } from "./views/site/TryIt";
import { Vault } from "./views/site/Vault";
import { Verify } from "./views/site/Verify";
import { useLinkRouting, useRoute, type SitePage } from "./router";

// The owner app loads on first visit to #/app, so public pages never download it.
const OwnerApp = lazy(() => import("./views/Dashboard").then((m) => ({ default: m.OwnerApp })));

const PAGES: Record<SitePage, () => React.JSX.Element> = { home: Home, me: Me, groups: Groups, proof: Proof, try: TryIt, demo: Demo, connect: Connect, verify: Verify, about: About, vault: Vault, scoring: Scoring };

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
        <Page />
      </div>
      <SiteFooter page={route.page} />
    </>
  );
}
