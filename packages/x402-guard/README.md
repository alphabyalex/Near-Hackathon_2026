# @redline/x402-guard

x402 can sign a payment offer with the website's key, but nothing proves the `payTo` wallet belongs to that website. This guard checks each 402 against the Redline registry and pays only on PAY.

```ts
import { createRedline } from "@redline/sdk";
import { withRedline } from "@redline/x402-guard";
import { wrapFetchWithPayment } from "@x402/fetch";

const redline = createRedline({ mode: "hosted", baseUrl: "http://127.0.0.1:8787" });
const pay = wrapFetchWithPayment(withRedline(fetch, { redline }), x402Client);
```

The guard goes inside the payment wrapper, so it sees each 402 first. You can also pass an `x402Client`, which registers an `onBeforePaymentCreation` hook: `withRedline(x402Client, { redline })`.

## What it does on a 402

1. Reads `accepts[]` from the `PAYMENT-REQUIRED` header and the body.
2. Takes the domain from the signed offer's `did:web` key after verifying it, otherwise from the request URL host. EIP-712 offers name no website, so they use the host.
3. Maps the network to CAIP-2 and calls `redline.check({ payee, vendor: { domain }, source: "x402" })`.
4. Any BLOCK stops the request. Options that got HOLD are removed, so the payer can only choose a PAY. If none are left, it stops.

It stops by throwing `RedlineBlockedError` with the reasons. Anything it cannot confirm also stops the payment: a bad signature, an expired offer, an unknown network, a malformed 402 or a failed check.

## See it run

`pnpm demo:x402-swap` runs a server that swaps `payTo` to a look-alike address, signs the swap with the site's own key, and gets blocked.
