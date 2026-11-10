import { describe, expect, it } from "vitest";
import { checkLocalSigner } from "../vite/local-signer";
import { LOCAL_SIGNER } from "../src/config";
import { nearWallets } from "../src/wallets/near";

describe("the local test signer in the web app", () => {
  it("is off without VITE_WARDLINE_LOCAL_SIGNER=1", () => {
    expect(checkLocalSigner({ flag: undefined, command: "serve", host: "127.0.0.1", network: "testnet" })).toBe(false);
    expect(checkLocalSigner({ flag: "true", command: "build", host: "0.0.0.0", network: "mainnet" })).toBe(false);
  });

  it("refuses any production build", () => {
    expect(() => checkLocalSigner({ flag: "1", command: "build", host: "127.0.0.1", network: "testnet" })).toThrow(/dev server only/);
  });

  it("refuses a dev server that is not bound to 127.0.0.1", () => {
    for (const host of ["0.0.0.0", true, "localhost", "192.168.1.20"]) {
      expect(() => checkLocalSigner({ flag: "1", command: "serve", host, network: "testnet" })).toThrow(/127\.0\.0\.1/);
    }
  });

  it("refuses any network but testnet", () => {
    expect(() => checkLocalSigner({ flag: "1", command: "serve", host: "127.0.0.1", network: "mainnet" })).toThrow(/testnet only/);
    expect(checkLocalSigner({ flag: "1", command: "serve", host: "127.0.0.1", network: "testnet" })).toBe(true);
  });

  it("is not offered as a wallet in this build", () => {
    expect(LOCAL_SIGNER).toBe(false);
    expect(nearWallets().map((w) => w.id)).not.toContain("local-signer");
  });
});
