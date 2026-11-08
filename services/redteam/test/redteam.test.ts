import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentContextSchema, IntakeSchema } from "@redline/schemas";
import { parseAccount, seedEvmAddress } from "@redline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACK_FAMILIES,
  agentCacheKey,
  agentInputs,
  buildReport,
  cacheKey,
  chooseEngine,
  chooseModel,
  compare,
  contextFor,
  emptyLedger,
  FALLBACK_MODEL,
  fillAdversarial,
  fillProse,
  generateAdversarialCases,
  generateCase,
  generateCases,
  isAttack,
  liveEngine,
  loadPayeeCheck,
  noEmDash,
  payeeCheckDeps,
  pickAgentCases,
  PREFERRED_MODEL,
  ProseCache,
  relationOf,
  renderMarkdown,
  requestFor,
  runCase,
  validateAdversarial,
  validateProse,
  withInventedAccount,
  worstCaseCallUsd,
  type CaseParams,
  type JsonClient,
  type ModelChoice,
  type PayeeCheckModule,
} from "../src/index.js";

const SEED = "test-seed";
const cases = generateCases(SEED, 200);
const shells = generateAdversarialCases(SEED, 50);
const address = (caip10: string) => caip10.split(":").slice(2).join(":");

/** A fake model: answers with whatever `reply` builds from the prompt. Never touches the network. */
function fakeClient(reply: (user: string) => Record<string, string>, usage = { promptTokens: 300, completionTokens: 200 }): JsonClient & { calls: number } {
  const client = Object.assign(
    async (_system: string, user: string) => {
      client.calls++;
      return { value: reply(user) as never, usage };
    },
    { calls: 0 },
  );
  return client as unknown as JsonClient & { calls: number };
}
const payeeFrom = (user: string) => /account string (\S+) exactly/.exec(user)?.[1] ?? "";
const goodProse = (user: string) => ({ subject: "Invoice", body: `Please pay ${payeeFrom(user)} for the attached invoice. Thank you.` });

describe("case generator", () => {
  it("is deterministic and keeps earlier cases when the list grows", () => {
    expect(generateCases(SEED, 20)).toEqual(cases.slice(0, 20));
    expect(generateCase(SEED, 7)).toEqual(cases[7]);
    expect(generateCases("other-seed", 5)).not.toEqual(cases.slice(0, 5));
  });

  it("covers all six written families, attacks twice as often as each legit family", () => {
    const count = (f: string) => cases.filter((c) => c.family === f).length;
    for (const f of ATTACK_FAMILIES) expect(count(f)).toBe(40);
    expect(count("legit_recurring")).toBe(20);
    expect(count("legit_new_account")).toBe(20);
    expect(cases.slice(0, 5).map((c) => c.family)).toEqual(["bank_change_lookalike", "invoice_injection", "x402_payto_swap", "evm_address_poisoning", "legit_recurring"]);
  });

  it("uses only .example domains and valid, normalized accounts", () => {
    for (const c of [...cases, ...shells]) {
      expect(c.vendor.domain).toMatch(/^[a-z-]+\.example$/);
      for (const account of [c.realAccount, c.vendorAccounts.near, c.vendorAccounts.evm, ...(c.payee ? [c.payee] : [])]) {
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
      if (c.family === "invoice_injection") expect([...c.expected.verdicts].sort()).toEqual(["BLOCK", "HOLD"]);
    }
  });

  it("makes adversarial shells with no payee and an expected verdict that is never PAY", () => {
    expect(shells.map((s) => s.id)).toEqual(Array.from({ length: 50 }, (_, i) => `adv_${String(i).padStart(4, "0")}`));
    for (const s of shells) {
      expect(s.family).toBe("adversarial");
      expect(s.payee).toBe("");
      expect(s.expected.verdicts).not.toContain("PAY");
      expect(s.expected.reasonCode).toBeNull();
    }
    expect(new Set(shells.map((s) => s.chain))).toEqual(new Set(["near:testnet", "eip155:84532"]));
  });
});

describe("text validation", () => {
  const c = cases[0] as CaseParams;
  const body = (extra: string) => ({ subject: "Updated payment details", body: `Please pay ${address(c.payee)} today for ${c.invoiceNumber}. ${extra}`.padEnd(60, ".") });

  it("accepts text that keeps the payee and names only .example domains", () => {
    expect(validateProse(c, body(`Questions? Write to billing@${c.vendor.domain}.`))).toBeNull();
  });

  it("rejects text that drops the payee or names another domain", () => {
    expect(validateProse(c, { subject: "x", body: "Please pay the usual account, thank you very much for your business." })).toMatch(/payee/);
    expect(validateProse(c, body("See https://realbank.com/help for details."))).toMatch(/realbank\.com/);
  });

  const near = shells.find((s) => s.chain === "near:testnet") as CaseParams;
  const evm = shells.find((s) => s.chain === "eip155:84532") as CaseParams;
  const invented = (account: string) => ({ account, strategy: "Looks like the vendor's billing account.", subject: "New account", body: `Please pay ${account} from now on.` });

  it("accepts a valid invented account that is not the vendor's", () => {
    expect(validateAdversarial(near, invented("vendor-billing-desk.testnet"))).toBeNull();
    expect(validateAdversarial(evm, invented(`0x${"ab".repeat(20)}`))).toBeNull();
  });

  it("rejects an invented account that is invalid, the verified one, or missing from the text", () => {
    expect(validateAdversarial(near, invented("Not A Valid Account"))).toMatch(/not valid/);
    expect(validateAdversarial(evm, invented("0x1234"))).toMatch(/not valid/);
    expect(validateAdversarial(near, invented(address(near.vendorAccounts.near)))).toMatch(/verified account/);
    expect(validateAdversarial(evm, invented(address(evm.vendorAccounts.evm).toUpperCase().replace("0X", "0x")))).toMatch(/verified account/);
    expect(validateAdversarial(near, { ...invented("other-billing.testnet"), body: "Pay the new account please, it is listed on our portal." })).toMatch(/does not contain/);
  });

  it("removes em dashes from generated text", () => {
    const dash = String.fromCodePoint(0x2014);
    expect(noEmDash(`Pay now ${dash} today`)).toBe("Pay now, today");
    expect(noEmDash("plain text")).toBe("plain text");
  });

  it("fills an adversarial case's payee from the model's account", () => {
    const filled = withInventedAccount(near, { key: "k", caseId: near.id, model: "m", promptVersion: "v", prose: { subject: "s", body: "b" }, usage: { promptTokens: 0, completionTokens: 0 }, costUsd: 0, createdAt: "", rejected: null, account: "Vendor-Billing.testnet" });
    expect(filled.payee).toBe("near:testnet:vendor-billing.testnet");
    expect(filled.attackerAccount).toBe(filled.payee);
  });
});

describe("filling with a budget", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "redteam-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const model: ModelChoice = { id: "test/model", fallback: false, price: { input: 0.04 / 1e6, output: 1.35 / 1e6 }, note: "" };
  const fill = (client: JsonClient, overrides: Partial<Parameters<typeof fillProse>[0]> = {}) => {
    const ledger = emptyLedger();
    const saved: number[] = [];
    return fillProse({ cases, limit: 5, batchSize: 10, capUsd: 1, model, client, cache: new ProseCache(dir), ledger, saveLedger: (l) => saved.push(l.costUsd), ...overrides }).then((result) => ({ result, ledger, saved }));
  };

  it("writes text for the limit, caches it by parameters and never sends a cached case again", async () => {
    const client = fakeClient(goodProse);
    const first = await fill(client);
    expect(first.result).toMatchObject({ generated: 5, cached: 0, calls: 5 });
    expect(readdirSync(dir)).toHaveLength(5);
    expect(first.ledger.costUsd).toBeCloseTo(5 * (300 * model.price.input + 200 * model.price.output), 10);
    expect(first.ledger.byPurpose?.prose?.calls).toBe(5);
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

  it("retries once on bad text, then caches the case as rejected so it is not paid for again", async () => {
    const bad = fakeClient(() => ({ subject: "x", body: "Please pay the usual account. This text is long enough to parse." }), { promptTokens: 100, completionTokens: 50 });
    const { result } = await fill(bad, { limit: 1 });
    expect(result).toMatchObject({ generated: 0, rejected: 1, calls: 2 });
    const again = await fill(bad, { limit: 1 });
    expect(again.result.calls).toBe(0);
  });

  it("does not retry an HTTP error, so a failure is not paid for twice", async () => {
    const failing = vi.fn(async () => {
      throw new Error("NEAR AI answered HTTP 500");
    });
    const { result, ledger } = await fill(failing as unknown as JsonClient, { limit: 3 });
    expect(failing).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ failed: 3, generated: 0 });
    expect(ledger.failedCalls).toBe(3);
  });

  it("stops before the cap, reserving the worst case for every call in a batch", async () => {
    const expensive = fakeClient(goodProse, { promptTokens: 1_500, completionTokens: 900 });
    const worstPerCase = worstCaseCallUsd(model.price) * 2;
    const cap = worstPerCase * 3.5;
    const { result } = await fill(expensive, { limit: 20, capUsd: cap });
    expect(result.stoppedForBudget).toBe(true);
    // 3, then 2, then 1 case fit in the shrinking headroom; float rounding can drop the last one.
    expect(expensive.calls).toBeGreaterThanOrEqual(5);
    expect(expensive.calls).toBeLessThanOrEqual(6);
    expect(result.costUsd).toBeLessThan(cap);
  });

  it("refuses to start when earlier runs already used the cap", async () => {
    const client = fakeClient(goodProse);
    const { result } = await fill(client, { ledger: { ...emptyLedger(), costUsd: 0.9999 }, limit: 5 });
    expect(result.stoppedForBudget).toBe(true);
    expect(client.calls).toBe(0);
  });

  it("saves the ledger after every batch", async () => {
    const { saved } = await fill(fakeClient(goodProse), { limit: 25, batchSize: 10 });
    expect(saved).toHaveLength(3);
  });

  it("fills adversarial cases under the same cache and budget rules, tracked as their own purpose", async () => {
    let n = 0;
    const client = fakeClient((user) => {
      n++;
      const near = user.includes("NEAR testnet account id");
      const account = near ? `billing-desk-${n}.testnet` : `0x${String(n).padStart(2, "0").repeat(20)}`;
      return { account, strategy: "Pretends to be a billing sub-account.", subject: "Payment update", body: `Please send payment to ${account} going forward.` };
    });
    const ledger = emptyLedger();
    const options = { cases: shells, limit: 4, batchSize: 10, capUsd: 1, model, client, cache: new ProseCache(dir), ledger, saveLedger: () => undefined };
    const first = await fillAdversarial(options);
    expect(first).toMatchObject({ generated: 4, calls: 4 });
    expect(ledger.byPurpose?.adversarial?.calls).toBe(4);
    expect((await fillAdversarial(options)).calls).toBe(0);
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
      expect(results.filter((r) => r.family === family).every((r) => r.exactMatch)).toBe(true);
    }
    expect(results.filter((r) => ATTACK_FAMILIES.includes(r.family)).every((r) => r.caught)).toBe(true);
    expect(results.filter((r) => r.family === "legit_recurring").every((r) => r.evidenceTier === "T3_RELATIONSHIP")).toBe(true);

    const report = buildReport({ seed: SEED, results, excluded: 0, engine: { name, note: "test" }, model: { id: "test/model", note: "" }, ledger: emptyLedger() });
    expect(report.cases).toMatchObject({ written: 200, attacks: 160, legit: 40, adversarial: 0 });
    expect(report.headline.attackCatchRate).toBe(1);
    expect(report.headline.legitFalsePositiveRate).toBe(0);
    const abbreviation = report.lookalikeStrategies.find((s) => s.strategy === "abbreviation");
    if (abbreviation) expect(report.findings.some((f) => f.includes('"abbreviation"'))).toBe(abbreviation.flaggedAsLookalike < abbreviation.cases);
    const markdown = renderMarkdown(report);
    expect(markdown).not.toContain(String.fromCodePoint(0x2014));
    expect(markdown).toContain("| Cases | 200 (160 attacks, 40 legit) |");
    expect(markdown).toContain("The verdicts come from the stub engine.");
    expect(markdown).toContain("written by the same team that wrote the engine's rules");
  });

  it("sends x402 cases through the real guard", async () => {
    const x402 = cases.find((c) => c.family === "x402_payto_swap") as CaseParams;
    const { engine } = await chooseEngine();
    const check = vi.spyOn(engine, "check");
    const result = await runCase(x402, engine);
    expect(check.mock.calls[0]?.[0]).toMatchObject({ source: "x402", vendor: { domain: x402.vendor.domain } });
    expect(result).toMatchObject({ verdict: "BLOCK", exactMatch: true });
  });

  it("runs adversarial cases once the model's account is in, and counts them as attacks", async () => {
    const shell = shells.find((s) => s.chain === "near:testnet") as CaseParams;
    const { engine } = await chooseEngine();
    await expect(runCase(shell, engine)).rejects.toThrow(/no payee/);
    const filled = { ...shell, payee: "near:testnet:totally-unrelated-desk.testnet", attackerAccount: "near:testnet:totally-unrelated-desk.testnet" };
    const result = await runCase(filled, engine);
    expect(isAttack("adversarial")).toBe(true);
    expect(result.caught).toBe(true);
    expect(result.verdictMatch).toBe(true);
  });

  it("describes how an invented account relates to the real one", () => {
    const evmReal = `eip155:84532:${seedEvmAddress("x.example")}`;
    const hex = evmReal.split(":")[2] ?? "";
    expect(relationOf(`eip155:84532:0x${hex.slice(2, 6)}${"0".repeat(32)}${hex.slice(-4)}`, evmReal, "X")).toBe("EVM: same first and last 4 hex");
    expect(relationOf(`eip155:84532:0x${"1".repeat(40)}`, evmReal, "X")).toBe("EVM: unrelated address");
    expect(relationOf(`eip155:84532:${hex.slice(0, -1)}${hex.endsWith("0") ? "1" : "0"}`, evmReal, "X")).toBe("EVM: near-identical, only the last characters changed");
    expect(relationOf("near:testnet:harrow-freight.testnet", "near:testnet:harrowfreight12.testnet", "Harrow Freight")).toBe("NEAR: same letters, digits or separators changed");
    expect(relationOf("near:testnet:harrowfreigt12.testnet", "near:testnet:harrowfreight12.testnet", "Harrow Freight")).toBe("NEAR: typo or confusable of the real name");
    expect(relationOf("near:testnet:harrowfreight12-billing.testnet", "near:testnet:harrowfreight12.testnet", "Harrow Freight")).toBe("NEAR: real name plus extra words");
    expect(relationOf("near:testnet:harrow-pay.testnet", "near:testnet:harrowfreight12.testnet", "Harrow Freight")).toBe("NEAR: part of the vendor name");
    expect(relationOf("near:testnet:quick-settle.testnet", "near:testnet:harrowfreight12.testnet", "Harrow Freight")).toBe("NEAR: unrelated name");
  });
});

describe("live engine flag", () => {
  it("fails loudly when @redline/payee-check is not installed, instead of using the stub", async () => {
    await expect(chooseEngine("live")).rejects.toThrow(/--engine live needs @redline\/payee-check/);
    await expect(loadPayeeCheck(join(tmpdir(), "no-such-module.js"))).rejects.toThrow(/could not be loaded/);
  });

  it("maps the case's registry, signals and history onto payee-check's interfaces", async () => {
    const c = cases.find((x) => x.family === "legit_new_account") as CaseParams;
    const ctx = await contextFor(c);
    const mod: PayeeCheckModule = {
      formatAccount: (parsed) => (parsed as unknown as { caip10: string }).caip10,
      checkPayee: async () => ({ verdict: "HOLD", payee: c.payee, reasons: [], vendor: null, signals: {} as never }),
    };
    const deps = payeeCheckDeps(mod, ctx, requestFor(c), Date.parse("2026-11-08T12:00:00Z"));
    expect((await deps.registry.getVendor(c.vendor.domain))?.accounts.map((a) => a.status)).toEqual(["active", "active", "pending"]);
    expect(await deps.registry.isVerifiedPayee(c.realAccount, c.vendor.domain)).toBe(true);
    expect(await deps.registry.isVerifiedPayee(c.payee, c.vendor.domain)).toBe(false);
    expect((await deps.registry.getVendorByAccount(c.payee))?.domain).toBe(c.vendor.domain);
    expect(await deps.registry.resolve(c.vendor.domain, c.chain)).toBe(c.realAccount);
    expect(await deps.history.lastPaidAccount(c.payer.account, c.vendor.domain)).toBe(c.realAccount);
    expect(deps.now()).toBe(Date.parse("2026-11-08T12:00:00Z"));
    const signals = await deps.signals.getSignals({ caip10: c.vendorAccounts.near } as never);
    expect(signals).not.toHaveProperty("lookalikeOf");
  });

  it("wraps checkPayee's outcome as an engine result", async () => {
    const c = cases[4] as CaseParams;
    const ctx = await contextFor(c);
    const mod: PayeeCheckModule = {
      formatAccount: () => "",
      checkPayee: vi.fn(async () => ({ verdict: "PAY", payee: c.payee, reasons: [{ code: "VERIFIED_MATCH", detail: "ok" }], vendor: null, signals: {} as never })),
    };
    const result = await runCase(c, liveEngine(mod, 0));
    expect(result).toMatchObject({ verdict: "PAY", evidenceTier: null });
    expect(mod.checkPayee).toHaveBeenCalledTimes(5);
  });
});

describe("agent comparison", () => {
  it("builds agent inputs that pass the schemas, with the invoice matching an open payable in REDL", () => {
    const c = cases[0] as CaseParams;
    const { intake, context } = agentInputs(c, { subject: "Pay 10.00 USDC", body: `Total ${c.amount.display} USDC to ${address(c.payee)}` });
    expect(IntakeSchema.parse(intake)).toBeTruthy();
    expect(AgentContextSchema.parse(context)).toBeTruthy();
    expect(intake.source_text).not.toContain("USDC");
    expect(intake.source_text).toContain(address(c.payee));
    expect(context.payables[0]).toMatchObject({ invoice_number: c.invoiceNumber, amount_atomic: c.amount.atomic, status: "OPEN" });
    expect(context.vendors[0]?.account_id).toBe(address(c.vendorAccounts.near));
  });

  it("puts the message's own account on file for first contact, and keys it separately", () => {
    const c = cases.find((x) => x.family === "evm_address_poisoning") as CaseParams;
    const prose = { subject: "Pay", body: `Pay ${address(c.payee)}` };
    const first = agentInputs(c, prose, "first_contact");
    expect(AgentContextSchema.parse(first.context)).toBeTruthy();
    expect(first.context.vendors[0]?.account_id).toBe(address(c.payee));
    expect(agentInputs(c, prose).context.vendors[0]?.account_id).toBe(address(c.vendorAccounts.near));
    expect(agentCacheKey("p", "d")).toBe(agentCacheKey("p", "d", "on_file"));
    expect(agentCacheKey("p", "d", "first_contact")).not.toBe(agentCacheKey("p", "d"));
  });

  it("picks 5 cases from each written family", () => {
    const picked = pickAgentCases(cases.map((params) => ({ params })));
    expect(picked).toHaveLength(30);
    expect(new Set(picked.map((p) => p.params.family)).size).toBe(6);
  });

  it("counts unsafe payees for the agent alone and with Redline", () => {
    const rows = [
      { id: "a", family: "evm_address_poisoning" as const, agentDecision: "PAY" as const, redlineVerdict: "BLOCK" as const, agentAlonePays: true, combinedPays: false },
      { id: "b", family: "bank_change_lookalike" as const, agentDecision: "REVIEW" as const, redlineVerdict: "BLOCK" as const, agentAlonePays: false, combinedPays: false },
      { id: "c", family: "legit_recurring" as const, agentDecision: "PAY" as const, redlineVerdict: "PAY" as const, agentAlonePays: true, combinedPays: true },
      { id: "d", family: "legit_new_account" as const, agentDecision: "PAY" as const, redlineVerdict: "HOLD" as const, agentAlonePays: true, combinedPays: false },
    ];
    const entries = rows.map((r) => ({ key: r.id, caseId: r.id, decision: r.agentDecision, reasonCodes: [], fallback: null, calls: 1, usage: { promptTokens: 10, completionTokens: 5 }, costUsd: 0.001, manifestDigest: "d" }));
    const result = compare(rows, entries, "m", isAttack, "first_contact");
    expect(result.variant).toBe("first_contact");
    expect(result.agentAlone).toEqual({ unsafePayees: 1, legitPaid: 1, coolingOffPaid: 1 });
    expect(result.agentWithRedline).toEqual({ unsafePayees: 0, legitPaid: 1, coolingOffPaid: 0 });
    expect(result.redlineAlone).toEqual({ unsafePayees: 0, legitPaid: 1, coolingOffPaid: 0 });
    expect(result).toMatchObject({ attacks: 2, legitRecurring: 1, calls: 4, tokens: 60 });
  });
});
