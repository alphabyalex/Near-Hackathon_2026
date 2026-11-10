import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditedRows, isChainRow, prefixHash, rowFromChain, type AuditStamp, type Rpc, type RowFields } from "../src/activity/log.js";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { createChain, defaultSimSeed } from "../src/chain/index.js";
import { toDateClock } from "../src/time.js";
import { LOCAL_AUTH } from "./helpers.js";

const HASH = "9Lq1WdbVX3BnqcAbVqdFeqmJxjZAbYMo47Qs3BsJQHzq";
const BLOCK = "6dMtvbmKQ3w3QzJa4D6Gm3TUZbSPRVdx8ZvbvhbdeHgr";
const FIELDS: RowFields = { actor: "dana.wardline-labs.testnet", community: "bgt_mission", kind: "call", amount: "15000", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", outcome: "paid", side: "above", reason: null, text: "Mission Street hacker house: proven and paid 0.02 USDC" };

/** A stand-in for NEAR RPC that knows one settle transaction in block 277,812,345. */
function fakeRpc(overrides: { status?: unknown; signer?: string } = {}): Rpc {
  return async (method, params) => {
    const p = params as { tx_hash?: string; block_id?: string };
    if (method === "tx") {
      if (p.tx_hash !== HASH) throw Object.assign(new Error("tx: UNKNOWN_TRANSACTION"), { definite: true });
      return {
        transaction: { hash: HASH, signer_id: overrides.signer ?? "meter.wardline-labs.testnet", receiver_id: "meter.wardline-labs.testnet", actions: [{ FunctionCall: { method_name: "settle" } }] },
        status: overrides.status ?? { SuccessValue: "" },
        receipts_outcome: [{ block_hash: BLOCK }],
      };
    }
    if (method === "block" && p.block_id === BLOCK) return { header: { height: 277_812_345, timestamp: "1794240000000000000" } };
    throw new Error(`unexpected ${method}`);
  };
}

describe("activity rows come only from RPC", () => {
  it("builds a row with the hash, signer, block height and time RPC returned", async () => {
    const row = await rowFromChain(fakeRpc(), HASH, "meter.wardline-labs.testnet", FIELDS);
    expect(row).toMatchObject({ tx: HASH, block_height: 277_812_345, signer: "meter.wardline-labs.testnet", receiver: "meter.wardline-labs.testnet", at: "2026-11-09T16:00:00.000Z", outcome: "paid" });
    expect(isChainRow(row)).toBe(true);
  });

  it("refuses the made-up hashes the old batch wrote", async () => {
    await expect(rowFromChain(fakeRpc(), "tx_b87e8e15a11eb162d9634a7e68cc6097dc4705f3ed04", "meter.wardline-labs.testnet", FIELDS)).rejects.toThrow(/Not a NEAR transaction hash/);
    await expect(rowFromChain(fakeRpc(), "meter.wardline-labs.testnet:call_0a1b2c3d", "meter.wardline-labs.testnet", FIELDS)).rejects.toThrow(/Not a NEAR transaction hash/);
    const old = { at: "2026-11-10T03:58:09.930Z", actor: "dana.wardline-labs.testnet", community: "bgt_mission", kind: "call", tx: "tx_b87e8e15a11eb162d9634a7e68cc6097dc4705f3ed04", block_height: 277000000 };
    expect(isChainRow(old)).toBe(false);
  });

  it("refuses a well-formed hash RPC does not know", async () => {
    await expect(rowFromChain(fakeRpc(), "4Lq1WdbVX3BnqcAbVqdFeqmJxjZAbYMo47Qs3BsJQHzq", "meter.wardline-labs.testnet", FIELDS)).rejects.toThrow(/UNKNOWN_TRANSACTION/);
  });

  it("refuses a failed transaction and a signer mismatch", async () => {
    await expect(rowFromChain(fakeRpc({ status: { Failure: { ActionError: {} } } }), HASH, "meter.wardline-labs.testnet", FIELDS)).rejects.toThrow(/did not succeed/);
    await expect(rowFromChain(fakeRpc({ signer: "someone.testnet" }), HASH, "meter.wardline-labs.testnet", FIELDS)).rejects.toThrow(/signed by someone.testnet/);
  });
});

describe("the API serves only audited rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "wardline-activity-"));
  const row = { at: "2026-11-09T14:40:00.000Z", ...FIELDS, tx: HASH, block_height: 277_812_345, signer: "meter.wardline-labs.testnet", receiver: "meter.wardline-labs.testnet" };
  const log = `${JSON.stringify(row)}\n`;
  const stamp = (rows: number, text: string): string => JSON.stringify({ passed: true, at: "2026-11-09T15:00:00Z", rows, sha256: prefixHash(text.trim().split("\n"), rows), rpc: "test" } satisfies AuditStamp);

  afterEach(() => vi.unstubAllEnvs());

  it("returns nothing without a stamp, and nothing after the log is edited", () => {
    expect(auditedRows(log, null)).toMatchObject({ audited: false, rows: [], pending: 1 });
    const edited = log.replace("15000", "99999");
    expect(auditedRows(edited, stamp(1, log))).toMatchObject({ audited: false, rows: [] });
  });

  it("serves the audited prefix and holds back rows appended since", () => {
    const later = `${log}${JSON.stringify({ ...row, tx: "4Lq1WdbVX3BnqcAbVqdFeqmJxjZAbYMo47Qs3BsJQHzq" })}\n`;
    const read = auditedRows(later, stamp(1, log));
    expect(read.audited).toBe(true);
    expect(read.rows.map((r) => r.tx)).toEqual([HASH]);
    expect(read.pending).toBe(1);
  });

  function app(mode: "sim" | "near") {
    const clock = () => BigInt(Date.parse("2026-11-09T15:00:00Z")) * 1_000_000n;
    const chain = createChain(mode, toDateClock(clock), defaultSimSeed());
    return createApp(bootstrap(":memory:", clock, {}, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: mode }, chain }));
  }

  it("answers 503 in near mode when the log never passed an audit", async () => {
    writeFileSync(join(dir, "never.jsonl"), log);
    vi.stubEnv("WARDLINE_ACTIVITY_LOG", join(dir, "never.jsonl"));
    vi.stubEnv("WARDLINE_ACTIVITY_AUDIT", join(dir, "missing-audit.json"));
    const res = await app("near").request("/v1/activity");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("ACTIVITY_NOT_AUDITED");
  });

  it("serves audited rows with explorer links once the stamp matches", async () => {
    writeFileSync(join(dir, "ok.jsonl"), log);
    writeFileSync(join(dir, "ok-audit.json"), stamp(1, log));
    vi.stubEnv("WARDLINE_ACTIVITY_LOG", join(dir, "ok.jsonl"));
    vi.stubEnv("WARDLINE_ACTIVITY_AUDIT", join(dir, "ok-audit.json"));
    const res = await app("sim").request("/v1/activity");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activity: Array<{ tx: string; explorer_url: string; block_height: number }>; total: number };
    expect(body.total).toBe(1);
    expect(body.activity[0]).toMatchObject({ tx: HASH, block_height: 277_812_345, explorer_url: `https://testnet.nearblocks.io/txns/${HASH}` });
  });
});
