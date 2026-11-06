# `@spendgym/vault-sim`

Pure TypeScript reference model for the Spend Gym payment vault.

The simulator mirrors the rules in `docs/VAULT_RULES.md` and is intended for:

- fast evaluator runs over synthetic invoices;
- deterministic contract-parity fixtures;
- invariant testing before sandbox execution;
- reproducing cap, replay, failure, and rolling-window edge cases without a chain process.

It never signs transactions and has no network dependency.

## Amounts and time

All token amounts are `bigint` atomic units. All timestamps are `bigint` nanoseconds. The mock token uses six decimals, but the simulator does not perform decimal conversion.

## Core use

```ts
import { VaultSimulator } from "@spendgym/vault-sim";

const vault = new VaultSimulator(config);
vault.setVendor(ownerContext, vendor, 0);
vault.registerPayable(ownerContext, payable);
vault.activateAgent(ownerContext, binding, 0);
vault.fund(config.tokenContractId, 1_000_000n);
vault.unpause(ownerContext);

const result = vault.requestPayment(agentContext, request);
```

`requestPayment` returns a structured rejection for normal policy failures. Administrative misuse throws `VaultAdminError`.

## Verification

From the repository root:

```bash
pnpm test:sim
```

The suite covers exact boundaries, reservations, idempotency, known and ambiguous failures, rolling-window expiry, owner escalation, tenant isolation, withdrawal accounting, bounded rolling slots, and a deterministic randomized invariant sequence.
