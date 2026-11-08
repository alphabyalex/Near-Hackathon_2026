import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND, HOME, TIERS } from "../src/brand";
import { REDTEAM, engineLabel, firstContact, percent } from "../src/redteam";
import { AccountDiff, countdown } from "../src/views/owner/ReviewDesk";
import { snippets } from "../src/views/site/Connect";
import { poisonedAddress } from "../src/views/site/Demo";
import { payeeMessage, proofFile } from "../src/views/site/Verify";
import { REASON_WORDS } from "../src/payee/reasons";
import { summarize } from "../vite/redteam";
import report from "../../../evidence/redteam/report.json";

afterEach(cleanup);

describe("brand module", () => {
  it("holds the product name and hero line", () => {
    expect(BRAND.name).toBe("Wardline");
    expect(BRAND.homeLabel).toBe(`${BRAND.name} home`);
    expect(`${HOME.heroLead} ${HOME.heroRest}.`).toBe("Your agent can read every invoice. It can never choose where the money goes.");
  });

  it("never claims legal ownership, and says what each trust level does not establish", () => {
    for (const tier of Object.values(TIERS)) expect(tier.notEstablished.length).toBeGreaterThan(0);
    expect(TIERS.T2_DOMAIN_LINKED.notEstablished).toContain("Legal ownership");
    expect(JSON.stringify(TIERS)).not.toMatch(/proves? (legal )?ownership|guaranteed|certified/i);
  });
});

describe("red-team numbers", () => {
  it("come from evidence/redteam/report.json at build time", () => {
    expect(REDTEAM).toEqual(summarize(report as never));
    expect(REDTEAM.engine.name).toBe(report.engine.name);
    expect(percent(REDTEAM.headline.attackCatchRate)).toBe(`${Math.round(report.headline.attackCatchRate * 1000) / 10}%`);
    expect(firstContact()?.agentAlone.unsafePayees).toBe(report.agentComparisons.find((c) => c.variant === "first_contact")?.agentAlone.unsafePayees);
  });

  it("names the engine", () => {
    expect(engineLabel("stub")).toContain("stub");
    expect(engineLabel("live")).toContain("payee-check");
  });
});

describe("connect snippets", () => {
  it("use the configured URLs", () => {
    const s = snippets("https://api.example.com", "https://mcp.example.com/mcp");
    expect(s.resolve).toContain("curl -s https://api.example.com/v1/resolve");
    expect(s.hosted).toContain('baseUrl: "https://api.example.com"');
    expect(s.mcp).toContain("https://mcp.example.com/mcp");
  });

  it("fall back to a variable, never a local address, when no URL is set", () => {
    const s = snippets(null, null);
    expect(s.resolve).toContain("$WARDLINE_API_URL/v1/resolve");
    expect(s.hosted).toContain("process.env.WARDLINE_API_URL!");
    expect(s.mcp).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/127\.0\.0\.1|localhost/);
  });
});

describe("helpers", () => {
  it("poisons an address keeping its first and last six characters", () => {
    const real = "0x1234567890abcdef1234567890abcdef12345678";
    const fake = poisonedAddress(real);
    expect(fake).not.toBe(real);
    expect(fake).toHaveLength(real.length);
    expect(fake.slice(0, 8)).toBe(real.slice(0, 8));
    expect(fake.slice(-6)).toBe(real.slice(-6));
  });

  it("builds the proof message and file the API verifies", () => {
    expect(payeeMessage("acme.example", "near:testnet:acme.testnet", "2026-11-08T00:00:00.000Z")).toBe("wardline-payee:v2:acme.example:near:testnet:acme.testnet:2026-11-08T00:00:00.000Z");
    expect(proofFile("acme.example", "Acme", "t", [])).toEqual({ version: 2, domain: "acme.example", name: "Acme", issued_at: "t", accounts: [] });
  });

  it("counts down a cooldown and stops at zero", () => {
    const now = Date.parse("2026-11-08T00:00:00Z");
    expect(countdown("2026-11-10T03:04:05Z", now)).toBe("51h 04m 05s");
    expect(countdown("2026-11-07T00:00:00Z", now)).toBeNull();
  });

  it("marks where a requested account differs from the one paid today", () => {
    render(<AccountDiff account="near:testnet:fernhill-cloud.testnet" against="near:testnet:fernhillcloud.testnet" />);
    expect(screen.getByText("-").tagName).toBe("MARK");
  });

  it("has plain words for every reason code", () => {
    expect(Object.keys(REASON_WORDS)).toHaveLength(12);
  });
});
