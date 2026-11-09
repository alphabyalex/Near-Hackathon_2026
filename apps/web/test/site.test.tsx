import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationDetail, EvaluationSummary } from "@wardline/schemas";
import { limitsFromOverview, REFERENCE_LIMITS } from "../src/api/limits";
import { isScoredRun, scoreFrom } from "../src/api/scoring";
import { App } from "../src/App";
import { navigate, parseRoute } from "../src/router";
import { Scoring } from "../src/views/site/Scoring";

const SOURCES = import.meta.glob("../src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Fake API. Paths not listed answer 500, like a stopped API behind the dev proxy. */
function stubApi(routes: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^\/api/, "");
    if (path in routes) return new Response(JSON.stringify(routes[path]), { status: 200 });
    return new Response(JSON.stringify({ error: "down", message: "API down." }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const summary: EvaluationSummary = {
  run_id: "run_1",
  issuer: "Wardline team (self-issued)",
  execution_status: "COMPLETED",
  assessment_outcome: "MET_THRESHOLDS",
  manifest_digest: `sha256:${"a".repeat(64)}`,
  suite_commitment: `sha256:${"b".repeat(64)}`,
};

const detail = (onChain: string | null, matches = true): EvaluationDetail =>
  ({
    report: {
      ...summary,
      schema: "wardline-report-v1",
      metrics: [
        { metric_id: "useful_payments", label: "Paid", numerator: 19, denominator: 20 },
        { metric_id: "unsafe_proposals", label: "Unsafe", numerator: 2, denominator: 20 },
        { metric_id: "vault_containment", label: "Stopped", numerator: 2, denominator: 2 },
      ],
      cases: [],
      costs: { llm_input_tokens: 0, llm_output_tokens: 0, wall_clock_ms: 0, estimated_usd: null },
      limitations: [],
    },
    verification: { on_chain_digest: onChain, matches },
  }) as unknown as EvaluationDetail;

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  navigate("#/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseRoute", () => {
  it.each([
    ["", { kind: "site", page: "home" }],
    ["#/", { kind: "site", page: "home" }],
    ["#/vault", { kind: "site", page: "vault" }],
    ["#/scoring", { kind: "site", page: "scoring" }],
    ["#/about", { kind: "site", page: "about" }],
    ["#/nope", { kind: "site", page: "home" }],
    ["#/app/overview", { kind: "app", tab: "overview", invoice: null }],
    ["#/app", { kind: "app", tab: "overview", invoice: null }],
    ["#/app/nope", { kind: "app", tab: "overview", invoice: null }],
    ["#/app/invoices", { kind: "app", tab: "invoices", invoice: null }],
    ["#/app/invoices/int%5F1", { kind: "app", tab: "invoices", invoice: "int_1" }],
    ["#/app/invoices/%E0%A4%A", { kind: "app", tab: "invoices", invoice: null }],
    ["#/app/evaluation", { kind: "app", tab: "evaluation", invoice: null }],
    ["#/app/controls", { kind: "app", tab: "controls", invoice: null }],
  ])("reads %s", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
});

describe("routing", () => {
  it("follows link clicks in JS, with no hashchange event", () => {
    stubApi();
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Wardline is a credit union for the AI economy.");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByText("About"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Wardline decides where the money may go");
    expect(window.location.hash).toBe("#/about");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByText("About").getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getAllByLabelText("Wardline home")[0] as HTMLElement);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Wardline is a credit union for the AI economy.");
  });

  it("leaves new-tab clicks to the browser", () => {
    stubApi();
    render(<App />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByText("About"), { ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Wardline is a credit union for the AI economy.");
  });

  it("orders the site nav with About rightmost and gives the footer an owner sign-in link", () => {
    stubApi();
    render(<App />);
    const main = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(main.map((a) => a.textContent)).toEqual(["Mutual", "Groups", "Proof engine", "Demo", "Connect", "About"]);
    const footer = within(screen.getByRole("navigation", { name: "Footer" })).getAllByRole("link");
    expect(footer.at(-1)?.getAttribute("href")).toBe("#/app/overview");
    expect(footer.at(-1)?.textContent).toBe("Owner sign-in");
  });
});

describe("limit bars", () => {
  it("fall back to the reference values with no data", () => {
    expect(limitsFromOverview(null)).toBe(REFERENCE_LIMITS);
  });

  it("show the reference values on the vault page when the API is down", async () => {
    stubApi();
    navigate("#/vault");
    render(<App />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.getByText("9,060 / 15,000")).toBeTruthy();
    expect(screen.getByText("31,240 / 100,000")).toBeTruthy();
  });

  it("read the policy and usage when the overview loads", () => {
    const [exact, vendor, weekly, lifetime] = limitsFromOverview({
      token: { symbol: "USDC", contract_id: "x", decimals: 6, network: "NEAR testnet" },
      policy: { weekly_cap_atomic: "20000000000", lifetime_cap_atomic: "100000000000" },
      usage: { weekly_settled_atomic: "1250000000", weekly_reserved_atomic: "1000000000", lifetime_settled_atomic: "1250000000", lifetime_reserved_atomic: "1000000000" },
      vendors: [{ per_payment_cap_atomic: "1000000000" }, { per_payment_cap_atomic: "5000000000" }],
      unresolved_payments: [{ amount_atomic: "600000000" }],
    } as never);
    expect(exact?.value).toBe("600.00");
    expect(vendor).toMatchObject({ value: "5,000.00", settled: 12, cap: 12 });
    expect(weekly).toMatchObject({ value: "2,250 / 20,000", note: "1,000 reserved", settled: 6.2, reserved: 5 });
    expect(lifetime).toMatchObject({ value: "2,250 / 100,000", settled: 1.2, reserved: 1 });
  });
});

describe("scoring", () => {
  it("shows placeholders when no run exists", async () => {
    stubApi({ "/evaluations": [] });
    render(<Scoring />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.getAllByText("[ ] of 20").length).toBe(2);
    expect(screen.getByText("[ ] of 8")).toBeTruthy();
    expect(screen.getByText("[ ] of [ ]")).toBeTruthy();
    expect(screen.getByText("[ sha256 ]")).toBeTruthy();
  });

  it("shows real numbers from a scored run", async () => {
    stubApi({ "/evaluations": [summary], "/evaluations/run_1": detail(`sha256:${"c".repeat(64)}`) });
    render(<Scoring />);
    expect(await screen.findByText("19 of 20")).toBeTruthy();
    expect(screen.getByText("2 of 20")).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getByText("sha256:bbbbbbbb...bbbb")).toBeTruthy();
    expect(screen.getByText("[ ] of 8")).toBeTruthy();
  });

  it("ignores example and unfinished runs", () => {
    expect(isScoredRun(summary)).toBe(true);
    expect(isScoredRun({ ...summary, assessment_outcome: "NOT_ASSESSED" })).toBe(false);
    expect(isScoredRun({ ...summary, execution_status: "PARTIAL" })).toBe(false);
  });

  it("only calls a fingerprint on NEAR when the on-chain record matches", () => {
    expect(scoreFrom(detail(null)).fingerprint).toBe("[ sha256 ]");
    expect(scoreFrom(detail("sha256:x", false)).fingerprint).toBe("[ sha256 ]");
    expect(scoreFrom(detail("sha256:x")).fingerprint).toBe("sha256:bbbbbbbb...bbbb");
  });
});

describe("dashboard", () => {
  const SESSION = { "/owner/auth/session": { account: "owner.testnet", role: "owner" } };

  it("asks for sign-in when there is no session", async () => {
    stubApi();
    navigate("#/app/overview");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Meteor/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /MyNearWallet/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Test wallet/ })).toBeNull();
  });

  it("shows a load error, not a blank page, when the API is down", async () => {
    stubApi(SESSION);
    navigate("#/app/overview");
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("API down.");
    expect((screen.getByRole("button", { name: "Pause vault" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows Unpause vault when policy is paused and allows vault selection", async () => {
    stubApi({
      "/overview": {
        data_source: "mock",
        vault_id: "vault-a.wardline.testnet",
        token: { symbol: "USDC", contract_id: "usdc.testnet", decimals: 6, network: "NEAR testnet" },
        manifest: { version: "A" },
        binding: { enabled: true, manifest_digest: `sha256:${"a".repeat(64)}` },
        policy: { paused: true, weekly_cap_atomic: "1000000", lifetime_cap_atomic: "5000000" },
        vendors: [],
        usage: { balance_atomic: "50000000000", weekly_settled_atomic: "0", weekly_reserved_atomic: "0", lifetime_settled_atomic: "0", lifetime_reserved_atomic: "0" },
        headroom: { weekly_atomic: "1000000", lifetime_atomic: "5000000" },
        unresolved_payments: [],
      },
      ...SESSION,
    });
    navigate("#/app/overview");
    render(<App />);
    expect(await screen.findByRole("button", { name: "Unpause vault" })).toBeTruthy();
    expect(screen.getByLabelText("Select vault")).toBeTruthy();
  });
});

describe("source rules", () => {
  const sources = Object.entries(SOURCES).filter(([path]) => !path.endsWith("data/dots.ts"));

  it("covers the app", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.filter(([, text]) => text.length === 0).map(([path]) => path)).toEqual([]);
  });

  it.each([
    ["em dash", /—/],
    ["old product name", /spend[ _-]?gym/i],
    ["hackathon copy", /hackathon/i],
    ["demo disclaimer", /this is a demo|demo only|demo mode|demo data|for demo purposes|play money/i],
    ["localhost in copy", /localhost|127\.0\.0\.1|port 8787/i],
    ["testnet disclaimer", /testnet only/i],
    ["no value copy", /no value/i],
    ["banned mono font", /plex mono|geist mono|jetbrains|red hat mono|spline sans/i],
    ["raw HTML rendering", /dangerouslySetInnerHTML/],
  ])("has no %s", (_name, pattern) => {
    const hits = sources.filter(([, text]) => pattern.test(text)).map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it("names no fallback mono after Wardline Mono", () => {
    const tokens = Object.entries(SOURCES).find(([path]) => path.endsWith("theme/tokens.css"))?.[1] ?? "";
    expect(tokens).toContain('--mono: "Wardline Mono", monospace;');
  });

  it("turns motion off under prefers-reduced-motion", () => {
    const base = Object.entries(SOURCES).find(([path]) => path.endsWith("theme/base.css"))?.[1] ?? "";
    expect(base).toMatch(/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important\}/);
  });
});
