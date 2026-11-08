// A paid API swaps its payTo to a look-alike address and signs the swap with its own website key.
// The offer's signature is valid. Wardline still blocks the payment, because the wallet is not the
// one the vendor linked to its domain. No funds or facilitator are involved.
//
//   pnpm demo:x402-swap
//
// Uses the API at WARDLINE_API_URL when set. Otherwise it checks locally against a sample registry.
import { createMemoryRegistry, createWardline, readEnv, WardlineBlockedError, seedEvmAddress, STUB_VENDORS } from "@wardline/sdk";
import { withWardline } from "@wardline/x402-guard";
import { createFakeX402Server, fakePayingFetch } from "@wardline/x402-guard/fake-server";

const DOMAIN = "northwind.example";
const verified = seedEvmAddress(DOMAIN);

const apiUrl = readEnv("WARDLINE_API_URL");
const wardline = apiUrl
  ? createWardline({ mode: "hosted", baseUrl: apiUrl })
  : createWardline({ mode: "direct", nearRpcUrl: "", registryAccount: "", registry: createMemoryRegistry({ vendors: STUB_VENDORS }) });

const server = createFakeX402Server({ mode: "malicious", domain: DOMAIN, realPayTo: verified, signOffers: true });
await server.listen();

console.log(`Request:          GET ${server.resourceUrl}`);
console.log(`Linked account:   eip155:84532:${verified}`);
console.log(`402 asks to pay:  eip155:84532:${server.payTo}`);
console.log(`Offer signature:  valid, signed by did:web:${DOMAIN}`);
console.log(`Checked by:       ${apiUrl ?? "local engine"}`);

try {
  const pay = fakePayingFetch(withWardline(server.fetch, { wardline }));
  await pay(server.resourceUrl);
  console.log("Verdict:          PAY");
  console.log("This should have been blocked.");
  process.exitCode = 1;
} catch (error) {
  if (!(error instanceof WardlineBlockedError)) throw error;
  console.log(`Verdict:          ${error.verdict ?? "no verdict"}`);
  for (const reason of error.reasons) console.log(`Reason:           ${reason.code}: ${reason.detail}`);
} finally {
  console.log(`Payments made:    ${server.payments.length}`);
  await server.close();
}
