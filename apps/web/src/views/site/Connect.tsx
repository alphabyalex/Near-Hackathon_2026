import { useEffect, useId, useMemo, useState } from "react";
import { CONNECT, DEVELOPERS } from "../../brand";
import { CodeTabs } from "../../components/CodeTabs";
import { SNIPPET_API_URL, SNIPPET_IS_PLACEHOLDER, SNIPPET_MCP_URL } from "../../config";
import { DEVELOPER_PATHS, developerTabs, type DeveloperPathId } from "../../data/snippets";
import { useRoute } from "../../router";
import "./developers.css";

export { pluginSnippets, pluginTabs, snippets } from "../../data/snippets";

const ICONS: Record<DeveloperPathId, string> = {
  ai: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  vendors: "M4 7h16v10H4zM4 11h16M8 15h3",
  app: "M8 6l-5 6 5 6M16 6l5 6-5 6",
};

const isPath = (value: string | undefined): value is DeveloperPathId => value !== undefined && (DEVELOPER_PATHS as readonly string[]).includes(value);

/** Developers (#/developers, and #/developers/ai | vendors | app to open one path). */
export function Connect() {
  const route = useRoute();
  const section = route.kind === "site" ? route.section : undefined;
  const [pick, setPick] = useState<DeveloperPathId>(isPath(section) ? section : "ai");
  useEffect(() => {
    if (isPath(section)) setPick(section);
  }, [section]);
  const tabs = useMemo(() => developerTabs(SNIPPET_API_URL, SNIPPET_MCP_URL), []);
  const askId = useId();
  const path = DEVELOPERS.paths[pick];

  return (
    <main className="dv">
      <section className="sec pagetop dv-sec">
        <div className="wrap dv-grid">
          <div className="dv-side">
            <p className="dv-eyebrow">{DEVELOPERS.eyebrow}</p>
            <h1 className="dv-title">{DEVELOPERS.title}</h1>
            <p className="dv-lede">{DEVELOPERS.lede}</p>
            <h2 className="dv-ask" id={askId}>
              {DEVELOPERS.ask}
            </h2>
            <div className="dv-picks" role="group" aria-labelledby={askId}>
              {DEVELOPER_PATHS.map((id) => {
                const p = DEVELOPERS.paths[id];
                return (
                  <button key={id} type="button" className="dv-pick" aria-pressed={pick === id} data-path={id} onClick={() => setPick(id)}>
                    <span className="dv-mark" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d={ICONS[id]} />
                      </svg>
                    </span>
                    <span className="dv-pick-text">
                      <span className="dv-pick-title">{p.title}</span>
                      <span className="dv-pick-line">{p.line}</span>
                    </span>
                    <span className="dv-dot" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <p className="dv-llms">
              {DEVELOPERS.llmsLead}{" "}
              <a className="link" href="/llms.txt">
                {DEVELOPERS.llmsLink}
              </a>
              .
            </p>
          </div>

          <div className="dv-main" data-path={pick}>
            <CodeTabs key={pick} tabs={tabs[pick]} label={DEVELOPERS.codeLabel(path.title)} />
            {SNIPPET_IS_PLACEHOLDER && (
              <p className="fine dv-placeholder" data-testid="snippet-placeholder">
                {CONNECT.placeholder}
              </p>
            )}
            <div className="dv-after">
              <div>
                <h2 className="dv-h">{DEVELOPERS.getBack}</h2>
                <ul className="dv-back">
                  {path.back.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="dv-h">{DEVELOPERS.also}</h2>
                <ul className="dv-also">
                  {path.also.map((link) => (
                    <li key={link.href + link.label}>
                      <a href={link.href}>
                        <span>{link.label}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12h14" />
                          <path d="M13 6l6 6-6 6" />
                        </svg>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
