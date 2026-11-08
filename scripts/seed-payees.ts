// Seeds about 10 fictional vendors through the attestor, with evidence "seed".
//
//   pnpm payee:seed
//
// REDLINE_REGISTRY_MODE=near writes to the registry contract once its client lands. In memory mode
// the records last only as long as this process, so this prints what would be seeded. To start the
// API with the same vendors, set REDLINE_SEED_PAYEES=all.
import { ALL_SEED_VENDORS, createMemoryRegistry, seedAttestation } from "@redline/sdk";
import { loadPayeeBackends } from "../services/api/src/payee/runtime.js";

const backends = await loadPayeeBackends();
const registry = backends.registry ?? createMemoryRegistry();

for (const vendor of ALL_SEED_VENDORS) {
  const record = await registry.attestVendor(seedAttestation(vendor));
  console.log(`${record.domain.padEnd(26)} ${record.name.padEnd(26)} ${record.accounts.length} accounts`);
}
console.log(`Seeded ${ALL_SEED_VENDORS.length} vendors.`);
