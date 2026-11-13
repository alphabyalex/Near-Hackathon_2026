/** The docs' code panels: tabs, Copy and the one line. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVELOPERS } from "../src/brand";
import { CodeTabs } from "../src/components/CodeTabs";
import { SNIPPET_API_URL, SNIPPET_MCP_URL } from "../src/config";
import { pluginSnippets, pluginTabs, snippets } from "../src/data/snippets";
import { Embed } from "../src/docs/Embeds";

const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

const T = DEVELOPERS.tabs;
const PATHS = {
  ai: [T.js, T.py, T.curl],
  vendors: [T.mcp, T.mcpUrl, T.check, T.resolve, T.x402],
  app: [T.hosted, T.direct, T.curl],
} as const;

const show = (id: keyof typeof PATHS) => {
  cleanup();
  render(<Embed name="developer-tabs" props={{ path: id }} />);
};
const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
const visibleCode = () => screen.getByRole("tabpanel").querySelector("pre")?.textContent ?? "";

describe("the docs' code panels", () => {
  it("each path shows its own tabs", () => {
    for (const id of ["ai", "vendors", "app"] as const) {
      show(id);
      expect(tabNames()).toEqual([...PATHS[id]]);
      expect(screen.getAllByRole("tabpanel")).toHaveLength(1); // the others are hidden
      expect(screen.getByRole("tab", { selected: true })?.textContent).toContain(PATHS[id][0]);
    }
  });

  it("reaches all eight integrations", () => {
    const s = snippets(SNIPPET_API_URL, SNIPPET_MCP_URL);
    const seen: string[] = [];
    for (const id of ["ai", "vendors", "app"] as const) {
      show(id);
      for (const name of PATHS[id]) {
        fireEvent.click(screen.getByRole("tab", { name }));
        seen.push(visibleCode());
      }
    }
    const all = seen.join("\n");
    expect(all).toContain(s.openaiJs.split("\n")[3]); // OpenAI, JavaScript
    expect(all).toContain(`base_url="${SNIPPET_API_URL}/v1/ai"`); // OpenAI, Python
    expect(all).toContain(`${SNIPPET_API_URL}/v1/ai/chat/completions`); // OpenAI, curl
    expect(all).toContain('"mcpServers"'); // MCP config
    expect(seen).toContain(`1${SNIPPET_MCP_URL}\n${DEVELOPERS.oneLine}`); // MCP URL
    expect(all).toContain(`${SNIPPET_API_URL}/v1/resolve`);
    expect(all).toContain(`${SNIPPET_API_URL}/v1/check`);
    expect(all).toContain('mode: "hosted"');
    expect(all).toContain('mode: "direct"');
    expect(all).toContain("withWardline(fetch, { wardline })"); // x402 guard
  });

  it("highlights the one line", () => {
    show("ai");
    const line = screen.getByRole("tabpanel").querySelector("[data-one]");
    expect(line?.textContent).toContain(`baseURL: "${SNIPPET_API_URL}/v1/ai"`);
    expect(line?.textContent).toContain(DEVELOPERS.oneLine);
    expect(screen.getByRole("tabpanel").querySelectorAll("[data-one]")).toHaveLength(1);
  });

  it("Copy copies the visible snippet and says so", async () => {
    show("ai");
    fireEvent.click(screen.getByRole("tab", { name: T.py }));
    const copy = screen.getByRole("button", { name: `Copy ${T.py}` });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith(pluginSnippets().py);
    expect(copy?.textContent).toContain("Copied");
    expect(screen.getByRole("status")?.textContent).toContain(`${T.py} copied`);

    show("vendors");
    fireEvent.click(screen.getByRole("tab", { name: T.x402 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Copy ${T.x402}` }));
    });
    expect(writeText).toHaveBeenLastCalledWith(snippets(SNIPPET_API_URL, SNIPPET_MCP_URL).x402);
  });
});

describe("code tabs", () => {
  it("move with the arrow keys, Home and End, with one tab in the tab order", () => {
    render(<CodeTabs tabs={pluginTabs()} label="Plug in" />);
    const [js, py, curl] = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist", { name: "Plug in" })).toBeTruthy();
    expect([js, py, curl].map((t) => t?.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(js!, { key: "ArrowRight" });
    expect(py?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(py);
    fireEvent.keyDown(py!, { key: "End" });
    expect(curl?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(curl!, { key: "ArrowRight" });
    expect(js?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(js!, { key: "ArrowLeft" });
    expect(curl?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(curl!, { key: "Home" });
    expect(js?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel")?.getAttribute("aria-labelledby")).toBe(js!.id);
  });

  it("take a line number to highlight", () => {
    render(<CodeTabs tabs={[{ id: "a", label: "A", code: "one\ntwo\nthree", highlight: [2] }]} label="Lines" />);
    expect(screen.getByRole("tabpanel").querySelector("[data-one]")?.textContent).toContain("two");
  });
});

describe("plug-in snippets for Home", () => {
  it("share one base URL and the meter key across JavaScript, Python and curl", () => {
    const p = pluginSnippets("https://api.example.com");
    expect(p.js).toContain('baseURL: "https://api.example.com/v1/ai"');
    expect(p.py).toContain('base_url="https://api.example.com/v1/ai"');
    expect(p.curl).toContain("curl -si https://api.example.com/v1/ai/chat/completions");
    for (const code of [p.js, p.py, p.curl]) expect(code).toContain("WARDLINE_METER_KEY");
    expect(pluginTabs("https://api.example.com").map((t) => t.label)).toEqual([T.js, T.py, T.curl]);
  });
});
