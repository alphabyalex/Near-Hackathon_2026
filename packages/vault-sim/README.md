# packages/vault-sim

Owner: Tharun

Pure TypeScript model of [docs/VAULT_RULES.md](../../docs/VAULT_RULES.md), so the Gym can run hundreds of cases with no chain. Same rejection codes, same order of checks, same `op_<n>` ids as the contract. `tests/sandbox` runs the same request sequences against this and the real contract and asserts identical outcomes.

## Use it

```ts
import { VaultSim, SimVaultGateway } from "@wardline/vault-sim";

const vault = new VaultSim({
  vault_id: "vault-a.wardline.testnet",
  owner: "owner.test",
  token_contract: "wusd.test",
  policy: { weekly_cap_atomic: "20000000000", lifetime_cap_atomic: "100000000000", expires_at_ns: "1798848000000000000" },
  now_ns: 1793664000000000000n,
});
vault.setVendor("owner.test", { vendor_id: "vnd_larkspur", display_name: "Larkspur", account_id: "larkspur.test", per_payment_cap_atomic: "5000000000", active: true }, 0);
vault.activateAgent("owner.test", { agent_account_id: "agent.test", public_key: "ed25519:...", manifest_digest: "sha256:...", assessment_ref: "run_1", expires_at_ns: "1798848000000000000" }, 0);
vault.fund(50000000000n);
vault.unpause("owner.test");

const gateway = new SimVaultGateway([vault]); // implements VaultGateway from @wardline/schemas
```

- `new VaultSim(config)` mirrors `new(config)`: it starts paused with no agent.
- Methods mirror contract methods in camelCase, and take the caller first.
- Rule failures return a `RequestResult`. Contract panics throw `VaultPanic` with the same `E_*` code.
- `setNow` and `advance` move the clock. Nothing moves it on its own.

## Modeling a pending payment

By default a reservation resolves at once through a token model. Pass `auto_resolve: false` to hold operations in RESERVED, then call `resolveOperation(id, "success" | "failed" | "unknown")`, which stands in for the callback.

`token_registered: ["vendor.test"]` makes a transfer to any other account fail, as a real NEP-141 does for an unregistered account. `registerWithToken` models `storage_deposit`.

## Not modeled

These depend on the chain, so the sim leaves them out: attached deposits, gas (`E_INSUFFICIENT_GAS`), the NEAR storage margin behind `CAPACITY_FULL`, and NEAR's own key permissions (a function-call key rejected by the protocol never reaches the contract). The time a callback runs: the sim settles in the same instant unless you use `auto_resolve: false`.

## Test

`pnpm --filter @wardline/vault-sim test`
