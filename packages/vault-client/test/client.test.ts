import { describe, expect, it } from "vitest";
import {
  NearEvidenceClient,
  VaultExecutionError,
  assertAllowedNetwork,
  configFromEnv,
  readFinalOutcome,
  refusalReason,
} from "../src/index.js";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("network rule", () => {
  it("refuses mainnet", () => {
    expect(() => assertAllowedNetwork("mainnet")).toThrow("Mainnet is out of scope");
    expect(() => configFromEnv({ NEAR_NETWORK: "mainnet" })).toThrow("Mainnet is out of scope");
    expect(() => configFromEnv({})).toThrow();
  });

  it("requires an RPC URL on sandbox and defaults one on testnet", () => {
    expect(() => configFromEnv({ NEAR_NETWORK: "sandbox" })).toThrow("NEAR_RPC_URL");
    expect(configFromEnv({ NEAR_NETWORK: "testnet" }).rpc_url).toMatch(/^https:/);
    expect(configFromEnv({ NEAR_NETWORK: "sandbox", NEAR_RPC_URL: "http://127.0.0.1:3030" }).rpc_url).toBe("http://127.0.0.1:3030");
  });

  it("reads inline signers", () => {
    const signers = { "v.testnet": { agent: { account_id: "a.testnet", private_key: "ed25519:x" } } };
    expect(configFromEnv({ NEAR_NETWORK: "testnet", WARDLINE_VAULT_SIGNERS: JSON.stringify(signers) }).signers).toEqual(signers);
  });
});

describe("what counts as NEAR refusing a transaction", () => {
  it("a key that does not permit the call is proof nothing ran", () => {
    expect(refusalReason(new Error("Transaction has MethodNameMismatch"))).toBe("MethodNameMismatch");
    expect(refusalReason({ name: "InvalidTxError", message: "ReceiverMismatch" })).toBe("ReceiverMismatch");
  });

  it("a bad nonce or an expired hash is not: a retried transaction that already landed reports these", () => {
    expect(refusalReason(new Error("InvalidNonce: tx nonce must be larger"))).toBeNull();
    expect(refusalReason(new Error("Transaction Expired"))).toBeNull();
  });

  it("network errors and timeouts are not", () => {
    expect(refusalReason(new Error("fetch failed"))).toBeNull();
    expect(refusalReason(new Error("TIMEOUT_ERROR: timed out"))).toBeNull();
  });
});

describe("reading final outcomes", () => {
  const receipt = (executor_id: string, failed = false) => ({
    outcome: { executor_id, logs: [], status: failed ? { Failure: { ActionError: {} } } : { SuccessValue: "" } },
  });

  it("decodes the final RequestResult", () => {
    const outcome = readFinalOutcome({
      status: { SuccessValue: b64({ ok: true, operation_id: "op_1", rejection: null }) },
      transaction: { hash: "abc" },
      receipts_outcome: [receipt("vault"), receipt("token"), receipt("vault")],
    });
    expect(outcome.value).toEqual({ ok: true, operation_id: "op_1", rejection: null });
    expect(outcome.tx_hash).toBe("abc");
    expect(outcome.receipts.map((r) => r.executor_id)).toEqual(["vault", "token", "vault"]);
  });

  it("a failed token receipt under a successful final status is still a value, not a throw", () => {
    const outcome = readFinalOutcome({
      status: { SuccessValue: b64({ ok: true, operation_id: "op_1", rejection: null }) },
      transaction: { hash: "abc" },
      receipts_outcome: [receipt("vault"), receipt("token", true), receipt("vault")],
    });
    expect(outcome.receipts[1]?.failed).toBe(true);
    expect((outcome.value as { ok: boolean }).ok).toBe(true);
  });

  it("empty success is null", () => {
    expect(readFinalOutcome({ status: { SuccessValue: "" }, transaction: { hash: "h" } }).value).toBeNull();
  });

  it("a final failure throws with the panic code", () => {
    const failure = { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: E_NOT_OWNER" } } } };
    try {
      readFinalOutcome({ status: { Failure: failure }, transaction: { hash: "h" } });
    } catch (error) {
      expect(error).toBeInstanceOf(VaultExecutionError);
      expect((error as VaultExecutionError).code).toBe("E_NOT_OWNER");
      expect((error as VaultExecutionError).tx_hash).toBe("h");
      return;
    }
    throw new Error("expected a throw");
  });
});

describe("NearEvidenceClient", () => {
  it("initializes from config with default contract accounts", () => {
    const testnetClient = NearEvidenceClient.fromConfig({
      network: "testnet",
      rpc_url: "https://rpc.testnet.near.org",
      signers: {},
    });
    expect(testnetClient.contractId).toBe("evidence.redline-labs.testnet");
    expect(testnetClient.issuer).toBeUndefined();

    const sandboxClient = NearEvidenceClient.fromConfig({
      network: "sandbox",
      rpc_url: "http://127.0.0.1:3030",
      signers: {},
    });
    expect(sandboxClient.contractId).toBe("evidence.sandbox");
  });

  it("throws when mutation is called without an issuer signer", async () => {
    const client = NearEvidenceClient.fromConfig({
      network: "sandbox",
      rpc_url: "http://127.0.0.1:3030",
      signers: {},
    });
    await expect(
      client.commitSuite("sha256:1111", { name: "test", version: "1", case_count: 5 }),
    ).rejects.toThrow("no issuer signer configured");
  });
});
