import { parseDoc, type ParsedDoc } from "./parse";
import { groupOf, READING_ORDER } from "./nav";

// Every page is a markdown file in ./content, read at build time and parsed once.
const raw = import.meta.glob<string>("./content/*.md", { query: "?raw", import: "default", eager: true });

export const PAGES: Record<string, ParsedDoc> = Object.fromEntries(
  Object.entries(raw).map(([path, src]) => [path.replace(/^.*\/([^/]+)\.md$/, "$1"), parseDoc(src)]),
);

export const pageFor = (slug: string | undefined): ParsedDoc | null => (slug ? (PAGES[slug] ?? null) : null);

/** The page before and after this one in reading order. */
export function neighbours(slug: string): { prev: string | null; next: string | null } {
  const at = READING_ORDER.indexOf(slug);
  return { prev: at > 0 ? READING_ORDER[at - 1]! : null, next: at >= 0 && at < READING_ORDER.length - 1 ? READING_ORDER[at + 1]! : null };
}

export const groupTitle = (slug: string): string => groupOf(slug)?.title ?? "";
