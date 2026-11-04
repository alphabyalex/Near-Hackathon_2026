import { Logo } from "../../components/Logo";
import type { SitePage } from "../../router";

const LINKS: readonly { page: SitePage; label: string }[] = [
  { page: "vault", label: "The vault" },
  { page: "scoring", label: "Scoring" },
  { page: "about", label: "About" },
];

function PageLinks({ page }: { page: SitePage }) {
  return LINKS.map((link) => (
    <a key={link.page} href={`#/${link.page}`} {...(link.page === page ? { "aria-current": "page" as const } : {})}>
      {link.label}
    </a>
  ));
}

export function SiteHeader({ page }: { page: SitePage }) {
  return (
    <header className="top sitehead">
      <div className="wrap">
        <Logo />
        <nav className="nav" aria-label="Main">
          <PageLinks page={page} />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ page }: { page: SitePage }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <Logo markSize={22} textSize={18} />
        <nav className="nav" aria-label="Footer">
          <PageLinks page={page} />
          <a href="#/app/overview">Dashboard</a>
        </nav>
      </div>
    </footer>
  );
}
