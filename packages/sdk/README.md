# @redline/sdk

Check who you are paying before an agent moves money. Works in Node and in browsers.

## Hosted mode

The SDK calls the Redline API and returns a signed receipt with each verdict. Pass `apiKey` to send `payer` or record payments.

```ts
import { createRedline, assertPayable } from "@redline/sdk";
const redline = createRedline({ mode: "hosted", baseUrl: "http://127.0.0.1:8787" });
const result = await redline.resolve({ domain: "northwind.example", chain: "near:testnet" });
assertPayable(result);
pay(result.account);
```

## Direct mode

**Redline never sees who you pay.** The SDK makes zero calls to our servers: it reads the registry from your NEAR RPC and runs the engine locally. Your RPC provider can see registry reads. Receipts are null in this mode.

```ts
import { createRedline, assertPayable } from "@redline/sdk";
const redline = createRedline({ mode: "direct", nearRpcUrl: "https://test.rpc.fastnear.com", registryAccount: "payees.redline-labs.testnet" });
const result = await redline.check({ payee: "eip155:84532:0xabc...", vendor: { domain: "northwind.example" } });
assertPayable(result);
pay(result.payee);
```

The registry contract client and `@redline/payee-check` have not landed yet. Until they do, direct mode without a `registry` option reads a built-in sample registry, not NEAR, and logs one warning. Do not use that default for real payments.

## Methods

| Method | Returns |
| --- | --- |
| `resolve({ domain, chain })` | PAY with the account linked to the domain, or HOLD |
| `check({ payee, vendor })` | PAY, HOLD or BLOCK with reasons |
| `getVendor(domain)` | The vendor record, or null |
| `recordPayment({ payer, domain, account })` | Feeds `PAYEE_CHANGED` on later checks |

Pay only on PAY. Send HOLD to a human. Never pay on BLOCK.

Every result has an `evidenceTier`, from `T0_NONE` to `T3_RELATIONSHIP`. It says how much was verified: account control, the domain link, and your own relationship with the account. No tier establishes legal ownership. See docs/PAYEE_SHIELD.md.

## Helpers

- `assertPayable(result, { minTier })` throws `RedlineBlockedError` unless the verdict is PAY and, when given, the tier is at least `minTier`.
- `meetsTier(result, "T3_RELATIONSHIP")` compares tiers.
- `verifyReceipt(result, publicKey, { request })` checks a hosted receipt against a key you already trust, published at `/.well-known/redline-attestor.json`. Pass `request` to confirm the receipt answers that exact request.

## History stores

Direct mode keeps payment history on your side.

```ts
import { createIndexedDbHistory, createMemoryHistory } from "@redline/sdk";
import { createFileHistory } from "@redline/sdk/history-file"; // Node only
```

Pass one as `history` to `createRedline`. The default is memory.
