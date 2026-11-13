/**
 * The docs (#/docs and #/docs/<page>): a grouped sidebar, one topic per page, a list of the page's headings that
 * follows your scroll, previous and next, and a search that opens with / or Ctrl/Cmd K. The pages are markdown
 * files in ./content, structured by ./nav.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { navigate, useRoute } from "../router";
import { Blocks, Inlines } from "./Markdown";
import { groupTitle, neighbours, PAGES, pageFor } from "./content";
import { NAV_GROUPS, START_HERE } from "./nav";
import { searchDocs } from "./search";
import "./docs.css";

const hrefFor = (slug: string, anchor?: string | null): string => `#/docs/${slug}${anchor ? `/${anchor}` : ""}`;

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

/** The search box that opens over the page. Arrow keys move, Enter opens, Escape closes. */
function SearchPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hits = useMemo(() => searchDocs(query), [query]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setAt(0), [query]);

  const open = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    navigate(hrefFor(hit.slug, hit.anchor));
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(at);
    }
  };

  return (
    <div className="dd-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dd-palette" role="dialog" aria-modal="true" aria-label="Search the docs" data-testid="docs-search" onKeyDown={onKey}>
        <div className="dd-palette-field">
          <SearchIcon />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits[at] ? `${listId}-${at}` : undefined}
            placeholder="Search the docs"
            aria-label="Search the docs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="dd-hits" id={listId} role="listbox" aria-label="Results">
          {hits.map((h, i) => (
            <li key={`${h.slug}#${h.anchor ?? ""}#${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === at}>
              <a href={hrefFor(h.slug, h.anchor)} onClick={onClose} onMouseMove={() => at !== i && setAt(i)}>
                <span className="dd-hit-title">{h.heading ?? h.title}</span>
                <span className="dd-hit-where">{h.heading ? `${h.group} / ${h.title}` : h.group}</span>
                {h.snippet && <span className="dd-hit-snippet">{h.snippet}</span>}
              </a>
            </li>
          ))}
          {query.trim() !== "" && hits.length === 0 && <li className="dd-hit-none">Nothing matches "{query.trim()}".</li>}
          {query.trim() === "" && <li className="dd-hit-none">Type to search every page.</li>}
        </ul>
      </div>
    </div>
  );
}

function Sidebar({ slug, onNavigate }: { slug: string | null; onNavigate: () => void }) {
  return (
    <nav className="dd-nav" aria-label="Docs">
      {NAV_GROUPS.map((g) => (
        <div key={g.title} className="dd-group">
          <h2>{g.title}</h2>
          <ul>
            {g.pages.map((s) => (
              <li key={s}>
                <a href={hrefFor(s)} {...(s === slug ? { "aria-current": "page" as const } : {})} onClick={onNavigate}>
                  {PAGES[s]?.title ?? s}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** "On this page": the headings, with the one you are reading marked. */
function Contents({ slug }: { slug: string }) {
  const doc = PAGES[slug];
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    setActive(null);
    if (!doc?.headings.length || typeof IntersectionObserver === "undefined") return;
    const els = doc.headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => e !== null);
    // The heading that last crossed the upper part of the window is the one being read.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-96px 0px -72% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [slug, doc]);
  if (!doc || doc.headings.length < 2) return null;
  return (
    <nav className="dd-toc" aria-label="On this page">
      <h2>On this page</h2>
      <ul>
        {doc.headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "sub" : undefined}>
            <a href={hrefFor(slug, h.id)} {...(active === h.id ? { "aria-current": "location" as const } : {})}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Pager({ slug }: { slug: string }) {
  const { prev, next } = neighbours(slug);
  if (!prev && !next) return null;
  return (
    <nav className="dd-pager" aria-label="Previous and next">
      {prev ? (
        <a className="prev" href={hrefFor(prev)}>
          <span>Previous</span>
          <b>{PAGES[prev]?.title}</b>
        </a>
      ) : (
        <span />
      )}
      {next && (
        <a className="next" href={hrefFor(next)}>
          <span>Next</span>
          <b>{PAGES[next]?.title}</b>
        </a>
      )}
    </nav>
  );
}

function DocsHome({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="dd-home">
      <h1 className="dd-title">Wardline documentation</h1>
      <p className="dd-lede">How Wardline pays only for what it can prove, how the Mutual works, and how to build on it.</p>
      <button type="button" className="dd-search-wide" onClick={onSearch}>
        <SearchIcon />
        <span>Search the docs</span>
        <kbd>/</kbd>
      </button>
      <ul className="dd-cards" aria-label="Start here">
        {START_HERE.map((c) => (
          <li key={c.slug}>
            <a href={hrefFor(c.slug)}>
              <b>{c.title}</b>
              <span>{c.line}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="dd-all">
        {NAV_GROUPS.map((g) => (
          <section key={g.title}>
            <h2>{g.title}</h2>
            <ul>
              {g.pages.map((s) => (
                <li key={s}>
                  <a href={hrefFor(s)}>
                    <b>{PAGES[s]?.title}</b>
                    <span>{PAGES[s]?.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export function Docs() {
  const route = useRoute();
  const requested = route.kind === "site" ? route.doc : undefined;
  const doc = pageFor(requested);
  const slug = doc ? (requested as string) : null;
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const openSearch = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setSearching(true);
  }, []);
  const closeSearch = useCallback(() => {
    setSearching(false);
    opener.current?.focus?.();
  }, []);

  // / and Ctrl or Cmd K open the search from anywhere on the page that is not a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSearch]);

  // The tab says which page you are on.
  useEffect(() => {
    const before = document.title;
    document.title = doc ? `${doc.title} · Wardline docs` : "Wardline docs";
    return () => {
      document.title = before;
    };
  }, [doc]);
  useEffect(() => setMenu(false), [slug]);

  return (
    <main className="docs">
      <div className="dd-bar">
        <div className="wrap dd-bar-in">
          <button type="button" className="dd-bar-btn" aria-expanded={menu} aria-controls="docs-nav" onClick={() => setMenu((m) => !m)}>
            {menu ? "Close pages" : "Pages"}
          </button>
          <button type="button" className="dd-bar-btn" onClick={openSearch}>
            <SearchIcon />
            <span>Search</span>
          </button>
        </div>
      </div>
      <div className="wrap dd-shell">
        <aside className="dd-side" id="docs-nav" data-open={menu || undefined}>
          <button type="button" className="dd-search" onClick={openSearch}>
            <SearchIcon />
            <span>Search</span>
            <kbd>/</kbd>
          </button>
          <Sidebar slug={slug} onNavigate={() => setMenu(false)} />
        </aside>

        <article className="dd-article" data-testid="docs-article">
          {!requested && <DocsHome onSearch={openSearch} />}
          {requested && !doc && (
            <div className="dd-missing">
              <h1 className="dd-title">That page isn't in the docs</h1>
              <p className="dd-lede">
                It may have moved. <a href="#/docs">Go to the docs home</a>, or search for what you were after.
              </p>
            </div>
          )}
          {slug && doc && (
            <>
              <p className="dd-crumb">
                <a href="#/docs">Docs</a>
                <span aria-hidden="true"> / </span>
                {groupTitle(slug)}
              </p>
              <h1 className="dd-title">{doc.title}</h1>
              {doc.description && (
                <p className="dd-lede">
                  <Inlines parts={[doc.description]} />
                </p>
              )}
              {/* Keyed by page, so a code panel's selected tab never carries over to the next page. */}
              <div className="dd-body" key={slug}>
                <Blocks blocks={doc.blocks} slug={slug} />
              </div>
              <Pager slug={slug} />
            </>
          )}
        </article>

        {slug && <Contents slug={slug} />}
      </div>
      {searching && <SearchPalette onClose={closeSearch} />}
    </main>
  );
}
