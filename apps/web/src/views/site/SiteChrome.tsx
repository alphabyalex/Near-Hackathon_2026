import { useEffect, useState } from "react";
import { DOCS, FOOTER, NAV } from "../../brand";
import { Logo } from "../../components/Logo";
import type { SitePage } from "../../router";
import { AccountControl } from "../../wallets/AccountControl";

function PageLinks({ page }: { page: SitePage }) {
  return (
    <>
      {NAV.map((link) => (
        <a key={link.page} href={link.href} {...(link.page === page ? { "aria-current": "page" as const } : {})}>
          {link.label}
        </a>
      ))}
      {/* In the phone menu only; wider screens show Docs beside the wallet. */}
      <a className="nav-docs" href={DOCS.href} {...(page === DOCS.page ? { "aria-current": "page" as const } : {})}>
        {DOCS.label}
      </a>
    </>
  );
}

/** Sticky header: lockup left, pages in the middle, the wallet on the right. */
export function SiteHeader({ page }: { page: SitePage }) {
  const [open, setOpen] = useState(false);
  // Close the small-screen menu whenever the page changes.
  useEffect(() => setOpen(false), [page]);
  return (
    <header className={open ? "top sitehead open" : "top sitehead"}>
      <div className="wrap">
        <Logo />
        <nav className="nav" id="main-nav" aria-label="Main">
          <PageLinks page={page} />
        </nav>
        <div className="head-end">
          <a className="docs-link" href={DOCS.href} {...(page === DOCS.page ? { "aria-current": "page" as const } : {})}>
            {DOCS.label}
          </a>
          <AccountControl onBalance={page === "wallet"} />
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter(_props: { page: SitePage }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <Logo textSize={18} />
        <nav className="foot-cols" aria-label="Footer">
          {FOOTER.columns.map(([title, links]) => (
            <div key={title}>
              <h2>{title}</h2>
              <ul>
                {links.map(([label, href]) => (
                  <li key={href}>
                    <a href={href}>{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
