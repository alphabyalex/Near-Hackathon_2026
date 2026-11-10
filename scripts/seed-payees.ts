// Seeds about 10 fictional vendors through the attestor, with evidence "seed".
//
//   pnpm payee:seed
//
// WARDLINE_REGISTRY_MODE=near writes each attestation to the registry contract on testnet. In memory mode
// the records last only as long as this process, so this prints what would be seeded. To start the
// API with the same vendors, set WARDLINE_SEED_PAYEES=all.
import { ALL_SEED_VENDORS, applyLegacyEnv, createMemoryRegistry, seedAttestation } from "@wardline/sdk";
import { join } from "node:path";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { loadPayeeBackends } from "../services/api/src/payee/runtime.js";
import { CredentialStore, defaultSecretsDir } from "./contracts/src/lib.js";

applyLegacyEnv();
// near mode: the attestor (wardline-labs.testnet) signs, with its key from the local credential store.
let signer: unknown;
if (process.env.WARDLINE_REGISTRY_MODE === "near") {
  const attestor = process.env.WARDLINE_ATTESTOR_ACCOUNT ?? "wardline-labs.testnet";
  const key = new CredentialStore(join(defaultSecretsDir("testnet"), "credentials.json")).get(attestor);
  if (!key) throw new Error(`No key for the attestor ${attestor} in the credential store.`);
  signer = makeSigner(makeProvider(process.env.WARDLINE_NEAR_RPC_URL ?? "https://test.rpc.fastnear.com"), attestor, key);
}
const backends = await loadPayeeBackends(process.env, signer);
const registry = backends.registry ?? createMemoryRegistry();

for (const vendor of ALL_SEED_VENDORS) {
  const record = await registry.attestVendor(seedAttestation(vendor));
  console.log(`${record.domain.padEnd(26)} ${record.name.padEnd(26)} ${record.accounts.length} accounts`);
}
console.log(`Seeded ${ALL_SEED_VENDORS.length} vendors.`);
