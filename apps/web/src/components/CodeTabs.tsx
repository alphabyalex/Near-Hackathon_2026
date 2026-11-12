import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import "./codetabs.css";
import { CONNECT, DEVELOPERS } from "../brand";

export interface CodeTab {
  id: string;
  label: string;
  code: string;
  /** "The one line": the first line containing this text, or these 1-based line numbers. */
  highlight?: string | readonly number[];
  /** A short plain line shown under the code. */
  note?: string;
}

export interface CodeTabsProps {
  tabs: readonly CodeTab[];
  /** Names the tab list and what is copied, for screen readers. */
  label: string;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers and some embedded frames refuse the clipboard API.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** 0-based indexes of the highlighted lines. */
export function highlightedLines(lines: readonly string[], highlight: CodeTab["highlight"]): Set<number> {
  if (highlight === undefined) return new Set();
  if (typeof highlight === "string") {
    const at = lines.findIndex((line) => line.includes(highlight));
    return new Set(at < 0 ? [] : [at]);
  }
  return new Set(highlight.map((n) => n - 1).filter((i) => i >= 0 && i < lines.length));
}

// Comments (after whitespace or at the start, so "https://" is not one), strings, then keywords.
const TOKEN = /((?:^|(?<=\s))(?:\/\/|#).*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(import|from|const|let|new|await|async|if|return|export|function|def|curl)\b/g;

function paint(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index;
    if (at > last) out.push(line.slice(last, at));
    const kind = m[1] !== undefined ? "c" : m[2] !== undefined ? "s" : "k";
    out.push(
      <span key={at} className={`tk-${kind}`}>
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Language tabs over code, a Copy button for the visible snippet, and "the one line" highlighted. */
export function CodeTabs({ tabs, label }: CodeTabsProps) {
  const base = useId();
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const current = Math.min(index, tabs.length - 1);
  const active = tabs[current];
  if (!active) return null;
  const longest = Math.max(...tabs.map((tab) => tab.code.split("\n").length));

  const select = (i: number) => {
    setIndex(i);
    setCopied(false);
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = tabs.length - 1;
    const to =
      event.key === "ArrowRight" ? (current + 1) % tabs.length : event.key === "ArrowLeft" ? (current - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (to === null) return;
    event.preventDefault();
    select(to);
    refs.current[to]?.focus();
  };
  const copy = async () => {
    await copyText(active.code);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    // Room for the longest tab, so switching tabs never moves the page.
    <div className="codetabs" style={{ "--ct-lines": longest } as CSSProperties}>
      <div className="ct-bar">
        <div className="ct-tabs" role="tablist" aria-label={label}>
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${i}`}
              aria-selected={i === current}
              aria-controls={`${base}-panel-${i}`}
              tabIndex={i === current ? 0 : -1}
              className="ct-tab"
              onClick={() => select(i)}
              onKeyDown={onKey}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button type="button" className="ct-copy" onClick={() => void copy()} aria-label={`${CONNECT.copy} ${active.label}`} data-copied={copied || undefined}>
          {copied ? CONNECT.copied : CONNECT.copy}
        </button>
      </div>
      {tabs.map((tab, i) => {
        const lines = tab.code.split("\n");
        const one = highlightedLines(lines, tab.highlight);
        return (
          <div key={tab.id} role="tabpanel" id={`${base}-panel-${i}`} aria-labelledby={`${base}-tab-${i}`} hidden={i !== current} className="ct-panel">
            <pre tabIndex={0} aria-label={`${label}, ${tab.label}`}>
              <code>
                {lines.map((line, n) => (
                  <span key={n} className={one.has(n) ? "ct-line is-one" : "ct-line"} data-one={one.has(n) || undefined}>
                    <span className="ct-n" aria-hidden="true">
                      {n + 1}
                    </span>
                    <span className="ct-src">
                      {paint(line)}
                      {"\n"}
                    </span>
                    {one.has(n) && <span className="ct-tag">{DEVELOPERS.oneLine}</span>}
                  </span>
                ))}
              </code>
            </pre>
            {tab.note && <p className="ct-note">{tab.note}</p>}
          </div>
        );
      })}
      <span className="sr-only" role="status">
        {copied ? `${label}, ${active.label} ${CONNECT.copied.toLowerCase()}` : ""}
      </span>
    </div>
  );
}
