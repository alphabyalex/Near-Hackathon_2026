import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDeploymentPrefix,
  requireTestnet,
  restrictedKeyViolations,
  subaccount,
} from "../dist/common.js";

function functionKey({
  publicKey = "ed25519:expected",
  receiver = "vault.testnet",
  methods = ["request_payment"],
  allowance = "750000000000000000000000",
} = {}) {
  return {
    public_key: publicKey,
    access_key: {
      nonce: 1,
      permission: {
        FunctionCall: {
          allowance,
          receiver_id: receiver,
          method_names: methods,
        },
      },
    },
  };
}

test("restricted key audit accepts one bounded request_payment key", () => {
  assert.deepEqual(
    restrictedKeyViolations(
      [functionKey()],
      "ed25519:expected",
      "vault.testnet",
    ),
    [],
  );
});

test("restricted key audit rejects full access, wrong receiver, broad methods, and unlimited allowance", () => {
  const keys = [
    {
      public_key: "ed25519:expected",
      access_key: { nonce: 1, permission: "FullAccess" },
    },
    functionKey({
      publicKey: "ed25519:other",
      receiver: "other-vault.testnet",
      methods: [],
      allowance: null,
    }),
  ];
  const violations = restrictedKeyViolations(
    keys,
    "ed25519:expected",
    "vault.testnet",
  );
  assert.ok(violations.some((value) => value.includes("exactly one")));
  assert.ok(violations.some((value) => value.includes("full access")));
  assert.ok(violations.some((value) => value.includes("unexpected public key")));
});

test("restricted key audit rejects an unlimited otherwise-correct key", () => {
  const violations = restrictedKeyViolations(
    [functionKey({ allowance: null })],
    "ed25519:expected",
    "vault.testnet",
  );
  assert.deepEqual(violations, ["function-call allowance is unlimited"]);
});

test("deployment network guard rejects any non-testnet network", () => {
  const previous = process.env.NEAR_NETWORK;
  process.env.NEAR_NETWORK = "mainnet";
  try {
    assert.throws(() => requireTestnet(), /must be testnet/);
  } finally {
    if (previous === undefined) delete process.env.NEAR_NETWORK;
    else process.env.NEAR_NETWORK = previous;
  }
});

test("subaccount helper validates the NEAR account length boundary", () => {
  assert.equal(subaccount("vault", "owner.testnet"), "vault.owner.testnet");
  assert.throws(() => subaccount("x".repeat(60), "owner.testnet"), /exceeds 64/);
});

test("deployment prefix is normalized and cannot end with a separator", () => {
  assert.equal(normalizeDeploymentPrefix("SpendGym-01"), "spendgym-01");
  assert.throws(() => normalizeDeploymentPrefix("spendgym-"), /2 to 20/);
  assert.throws(() => normalizeDeploymentPrefix("-spendgym"), /2 to 20/);
  assert.throws(() => normalizeDeploymentPrefix("x"), /2 to 20/);
});
