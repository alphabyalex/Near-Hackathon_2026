/** The docs: the markdown reader, the structure, and the search. */
import { describe, expect, it } from "vitest";
import { neighbours, PAGES } from "../src/docs/content";
import { NAV_GROUPS, READING_ORDER, START_HERE } from "../src/docs/nav";
import { frontMatter, inline, parseDoc, plain, slugify } from "../src/docs/parse";
import { searchDocs } from "../src/docs/search";
import { parseRoute, redirected } from "../src/router";

describe("the markdown reader", () => {
  it("reads front matter and leaves the body", () => {
    const { meta, body } = frontMatter("---\ntitle: A page\ndescription: What it is.\n---\n\nHello.\n");
    expect(meta).toEqual({ title: "A page", description: "What it is." });
    expect(body.trim()).toBe("Hello.");
  });

  it("turns ## and ### into headings with unique ids, and skips the # title", () => {
    const doc = parseDoc("---\ntitle: T\ndescription: D\n---\n# Ignored\n\n## Same name\n\n### Same name\n\n## Same name\n");
    expect(doc.headings.map((h) => h.id)).toEqual(["same-name", "same-name-2", "same-name-3"]);
    expect(doc.headings.map((h) => h.level)).toEqual([2, 3, 2]);
    expect(doc.blocks.some((b) => b.k === "heading" && b.text === "Ignored")).toBe(false);
  });

  it("slugs are lowercase words joined by hyphens", () => {
    expect(slugify("Wallet-signed actions")).toBe("wallet-signed-actions");
    expect(slugify("1. Change one line")).toBe("1-change-one-line");
    expect(slugify("`x-wardline-proof` header")).toBe("x-wardline-proof-header");
  });

  it("reads inline code, links, bold and italics, and nothing else", () => {
    const parts = inline("a `b` [c](#/docs/x) **d** *e* <script>f</script>");
    expect(parts).toEqual(["a ", { k: "code", v: "b" }, " ", { k: "link", href: "#/docs/x", c: ["c"] }, " ", { k: "strong", c: ["d"] }, " ", { k: "em", c: ["e"] }, " <script>f</script>"]);
    expect(plain(parts)).toBe("a b c d e <script>f</script>");
  });

  it("reads tables with alignment and escaped pipes", () => {
    const doc = parseDoc("| A | B |\n| --- | ---: |\n| `x \\| y` | 2 |\n");
    const table = doc.blocks[0];
    expect(table?.k).toBe("table");
    if (table?.k !== "table") return;
    expect(table.align).toEqual([null, "right"]);
    expect(plain(table.rows[0]![0]!)).toBe("x | y");
  });

  it("reads lists with one level of nesting and wrapped items", () => {
    const doc = parseDoc("- one\n  continues\n  - nested\n- two\n\n1. first\n2. second\n");
    const [ul, ol] = doc.blocks;
    expect(ul?.k === "list" && ul.items.map((i) => plain(i.c))).toEqual(["one continues", "two"]);
    expect(ul?.k === "list" && ul.items[0]?.sub?.items.map((i) => plain(i.c))).toEqual(["nested"]);
    expect(ol?.k === "list" && ol.ordered).toBe(true);
  });

  it("merges back-to-back tab fences into one tabbed block and keeps a lone fence as code", () => {
    const doc = parseDoc('```ts tab="JavaScript"\na\n```\n```python tab="Python"\nb\n```\n\n```sh\nc\n```\n');
    expect(doc.blocks.map((b) => b.k)).toEqual(["tabs", "code"]);
    const tabs = doc.blocks[0];
    expect(tabs?.k === "tabs" && tabs.tabs.map((t) => t.label)).toEqual(["JavaScript", "Python"]);
  });

  it("reads callouts and embeds", () => {
    const doc = parseDoc(":::limitation\nNot a promise.\n:::\n\n::developer-tabs{path=ai}\n");
    expect(doc.blocks[0]).toMatchObject({ k: "callout", kind: "limitation" });
    expect(doc.blocks[1]).toEqual({ k: "embed", name: "developer-tabs", props: { path: "ai" } });
  });
});

describe("the docs' structure", () => {
  it("every listed page has a file, and every file is listed once", () => {
    const listed = NAV_GROUPS.flatMap((g) => g.pages);
    expect(new Set(listed).size).toBe(listed.length);
    for (const slug of listed) expect(PAGES[slug], `missing content/${slug}.md`).toBeDefined();
    for (const slug of Object.keys(PAGES)) expect(listed, `content/${slug}.md is not in the nav`).toContain(slug);
  });

  it("every page has a title, a description and at least one heading", () => {
    for (const [slug, doc] of Object.entries(PAGES)) {
      expect(doc.title, slug).not.toBe("");
      expect(doc.description, slug).not.toBe("");
      expect(doc.headings.length, slug).toBeGreaterThan(0);
    }
  });

  it("every internal link points at a page and, when it names one, a heading that exists", () => {
    const bad: string[] = [];
    const visit = (slug: string, parts: ReturnType<typeof inline>) => {
      for (const p of parts) {
        if (typeof p === "string" || p.k === "code") continue;
        if (p.k === "link") {
          const m = /^#\/docs\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(p.href);
          if (p.href.startsWith("#/docs")) {
            if (!m && p.href !== "#/docs") bad.push(`${slug}: ${p.href}`);
            else if (m && !PAGES[m[1]!]) bad.push(`${slug}: ${p.href} (no such page)`);
            else if (m?.[2] && !PAGES[m[1]!]!.headings.some((h) => h.id === m[2])) bad.push(`${slug}: ${p.href} (no such heading)`);
          }
          visit(slug, p.c);
        } else visit(slug, p.c);
      }
    };
    const walk = (slug: string, blocks: ReturnType<typeof parseDoc>["blocks"]) => {
      for (const b of blocks) {
        if (b.k === "p") visit(slug, b.c);
        else if (b.k === "list") for (const it of b.items) visit(slug, it.c);
        else if (b.k === "table") for (const row of [b.head, ...b.rows]) for (const c of row) visit(slug, c);
        else if (b.k === "callout") walk(slug, b.c);
      }
    };
    for (const [slug, doc] of Object.entries(PAGES)) walk(slug, doc.blocks);
    expect(bad).toEqual([]);
  });

  it("no page uses an em dash", () => {
    for (const [slug, doc] of Object.entries(PAGES)) expect(`${doc.title} ${doc.description} ${doc.text}`.includes("—"), slug).toBe(false);
  });

  it("the start-here cards and previous/next follow the nav", () => {
    for (const c of START_HERE) expect(PAGES[c.slug]).toBeDefined();
    expect(neighbours(READING_ORDER[0]!)).toEqual({ prev: null, next: READING_ORDER[1] });
    expect(neighbours(READING_ORDER[READING_ORDER.length - 1]!).next).toBeNull();
    expect(neighbours("introduction").prev).toBeNull();
  });
});

describe("docs routes", () => {
  it("#/docs/<page>/<heading> names a page and a heading", () => {
    expect(parseRoute("#/docs")).toEqual({ kind: "site", page: "docs" });
    expect(parseRoute("#/docs/governance")).toEqual({ kind: "site", page: "docs", doc: "governance" });
    expect(parseRoute("#/docs/governance/how-a-vote-runs")).toEqual({ kind: "site", page: "docs", doc: "governance", anchor: "how-a-vote-runs" });
  });

  it("the old Developers addresses land on the Quickstart", () => {
    expect(redirected("#/developers")).toBe("#/docs/quickstart");
    expect(redirected("#/connect")).toBe("#/docs/quickstart");
    expect(parseRoute(redirected("#/connect"))).toEqual({ kind: "site", page: "docs", doc: "quickstart" });
  });
});

describe("docs search", () => {
  it("finds a page by its title, ahead of pages that only mention it", () => {
    expect(searchDocs("quickstart")[0]).toMatchObject({ slug: "quickstart", anchor: null });
    expect(searchDocs("glossary")[0]?.slug).toBe("glossary");
  });

  it("finds a heading and links to it", () => {
    const hit = searchDocs("wallet-signed actions").find((h) => h.slug === "api-reference");
    expect(hit).toMatchObject({ anchor: "wallet-signed-actions", heading: "Wallet-signed actions" });
  });

  it("finds a word in the body of a page that has no matching heading", () => {
    const hit = searchDocs("quorum").find((h) => h.slug === "governance");
    expect(hit).toBeDefined();
  });

  it("needs every word, and says nothing for nonsense", () => {
    expect(searchDocs("quorum zzzzzz")).toEqual([]);
    expect(searchDocs("   ")).toEqual([]);
    expect(searchDocs("qqqxxx")).toEqual([]);
  });
});
