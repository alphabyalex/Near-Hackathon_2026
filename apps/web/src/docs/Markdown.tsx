import { Fragment, type ReactNode } from "react";
import { CodeTabs } from "../components/CodeTabs";
import { Embed } from "./Embeds";
import type { Block, CalloutKind, Inline, ListItem } from "./parse";

const LANG: Record<string, string> = { ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", python: "Python", py: "Python", sh: "Shell", bash: "Shell", json: "JSON", text: "Text", rust: "Rust" };
const CALLOUT: Record<CalloutKind, string> = { note: "Note", important: "Important", limitation: "Limitation" };

function Link({ href, children }: { href: string; children: ReactNode }) {
  // Inside the app (#/docs/...) the router handles the click. Other sites open in a new tab.
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

export function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
        if (p.k === "code") return <code key={i}>{p.v}</code>;
        if (p.k === "strong") return <strong key={i}><Inlines parts={p.c} /></strong>;
        if (p.k === "em") return <em key={i}><Inlines parts={p.c} /></em>;
        return (
          <Link key={i} href={p.href}>
            <Inlines parts={p.c} />
          </Link>
        );
      })}
    </>
  );
}

function List({ ordered, items }: { ordered: boolean; items: ListItem[] }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag>
      {items.map((it, i) => (
        <li key={i}>
          <Inlines parts={it.c} />
          {it.sub && <List ordered={it.sub.ordered} items={it.sub.items} />}
        </li>
      ))}
    </Tag>
  );
}

function BlockView({ block, slug }: { block: Block; slug: string }) {
  switch (block.k) {
    case "heading": {
      const Tag = block.level === 2 ? "h2" : "h3";
      return (
        <Tag id={block.id} className="dd-heading">
          <Inlines parts={block.c} />
          <a className="dd-anchor" href={`#/docs/${slug}/${block.id}`} aria-label={`Link to ${block.text}`}>
            #
          </a>
        </Tag>
      );
    }
    case "p":
      return (
        <p>
          <Inlines parts={block.c} />
        </p>
      );
    case "list":
      return <List ordered={block.ordered} items={block.items} />;
    case "code":
      return <CodeTabs tabs={[{ id: "code", label: block.title ?? LANG[block.lang] ?? block.lang, code: block.code }]} label={block.title ?? `${LANG[block.lang] ?? block.lang} code`} />;
    case "tabs":
      return <CodeTabs tabs={block.tabs.map((t, i) => ({ id: `${i}`, label: t.label, code: t.code }))} label={`${block.tabs.map((t) => t.label).join(", ")} code`} />;
    case "table":
      return (
        <div className="scrollx dd-table" role="region" aria-label="Table" tabIndex={0}>
          <table className="tbl">
            <thead>
              <tr>
                {block.head.map((c, i) => (
                  <th key={i} {...(block.align[i] ? { style: { textAlign: block.align[i]! } } : {})}>
                    <Inlines parts={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i} {...(block.align[i] ? { style: { textAlign: block.align[i]! } } : {})}>
                      <Inlines parts={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <aside className={`dd-callout ${block.kind}`} role="note">
          <p className="dd-callout-title">{CALLOUT[block.kind]}</p>
          <Blocks blocks={block.c} slug={slug} />
        </aside>
      );
    case "embed":
      return <Embed name={block.name} props={block.props} />;
    case "hr":
      return <hr />;
  }
}

export function Blocks({ blocks, slug }: { blocks: Block[]; slug: string }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} slug={slug} />
      ))}
    </>
  );
}
