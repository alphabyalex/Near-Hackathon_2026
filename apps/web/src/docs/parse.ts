/**
 * A small markdown reader for the docs: the subset the pages use, parsed into a typed tree (never HTML), so a page
 * can only ever produce the elements the renderer knows about.
 *
 * Supported: front matter (title, description), ## and ### headings, paragraphs, bullet and numbered lists (one level
 * of nesting), fenced code (a run of fences with tab="..." becomes one tabbed block), pipe tables, :::note,
 * :::important and :::limitation callouts, ::embed{name=value} lines, horizontal rules, and inline code, links,
 * bold and italics.
 */

export type Inline = string | { k: "code"; v: string } | { k: "link"; href: string; c: Inline[] } | { k: "strong"; c: Inline[] } | { k: "em"; c: Inline[] };

export type CalloutKind = "note" | "important" | "limitation";

export interface ListItem {
  c: Inline[];
  sub?: Extract<Block, { k: "list" }>;
}

export type Block =
  | { k: "heading"; level: 2 | 3; id: string; text: string; c: Inline[] }
  | { k: "p"; c: Inline[] }
  | { k: "list"; ordered: boolean; items: ListItem[] }
  | { k: "code"; lang: string; code: string; title?: string; tab?: string }
  | { k: "tabs"; tabs: { label: string; lang: string; code: string }[] }
  | { k: "table"; head: Inline[][]; rows: Inline[][][]; align: ("left" | "right" | "center" | null)[] }
  | { k: "callout"; kind: CalloutKind; c: Block[] }
  | { k: "embed"; name: string; props: Record<string, string> }
  | { k: "hr" };

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface ParsedDoc {
  title: string;
  description: string;
  blocks: Block[];
  headings: Heading[];
  /** Plain text of the whole page, for search. */
  text: string;
}

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Splits `---` front matter from the body. Only `title` and `description` are read. */
export function frontMatter(src: string): { meta: { title: string; description: string }; body: string } {
  const text = src.replace(/\r\n/g, "\n");
  const meta = { title: "", description: "" };
  if (!text.startsWith("---\n")) return { meta, body: text };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { meta, body: text };
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^(title|description):\s*(.*)$/.exec(line);
    if (m) meta[m[1] as "title" | "description"] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(end + 4).replace(/^\n/, "") };
}

const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|((?<![*\w])\*[^*\s][^*]*\*(?!\*))/g;

/** Inline markup: `code`, [text](href), **bold**, *italic*. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    if (m[1]) out.push({ k: "code", v: t.slice(1, -1) });
    else if (m[2]) {
      const parts = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      out.push({ k: "link", href: parts[2]!, c: inline(parts[1]!) });
    } else if (m[3]) out.push({ k: "strong", c: inline(t.slice(2, -2)) });
    else out.push({ k: "em", c: inline(t.slice(1, -1)) });
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const plain = (parts: Inline[]): string =>
  parts
    .map((p) => (typeof p === "string" ? p : p.k === "code" ? p.v : plain(p.c)))
    .join("");

const FENCE = /^```(\w*)\s*(.*)$/;
const CALLOUT = /^:::(note|important|limitation)\s*$/;
const EMBED = /^::([a-z][a-z0-9-]*)(?:\{([^}]*)\})?\s*$/;
const BULLET = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (row: string): string[] => {
  const t = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

function parseBlocks(lines: string[], ids: Map<string, number>, headings: Heading[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (line: string): boolean => FENCE.test(line) || CALLOUT.test(line) || EMBED.test(line) || /^#{1,3}\s/.test(line) || /^\|/.test(line) || BULLET.test(line) || /^---\s*$/.test(line);

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const meta = fence[2] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      const tab = /tab="([^"]*)"/.exec(meta)?.[1];
      const title = /title="([^"]*)"/.exec(meta)?.[1];
      blocks.push({ k: "code", lang: fence[1] || "text", code: code.join("\n"), ...(title ? { title } : {}), ...(tab ? { tab } : {}) });
      continue;
    }

    const callout = CALLOUT.exec(line);
    if (callout) {
      const inner: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i]!)) inner.push(lines[i++]!);
      i++;
      blocks.push({ k: "callout", kind: callout[1] as CalloutKind, c: parseBlocks(inner, ids, []) });
      continue;
    }

    const embed = EMBED.exec(line);
    if (embed) {
      const props: Record<string, string> = {};
      for (const m of (embed[2] ?? "").matchAll(/([a-z-]+)=("[^"]*"|\S+)/g)) props[m[1]!] = m[2]!.replace(/^"|"$/g, "");
      blocks.push({ k: "embed", name: embed[1]!, props });
      i++;
      continue;
    }

    if (/^---\s*$/.test(line)) {
      blocks.push({ k: "hr" });
      i++;
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      i++;
      const level = h[1]!.length;
      // A # title is the page title, which comes from the front matter.
      if (level === 1) continue;
      const text = h[2]!.trim();
      const base = slugify(text) || "section";
      const seen = ids.get(base) ?? 0;
      ids.set(base, seen + 1);
      const id = seen ? `${base}-${seen + 1}` : base;
      const heading = { k: "heading" as const, level: level as 2 | 3, id, text, c: inline(text) };
      blocks.push(heading);
      headings.push({ id, text: plain(heading.c), level: heading.level });
      continue;
    }

    if (line.startsWith("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      const head = cells(line).map(inline);
      const align = cells(lines[i + 1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) rows.push(cells(lines[i++]!).map(inline));
      blocks.push({ k: "table", head, rows, align });
      continue;
    }

    if (BULLET.test(line)) {
      const list = parseList(lines, i);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    // A paragraph runs to the next blank line or block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!)) para.push(lines[i++]!.trim());
    blocks.push({ k: "p", c: inline(para.join(" ")) });
  }

  return mergeTabs(blocks);
}

function parseList(lines: string[], start: number): { block: Extract<Block, { k: "list" }>; next: number } {
  const first = BULLET.exec(lines[start]!)!;
  const indent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = BULLET.exec(lines[i]!);
    if (!m) break;
    const here = m[1]!.length;
    if (here < indent) break;
    if (here > indent) {
      // One level of nesting, hung on the item above it.
      const nested = parseList(lines, i);
      const parent = items[items.length - 1];
      if (parent) parent.sub = nested.block;
      i = nested.next;
      continue;
    }
    const parts = [m[3]!.trim()];
    i++;
    // A wrapped item continues on indented lines that are not new items.
    while (i < lines.length && lines[i]!.trim() && !BULLET.test(lines[i]!) && /^\s+\S/.test(lines[i]!)) parts.push(lines[i++]!.trim());
    items.push({ c: inline(parts.join(" ")) });
  }
  return { block: { k: "list", ordered, items }, next: i };
}

/** Back-to-back fences that each carry tab="..." become one tabbed block. */
function mergeTabs(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.k === "code" && b.tab) {
      const tab = { label: b.tab, lang: b.lang, code: b.code };
      if (prev?.k === "tabs") prev.tabs.push(tab);
      else out.push({ k: "tabs", tabs: [tab] });
    } else out.push(b);
  }
  return out;
}

function textOf(blocks: Block[]): string {
  const bits: string[] = [];
  for (const b of blocks) {
    if (b.k === "heading") bits.push(b.text);
    else if (b.k === "p") bits.push(plain(b.c));
    else if (b.k === "list") bits.push(...b.items.flatMap((it) => [plain(it.c), ...(it.sub ? [textOf([it.sub])] : [])]));
    else if (b.k === "table") bits.push(...b.head.map(plain), ...b.rows.flatMap((r) => r.map(plain)));
    else if (b.k === "callout") bits.push(textOf(b.c));
    else if (b.k === "code") bits.push(b.code);
    else if (b.k === "tabs") bits.push(...b.tabs.map((t) => t.code));
  }
  return bits.join(" ");
}

export function parseDoc(src: string): ParsedDoc {
  const { meta, body } = frontMatter(src);
  const headings: Heading[] = [];
  const blocks = parseBlocks(body.split("\n"), new Map(), headings);
  return { title: meta.title, description: meta.description, blocks, headings, text: textOf(blocks).replace(/\s+/g, " ").trim() };
}
