# @redline/sdk

Check who you are paying before an agent moves money. Works in Node and in browsers.

## Hosted mode

The SDK calls the Redline API and returns a signed receipt with each verdict.

```ts
import { createRedline, assertPayable } from "@redline/sdk";
const redline = createRedline({ mode: "hosted", baseUrl: "http://127.0.0.1:8787" });
const result = await redline.resolve({ domain: "northwind.com", chain: "near:testnet" });
assertPayable(result);
pay(result.account);
```

## Direct mode

**Redline never sees who you pay.** The SDK makes zero calls to our servers: it reads the registry from your NEAR RPC and runs the engine locally. Your RPC provider can see registry reads. Receipts are null in this mode.

```ts
import { createRedline, assertPayable } from "@redline/sdk";
const redline = createRedline({ mode: "direct", nearRpcUrl: "https://test.rpc.fastnear.com", registryAccount: "payees.redline-labs.testnet" });
const result = await redline.check({ payee: "eip155:84532:0xabc...", vendor: { domain: "northwind.com" } });
assertPayable(result);
pay(result.payee);
```

The registry contract client and `@redline/payee-check` have not landed yet. Until they do, direct mode without a `registry` option reads a built-in sample registry, not NEAR, and logs one warning. Do not use that default for real payments.

## Methods

| Method | Returns |
| --- | --- |
| `resolve({ domain, chain })` | PAY with the vendor's verified account, or HOLD |
| `check({ payee, vendor })` | PAY, HOLD or BLOCK with reasons |
| `getVendor(domain)` | The vendor record, or null |
| `recordPayment({ payer, domain, account })` | Feeds `PAYEE_CHANGED` on later checks |

Pay only on PAY. Send HOLD to a human. Never pay on BLOCK.

## Helpers

- `assertPayable(result)` throws `RedlineBlockedError` unless the verdict is PAY.
- `verifyReceipt(result, publicKey, { request })` checks a hosted receipt against a key you already trust, published at `/.well-known/redline-attestor.json`. Pass `request` to confirm the receipt answers that exact request.

## History stores

Direct mode keeps payment history on your side.

```ts
import { createIndexedDbHistory, createMemoryHistory } from "@redline/sdk";
import { createFileHistory } from "@redline/sdk/history-file"; // Node only
```

Pass one as `history` to `createRedline`. The default is memory.
