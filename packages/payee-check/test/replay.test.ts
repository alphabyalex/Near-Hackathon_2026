import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PayeeVendor } from "@wardline/schemas";
import { describe, expect, it } from "vitest";
import { replayFetch, type Recording } from "../scripts/fixture-format.js";
import { parseAccount } from "../src/caip.js";
import { checkPayee, resolvePayee } from "../src/engine.js";
import { InMemoryPayeeRegistry } from "../src/memory.js";
import { LruCache } from "../src/signals/cache.js";
import { NearSignalsProvider } from "../src/signals/near-signals.js";

/** Real NEAR testnet responses recorded once by scripts/record-payee-fixtures.ts. No network here. */
const REC = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "testnet-recording.json"), "utf8")) as Recording;
const VAULT = "vault-a.redline-labs.testnet";
const MISSING = "wardline-payee-missing-q7x2.testnet";

const replayProvider = () => {
  const fetch = replayFetch(REC);
  return { fetch, provider: new NearSignalsProvider({ network: "testnet", rpc: { rpcUrl: "https://replay.invalid", fetch }, cache: new LruCache() }) };
};

/** Synthetic registry entry pointing at a real testnet account. */
const VENDORS: PayeeVendor[] = [
  { domain: "redline-labs.com", name: "Wardline Labs (synthetic)", verifiedAt: "2026-11-06T05:00:00Z", accounts: [{ account: `near:testnet:${VAULT}`, status: "active", activatesAt: null }] },
];
const deps = (provider: NearSignalsProvider) => ({ registry: new InMemoryPayeeRegistry(VENDORS, () => Date.parse("2026-11-08T00:00:00Z")), signals: provider, now: () => Date.parse("2026-11-08T00:00:00Z") });

describe("recorded testnet fixtures", () => {
  it("was recorded within the live-call budget, without storing the endpoint", () => {
    expect(REC.live_calls).toBeLessThanOrEqual(50);
    expect(JSON.stringify(REC)).not.toMatch(/https?:\/\//);
  });

  it.each(Object.keys(REC.signals))("replays %s to exactly the signals computed live", async (id) => {
    const { fetch, provider } = replayProvider();
    expect(await provider.getSignals(parseAccount(id))).toEqual(REC.signals[id]);
    expect(fetch.misses).toEqual([]);
  });

  it("finds the vault's real creation block: absent one block earlier, present at it", () => {
    const at = (h: number) => REC.calls.find((c) => c.request.params["block_id"] === h && c.request.params["account_id"] === VAULT);
    const created = REC.signals[VAULT]!.createdAtBlock!;
    expect((at(created - 1)?.response.body as { error?: unknown }).error).toBeDefined();
    expect((at(created)?.response.body as { result?: unknown }).result).toBeDefined();
  });

  it("holds a verified but days-old vault with fresh code: NEW_ACCOUNT and RECENT_CODE_CHANGE", async () => {
    const r = await checkPayee({ payee: VAULT, vendor: { domain: "redline-labs.com" } }, deps(replayProvider().provider));
    expect(r.verdict).toBe("HOLD");
    expect(r.reasons.map((x) => x.code).sort()).toEqual(["NEW_ACCOUNT", "RECENT_CODE_CHANGE", "VERIFIED_MATCH"]);
    expect(r.signals).toMatchObject({ supported: true, accountExists: true, hasContract: true, fullAccessKeysAddedLast7d: 0 });
  });

  it("blocks a payee that does not exist on chain", async () => {
    const r = await checkPayee({ payee: `near:testnet:${MISSING}` }, deps(replayProvider().provider));
    expect(r.verdict).toBe("BLOCK");
    expect(r.reasons.map((x) => x.code).sort()).toEqual(["ACCOUNT_MISSING", "NOT_IN_REGISTRY"]);
  });

  it("resolve holds instead of returning a days-old account", async () => {
    const r = await resolvePayee({ domain: "redline-labs.com", chain: "near:testnet" }, deps(replayProvider().provider));
    expect(r).toMatchObject({ verdict: "HOLD", account: null });
    expect(r.reasons.map((x) => x.code).sort()).toEqual(["NEW_ACCOUNT", "RECENT_CODE_CHANGE", "VERIFIED_MATCH"]);
  });

  it("an unrecorded account behaves like an RPC outage: SIGNALS_UNAVAILABLE, no throw", async () => {
    const r = await checkPayee({ payee: "owner-a.redline-labs.testnet" }, deps(replayProvider().provider));
    expect(r.reasons.map((x) => x.code)).toContain("SIGNALS_UNAVAILABLE");
    expect(r.verdict).toBe("HOLD");
  });
});
