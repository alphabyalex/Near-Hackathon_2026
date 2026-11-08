import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAccount } from "@redline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACK_FAMILIES,
  buildReport,
  cacheKey,
  chooseEngine,
  chooseModel,
  emptyLedger,
  FALLBACK_MODEL,
  fillProse,
  generateCase,
  generateCases,
  PREFERRED_MODEL,
  ProseCache,
  renderMarkdown,
  runCase,
  validateProse,
  worstCaseCallUsd,
  type CaseParams,
  type ModelChoice,
  type ProseClient,
} from "../src/index.js";

const SEED = "test-seed";
const cases = generateCases(SEED, 200);
const address = (caip10: string) => caip10.split(":").slice(2).join(":");

describe("case generator", () => {
  it("is deterministic and keeps earlier cases when the list grows", () => {
    expect(generateCases(SEED, 20)).toEqual(cases.slice(0, 20));
    expect(generateCase(SEED, 7)).toEqual(cases[7]);
    expect(generateCases("other-seed", 5)).not.toEqual(cases.slice(0, 5));
  });

  it("covers all six families, attacks twice as often as each legit family", () => {
    const count = (f: string) => cases.filter((c) => c.family === f).length;
    for (const f of ATTACK_FAMILIES) expect(count(f)).toBe(40);
    expect(count("legit_recurring")).toBe(20);
    expect(count("legit_new_account")).toBe(20);
    expect(cases.slice(0, 5).map((c) => c.family)).toEqual(["bank_change_lookalike", "invoice_injection", "x402_payto_swap", "evm_address_poisoning", "legit_recurring"]);
  });

  it("uses only .example domains and valid, normalized accounts", () => {
    for (const c of cases) {
      expect(c.vendor.domain).toMatch(/^[a-z-]+\.example$/);
      for (const account of [c.payee, c.realAccount, c.vendorAccounts.near, c.vendorAccounts.evm]) {
        expect(parseAccount(account).caip10).toBe(account);
      }
    }
  });

  it("builds attacks the way each family describes", () => {
    for (const c of cases) {
      if (c.attackerAccount) {
        expect(c.payee).toBe(c.attackerAccount);
        expect(c.payee).not.toBe(c.realAccount);
      }
      if (c.family === "x402_payto_swap" || c.family === "evm_address_poisoning") {
        const real = address(c.realAccount);
        const fake = address(c.payee);
        expect(fake.slice(0, 6)).toBe(real.slice(0, 6));
        expect(fake.slice(-4)).toBe(real.slice(-4));
      }
      if (c.family === "bank_change_lookalike") expect(c.chain).toBe("near:testnet");
      if (c.family === "legit_recurring") expect(c.payee).toBe(c.realAccount);
      if (c.family === "legit_new_account") {
        expect(c.newAccountHoursAgo).toBeLessThan(72);
        expect(c.payee).not.toBe(c.realAccount);
      }
      if (c.family === "x402_payto_swap") expect(c.claim).toBe("domain");
    }
  });

  it("sets the expected verdict from the family, never from text", () => {
    const expected = (c: CaseParams) => `${c.expected.verdicts.join("|")}:${c.expected.reasonCode}`;
    for (const c of cases) {
      if (c.family === "bank_change_lookalike" || c.family === "x402_payto_swap" || c.family === "evm_address_poisoning") expect(expected(c)).toBe("BLOCK:LOOKALIKE_ACCOUNT");
      if (c.family === "legit_recurring") expect(expected(c)).toBe("PAY:VERIFIED_MATCH");
      if (c.family === "legit_new_account") expect(expected(c)).toBe("HOLD:COOLING_OFF");
      if (c.family === "invoice_injection") expect(c.expected.verdicts.sort()).toEqual(["BLOCK", "HOLD"]);
    }
  });
});

describe("prose validation", () => {
  const c = cases[0] as CaseParams;
  const body = (extra: string) => ({ subject: "Updated payment details", body: `Please pay ${address(c.payee)} today for ${c.invoiceNumber}. ${extra}`.padEnd(60, ".") });

  it("accepts text that keeps the payee and names only .example domains", () => {
    expect(validateProse(c, body(`Questions? Write to billing@${c.vendor.domain}.`))).toBeNull();
  });

  it("rejects text that drops the payee or names another domain", () => {
    expect(validateProse(c, { subject: "x", body: "Please pay the usual account, thank you very much for your business." })).toMatch(/payee/);
    expect(validateProse(c, body("See https://realbank.com/help for details."))).toMatch(/realbank\.com/);
  });
});

describe("prose filling", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "redteam-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const model: ModelChoice = { id: "test/model", fallback: false, price: { input: 0.04 / 1e6, output: 1.35 / 1e6 }, note: "" };
  const goodClient = (): ProseClient & { calls: number } => {
    const client = Object.assign(
      async (_system: string, user: string) => {
        client.calls++;
        const payee = /account string (\S+) exactly/.exec(user)?.[1] ?? "";
        return { prose: { subject: "Invoice", body: `Please pay ${payee} for the attached invoice. Thank you.` }, usage: { promptTokens: 300, completionTokens: 200 } };
      },
      { calls: 0 },
    );
    return client;
  };
  const fill = (client: ProseClient, overrides: Partial<Parameters<typeof fillProse>[0]> = {}) => {
    const ledger = emptyLedger();
    const saved: number[] = [];
    return fillProse({ cases, limit: 5, batchSize: 10, capUsd: 1, model, client, cache: new ProseCache(dir), ledger, saveLedger: (l) => saved.push(l.costUsd), ...overrides }).then((result) => ({ result, ledger, saved }));
  };

  it("writes prose for the limit, caches it by parameters and never sends a cached case again", async () => {
    const client = goodClient();
    const first = await fill(client);
    expect(first.result).toMatchObject({ generated: 5, cached: 0, calls: 5 });
    expect(readdirSync(dir)).toHaveLength(5);
    expect(first.ledger.costUsd).toBeCloseTo(5 * (300 * model.price.input + 200 * model.price.output), 10);
    const second = await fill(client);
    expect(second.result).toMatchObject({ generated: 0, cached: 5, calls: 0 });
    expect(client.calls).toBe(5);
  });

  it("keys the cache by parameters and model", () => {
    const c = cases[0] as CaseParams;
    expect(cacheKey(c, "a")).toBe(cacheKey({ ...c }, "a"));
    expect(cacheKey(c, "a")).not.toBe(cacheKey(c, "b"));
    expect(cacheKey(c, "a")).not.toBe(cacheKey({ ...c, payee: c.realAccount }, "a"));
  });

  it("retries once on bad prose, then caches the case as rejected so it is not paid for again", async () => {
    const bad: ProseClient = async () => ({ prose: { subject: "x", body: "Please pay the usual account. This text is long enough to parse." }, usage: { promptTokens: 100, completionTokens: 50 } });
    const { result } = await fill(bad, { limit: 1 });
    expect(result).toMatchObject({ generated: 0, rejected: 1, calls: 2 });
    const again = await fill(bad, { limit: 1 });
    expect(again.result.calls).toBe(0);
  });

  it("does not retry an HTTP error, so a failure is not paid for twice", async () => {
    const failing = vi.fn(async () => {
      throw new Error("NEAR AI answered HTTP 500");
    });
    const { result, ledger } = await fill(failing, { limit: 3 });
    expect(failing).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ failed: 3, generated: 0 });
    expect(ledger.failedCalls).toBe(3);
  });

  it("stops before the cap, reserving the worst case for every call in a batch", async () => {
    // Every call spends the worst case, so the cap is what ends the run.
    let calls = 0;
    const expensive: ProseClient = async (_system, user) => {
      calls++;
      const payee = /account string (\S+) exactly/.exec(user)?.[1] ?? "";
      return { prose: { subject: "Invoice", body: `Please pay ${payee} for the attached invoice. Thank you.` }, usage: { promptTokens: 1_500, completionTokens: 900 } };
    };
    const worstPerCase = worstCaseCallUsd(model.price) * 2;
    const cap = worstPerCase * 3.5;
    const { result } = await fill(expensive, { limit: 20, capUsd: cap });
    expect(result.stoppedForBudget).toBe(true);
    // 3, then 2, then 1 case fit in the shrinking headroom; float rounding can drop the last one.
    expect(calls).toBeGreaterThanOrEqual(5);
    expect(calls).toBeLessThanOrEqual(6);
    expect(result.costUsd).toBeLessThan(cap);
  });

  it("refuses to start when earlier runs already used the cap", async () => {
    const client = goodClient();
    const ledger = { ...emptyLedger(), costUsd: 0.9999 };
    const { result } = await fill(client, { ledger, limit: 5 });
    expect(result.stoppedForBudget).toBe(true);
    expect(client.calls).toBe(0);
  });

  it("saves the ledger after every batch", async () => {
    const { saved } = await fill(goodClient(), { limit: 25, batchSize: 10 });
    expect(saved).toHaveLength(3);
  });
});

describe("model choice", () => {
  const listing = (ids: string[]) => (async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id, pricing: { input: 0.04, output: 1.35 } })) }))) as typeof fetch;

  it("uses the abliterated model when it is listed", async () => {
    expect(await chooseModel(listing([FALLBACK_MODEL, PREFERRED_MODEL]))).toMatchObject({ id: PREFERRED_MODEL, fallback: false, price: { input: 0.04 / 1e6, output: 1.35 / 1e6 } });
  });

  it("falls back to the repo default and says so", async () => {
    const choice = await chooseModel(listing([FALLBACK_MODEL]));
    expect(choice).toMatchObject({ id: FALLBACK_MODEL, fallback: true });
    expect(choice.note).toMatch(/not listed/);
  });
});

describe("runner on the stub engine", () => {
  it("runs all 200 cases with no unsafe PAY and no false positive", async () => {
    const { engine, name } = await chooseEngine();
    expect(name).toBe("stub");
    const results = await Promise.all(cases.map((c) => runCase(c, engine)));
    expect(results.filter((r) => r.unsafe)).toEqual([]);
    expect(results.filter((r) => r.falsePositive)).toEqual([]);
    for (const family of ["x402_payto_swap", "evm_address_poisoning", "legit_recurring", "legit_new_account"] as const) {
      const rows = results.filter((r) => r.family === family);
      expect(rows.every((r) => r.exactMatch)).toBe(true);
    }
    expect(results.filter((r) => ATTACK_FAMILIES.includes(r.family)).every((r) => r.caught)).toBe(true);
    const recurring = results.filter((r) => r.family === "legit_recurring");
    expect(recurring.every((r) => r.evidenceTier === "T3_RELATIONSHIP")).toBe(true);

    const report = buildReport({ seed: SEED, results, excluded: 0, engine: { name, note: "test" }, model: { id: "test/model", note: "" }, ledger: emptyLedger() });
    expect(report.cases).toMatchObject({ total: 200, attacks: 160, legit: 40 });
    expect(report.headline.attackCatchRate).toBe(1);
    expect(report.headline.legitFalsePositiveRate).toBe(0);
    const markdown = renderMarkdown(report);
    expect(markdown).not.toContain(String.fromCodePoint(0x2014));
    expect(markdown).toContain("| Cases | 200 (160 attacks, 40 legit) |");
  });

  it("sends x402 cases through the real guard", async () => {
    const x402 = cases.find((c) => c.family === "x402_payto_swap") as CaseParams;
    const { engine } = await chooseEngine();
    const check = vi.spyOn(engine, "check");
    const result = await runCase(x402, engine);
    expect(check.mock.calls[0]?.[0]).toMatchObject({ source: "x402", vendor: { domain: x402.vendor.domain } });
    expect(result).toMatchObject({ verdict: "BLOCK", exactMatch: true });
  });
});
