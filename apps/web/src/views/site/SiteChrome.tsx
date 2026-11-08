import { useEffect, useState } from "react";
import { FOOTER, NAV } from "../../brand";
import { Logo } from "../../components/Logo";
import type { SitePage } from "../../router";

function PageLinks({ page }: { page: SitePage }) {
  return NAV.map((link) => (
    <a key={link.page} href={`#/${link.page}`} {...(link.page === page ? { "aria-current": "page" as const } : {})}>
      {link.label}
    </a>
  ));
}

export function SiteHeader({ page }: { page: SitePage }) {
  const [open, setOpen] = useState(false);
  // Close the small-screen menu whenever the page changes.
  useEffect(() => setOpen(false), [page]);
  return (
    <header className={open ? "top sitehead open" : "top sitehead"}>
      <div className="wrap">
        <Logo />
        <button type="button" className="menu-btn" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Menu"}
        </button>
        <nav className="nav" id="main-nav" aria-label="Main">
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
          <a href="#/vault">{FOOTER.vault}</a>
          <a href="/llms.txt">{FOOTER.llms}</a>
          <a href="#/app/overview">{FOOTER.owner}</a>
        </nav>
      </div>
    </footer>
  );
}
