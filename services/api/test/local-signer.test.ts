import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { createChain, defaultSimSeed } from "../src/chain/index.js";
import { LocalSignerRefused, localSignerFromEnv } from "../src/local-signer.js";
import { toDateClock } from "../src/time.js";
import { LOCAL_AUTH } from "./helpers.js";

describe("the local test signer's three guards", () => {
  it("is off unless WARDLINE_LOCAL_SIGNER=1", () => {
    expect(localSignerFromEnv({}, "127.0.0.1", "near")).toBe(false);
    expect(localSignerFromEnv({ WARDLINE_LOCAL_SIGNER: "true" }, "127.0.0.1", "near")).toBe(false);
    expect(localSignerFromEnv({ WARDLINE_LOCAL_SIGNER: "1" }, "127.0.0.1", "near")).toBe(true);
  });

  it("refuses to start on anything but 127.0.0.1", () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.20", "localhost"]) {
      expect(() => localSignerFromEnv({ WARDLINE_LOCAL_SIGNER: "1" }, host, "near")).toThrow(LocalSignerRefused);
    }
  });

  it("refuses to start off testnet, outside near mode, or in production", () => {
    expect(() => localSignerFromEnv({ WARDLINE_LOCAL_SIGNER: "1", WARDLINE_NEAR_NETWORK: "mainnet" }, "127.0.0.1", "near")).toThrow(/testnet only/);
    expect(() => localSignerFromEnv({ WARDLINE_LOCAL_SIGNER: "1" }, "127.0.0.1", "sim")).toThrow(/near/);
    expect(() => localSignerFromEnv({ WARDLINE_LOCAL_SIGNER: "1", NODE_ENV: "production" }, "127.0.0.1", "near")).toThrow(/production/);
  });

  function app(localSigner: boolean) {
    const clock = () => BigInt(Date.parse("2026-11-10T12:00:00Z")) * 1_000_000n;
    const chain = createChain("sim", toDateClock(clock), defaultSimSeed());
    return createApp(bootstrap(":memory:", clock, {}, LOCAL_AUTH, { env: { WARDLINE_CHAIN_MODE: "sim" }, chain }), { localSigner });
  }

  it("has no routes unless the guards passed, and refuses other origins and requests without its header", async () => {
    expect((await app(false).request("/v1/local-signer")).status).toBe(404);
    const on = app(true);
    expect((await on.request("/v1/local-signer")).status).toBe(200);
    const body = JSON.stringify({ action: "vote", account: "dana.wardline-labs.testnet", id: 1, support: "for" });
    const post = (headers: Record<string, string>) => on.request("/v1/local-signer/mutual", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    expect((await post({ origin: "https://evil.example", "x-wardline-local-signer": "1" })).status).toBe(403);
    expect((await post({ origin: "http://127.0.0.1:5173" })).status).toBe(403);
  });
});
