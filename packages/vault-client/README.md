# packages/vault-client

Owner: Tharun

The real `VaultGateway` from `@redline/schemas`, against NEAR sandbox or testnet. Mainnet is refused in code.

## Use it

```ts
import { NearVaultGateway } from "@redline/vault-client";

const gateway = NearVaultGateway.fromEnv();
const result = await gateway.requestPayment("vault-a.redline.testnet", paymentRequest);
```

| Env var | Meaning |
| --- | --- |
| `NEAR_NETWORK` | `sandbox` or `testnet`. Required. |
| `NEAR_RPC_URL` | Required on sandbox. Defaults to a public RPC on testnet. |
| `REDLINE_VAULT_SIGNERS_FILE` | Path to a JSON file of signers. Keep it outside the repo. |
| `REDLINE_VAULT_SIGNERS` | The same JSON inline. |

The signers JSON maps each vault to the keys this process may use:

```json
{
  "vault-a.redline.testnet": {
    "agent": { "account_id": "agent-a.redline.testnet", "private_key": "ed25519:..." },
    "owner": { "account_id": "owner-a.redline.testnet", "private_key": "ed25519:..." }
  }
}
```

With no signers, views still work and signing methods throw `MissingSignerError` before sending. `scripts/contracts/deploy-and-seed` writes this file for you, outside the repo.

## What the results mean

| You get | Meaning | What to do |
| --- | --- | --- |
| `{ ok: false, rejection }` | Rule failure. No money moved. | Send to the review queue. |
| `{ ok: true, operation_id }` | The vault accepted the request. The final execution has already been read. | Call `getOperation`: SETTLED, FAILED_KNOWN or OUTCOME_UNCERTAIN. |
| `VaultOutcomeUnknownError` | Sent, no final answer in time. It may have landed. | Show "outcome uncertain". A retry with the same digest cannot pay twice. |
| `VaultExecutionError` | Final status is a failure with no result, such as a low-gas panic. | Read `getPayable` for what the vault recorded. |
| `TransactionRefusedError` | NEAR refused the transaction, so no contract code ran. For example the key does not permit this call. | Nothing moved. This is the "key not permitted" case. |
| `MissingSignerError` | This process holds no key for that. | Fix config. Nothing was sent. |

A timeout is never reported as a failure. The client signs once, computes the hash, and keeps asking by hash until it gets a final answer or reaches `final_timeout_ms` (default 120 seconds).

`ok: true` is what `RequestResult` allows when a transfer fails, because a failed transfer is not a policy rejection. See [docs/VAULT_RULES.md](../../docs/VAULT_RULES.md).

`getOperation` fills in `tx_hash` for operations this process sent. On chain it is always null, since a contract cannot know its own transaction hash.

## Beyond `VaultGateway`

- `gateway.getVendors`, `gateway.getPayables`: bounded pages, for building `AgentContext`.
- `VaultAdmin`: owner-signed methods for scripts and tests.
- `NearEvidenceClient`: client for reading and verifying on-chain evidence (`getSuite`, `getRun`, `getReportDigest`, `verifyReport`) and issuer transactions (`commitSuite`, `registerRun`, `publishResult`, `publishRun`).
- `callFinal`, `viewCall`: the transport underneath.

## Test

`pnpm --filter @redline/vault-client test` covers config and outcome reading. The real chain path is covered by `tests/sandbox`.
