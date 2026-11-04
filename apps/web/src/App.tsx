import { Dashboard } from "./views/Dashboard";
import { About } from "./views/site/About";
import { Home } from "./views/site/Home";
import { Scoring } from "./views/site/Scoring";
import { SiteFooter, SiteHeader } from "./views/site/SiteChrome";
import { Vault } from "./views/site/Vault";
import { useLinkRouting, useRoute, type SitePage } from "./router";

const PAGES: Record<SitePage, () => React.JSX.Element> = { home: Home, vault: Vault, scoring: Scoring, about: About };

export function App() {
  useLinkRouting();
  const route = useRoute();
  if (route.kind === "app") return <Dashboard tab={route.tab} invoice={route.invoice} />;
  const Page = PAGES[route.page];
  return (
    <>
      <SiteHeader page={route.page} />
      <Page />
      <SiteFooter page={route.page} />
    </>
  );
}
