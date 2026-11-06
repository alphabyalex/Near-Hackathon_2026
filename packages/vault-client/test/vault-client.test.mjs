import test from "node:test";
import assert from "node:assert/strict";
import { VaultClient } from "../dist/index.js";

class FakeTransport {
  calls = [];
  views = [];
  callResult = {
    accepted: true,
    existing: false,
    operation_id: "7",
    status: "PENDING_AGENT",
    rejection: null,
  };
  callError = undefined;
  payable = null;
  operation = null;

  async call(call) {
    this.calls.push(call);
    if (this.callError !== undefined) throw this.callError;
    return this.callResult;
  }

  async view(view) {
    this.views.push(view);
    if (view.methodName === "get_payable") return this.payable;
    if (view.methodName === "get_operation") return this.operation;
    if (view.methodName === "get_vendors") return [];
    return {};
  }
}

const request = {
  payable_ref: "payable-1",
  request_digest: "sha256:request-1",
  expected_policy_revision: 1,
  expected_vendor_revision: 1,
  expected_binding_revision: 1,
};

test("submits zero deposit and returns the final structured result", async () => {
  const transport = new FakeTransport();
  const client = new VaultClient(transport, "vault.testnet");
  const outcome = await client.requestPayment(request);
  assert.deepEqual(outcome, { kind: "RESULT", result: transport.callResult });
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].deposit, 0n);
  assert.equal(transport.calls[0].methodName, "request_payment");
  assert.deepEqual(transport.calls[0].args, { request });
});

test("transport ambiguity reads the payable and operation but forbids retry", async () => {
  const transport = new FakeTransport();
  transport.callError = new Error("RPC response lost");
  transport.payable = {
    payable_ref: "payable-1",
    vendor_id: "vendor-1",
    vendor_revision: 1,
    recipient: "vendor.testnet",
    amount_atomic: "100",
    po_number: "PO-1",
    not_before_ns: "1",
    due_at_ns: "2",
    expires_at_ns: "3",
    status: "PENDING_AGENT",
    operation_id: "9",
    request_digest: "sha256:request-1",
  };
  transport.operation = {
    operation_id: "9",
    actor: "AGENT",
    payable_ref: "payable-1",
    request_digest: "sha256:request-1",
    amount_atomic: "100",
    recipient: "vendor.testnet",
    created_at_ns: "1",
    status: "DISPATCHED",
    settled_at_ns: null,
    failure_category: null,
  };
  const client = new VaultClient(transport, "vault.testnet");
  const outcome = await client.requestPayment(request);
  assert.equal(outcome.kind, "OBSERVATION_AMBIGUOUS");
  assert.equal(outcome.retry_allowed, false);
  assert.equal(outcome.payable.status, "PENDING_AGENT");
  assert.equal(outcome.operation.status, "DISPATCHED");
  assert.equal(transport.calls.length, 1);
});

test("failed reconciliation remains ambiguous and never invents failure", async () => {
  const transport = new FakeTransport();
  transport.callError = new Error("timeout");
  transport.view = async () => { throw new Error("view unavailable"); };
  const client = new VaultClient(transport, "vault.testnet");
  const outcome = await client.requestPayment(request);
  assert.equal(outcome.kind, "OBSERVATION_AMBIGUOUS");
  assert.equal(outcome.retry_allowed, false);
  assert.match(outcome.cause, /reconciliation failed/);
  assert.equal(outcome.payable, null);
});

test("null operation id does not trigger an invalid operation lookup", async () => {
  const transport = new FakeTransport();
  transport.callError = new Error("RPC response lost");
  transport.payable = {
    payable_ref: "payable-1",
    vendor_id: "vendor-1",
    vendor_revision: 1,
    recipient: "vendor.testnet",
    amount_atomic: "100",
    po_number: "PO-1",
    not_before_ns: "1",
    due_at_ns: "2",
    expires_at_ns: "3",
    status: "OPEN",
    operation_id: null,
    request_digest: null,
  };
  const client = new VaultClient(transport, "vault.testnet");
  const outcome = await client.requestPayment(request);
  assert.equal(outcome.kind, "OBSERVATION_AMBIGUOUS");
  assert.equal(outcome.operation, null);
  assert.equal(transport.views.filter((view) => view.methodName === "get_operation").length, 0);
});

test("operation views preserve the string form used by the U64 contract view", async () => {
  const transport = new FakeTransport();
  transport.operation = {
    operation_id: "18446744073709551615",
    actor: "AGENT",
    payable_ref: "payable-1",
    request_digest: "sha256:request-1",
    amount_atomic: "100",
    recipient: "vendor.testnet",
    created_at_ns: "1",
    status: "SETTLED",
    settled_at_ns: "2",
    failure_category: null,
  };
  const client = new VaultClient(transport, "vault.testnet");
  const operation = await client.getOperation("18446744073709551615");
  assert.equal(operation.operation_id, "18446744073709551615");
  assert.deepEqual(transport.views.at(-1).args, { operation_id: "18446744073709551615" });
});
