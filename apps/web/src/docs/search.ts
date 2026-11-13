import { groupTitle, PAGES } from "./content";


export interface Hit {
  slug: string;
  /** A heading id on the page, or null for the page itself. */
  anchor: string | null;
  title: string;
  group: string;
  heading: string | null;
  snippet: string;
  score: number;
}

type Kind = "page" | "heading" | "body";

interface Entry {
  kind: Kind;
  slug: string;
  anchor: string | null;
  title: string;
  group: string;
  heading: string | null;
  haystack: string;
  body: string;
}

let index: Entry[] | null = null;

function build(): Entry[] {
  const out: Entry[] = [];
  for (const [slug, doc] of Object.entries(PAGES)) {
    const group = groupTitle(slug);
    const base = { slug, title: doc.title, group };
    out.push({ ...base, kind: "page", anchor: null, heading: null, haystack: `${doc.title} ${doc.description}`.toLowerCase(), body: doc.description });
    for (const h of doc.headings) out.push({ ...base, kind: "heading", anchor: h.id, heading: h.text, haystack: h.text.toLowerCase(), body: "" });
    out.push({ ...base, kind: "body", anchor: null, heading: null, haystack: doc.text.toLowerCase(), body: doc.text });
  }
  return out;
}

const around = (body: string, at: number): string => {
  const start = Math.max(0, at - 48);
  const end = Math.min(body.length, at + 110);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
};

const WEIGHT: Record<Kind, number> = { page: 100, heading: 60, body: 10 };

/**
 * Every word must appear. A page match beats a heading match beats a body match, and a title that contains the
 * whole query beats the rest. A body match is shown only for a page that nothing else on it matched.
 */
export function searchDocs(query: string, limit = 8): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  index ??= build();
  const hits: Hit[] = [];
  const matchedPages = new Set<string>();
  for (const e of index) {
    if (!words.every((w) => e.haystack.includes(w))) continue;
    if (e.kind !== "body") matchedPages.add(e.slug);
    const wholeTitle = e.kind === "page" && e.title.toLowerCase().includes(words.join(" ")) ? 40 : 0;
    hits.push({
      slug: e.slug,
      anchor: e.anchor,
      title: e.title,
      group: e.group,
      heading: e.heading,
      snippet: e.kind === "body" ? around(e.body, e.haystack.indexOf(words[0]!)) : e.kind === "page" ? e.body : "",
      score: WEIGHT[e.kind] + wholeTitle,
    });
  }
  return hits
    .filter((h) => h.score >= 60 || !matchedPages.has(h.slug))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
