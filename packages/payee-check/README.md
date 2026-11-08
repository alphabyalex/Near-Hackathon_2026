# @wardline/payee-check

Owner: Lucy

The deterministic Payee Shield engine. Given an account and, optionally, the vendor it claims to
be, it answers **PAY**, **HOLD** or **BLOCK** with reasons. Given a vendor domain and a chain, it
returns the vendor's verified account. No LLM, no HTTP server, no Node-only APIs: the same code
runs in the API (hosted mode) and inside the caller's own app through the SDK (direct mode).

## API

```ts
import { checkPayee, resolvePayee, NearSignalsProvider, nearRpcUrlsFromEnv } from "@wardline/payee-check";

const deps = {
  registry,                 // PayeeRegistry: Tharun's on-chain client, or InMemoryPayeeRegistry
  signals: new NearSignalsProvider({ network: "testnet", rpc: nearRpcUrlsFromEnv(env)! }),
  history,                  // optional PaymentHistory: { lastPaidAccount(payer, domain) }
  now: () => Date.now(),
};

await checkPayee({ payee: "northwind-billing.testnet", vendor: { domain: "northwind.com" } }, deps);
// { verdict: "BLOCK", payee: "near:testnet:northwind-billing.testnet",
//   reasons: [{ code: "ACCOUNT_NOT_VENDORS", detail: "..." }, { code: "LOOKALIKE_ACCOUNT", detail: "..." }],
//   vendor: {...}, signals: { supported: true, ..., lookalikeOf: "northwind.com" } }

await resolvePayee({ domain: "northwind.com", chain: "near:testnet" }, deps);
// { verdict: "PAY", domain, chain, account: "near:testnet:northwind.testnet", reasons, vendor }
```

Results match `PayeeCheckResult` and `PayeeResolveResult` from `@wardline/schemas` without
`caseFile`, `receipt` and `evidenceTier`, which the API adds.

Also exported: `parseAccount`, `formatAccount`, `normalizeAccount`, `parseChainId`,
`normalizeDomain`, `detectLookalike`, `verifiedEntries`, `verdictFor`, `PAYEE_CHECK_CONFIG`
(every threshold), `InMemoryPayeeRegistry`, `InMemoryPaymentHistory`, `LruCache`,
`NearRpcClient`, and the `PayeeRegistry`, `SignalsProvider`, `PaymentHistory` and `SignalsCache`
interfaces.

### Errors

| Thrown | When |
| --- | --- |
| `AccountParseError` | Malformed account or request. Thrown before any registry or RPC call |
| `DomainParseError` | Malformed vendor domain. Thrown before any registry or RPC call |
| `PayeeDependencyError` | The registry or payment history could not be read. There is no honest verdict without them; treat as HOLD |

On-chain signal failures never throw. They come back as nulls and the verdict gets
`SIGNALS_UNAVAILABLE`.

## Accounts

CAIP-10 `<namespace>:<reference>:<address>` for `near`, `eip155` and `solana`. A bare NEAR id is
normalized: `*.near` to mainnet, `*.testnet` to testnet, anything else to `defaultNearNetwork`
(testnet). NEAR and EVM addresses are lowercased; Solana stays as is and must decode to 32 bytes.
Solana CAIP-2 genesis references map to `mainnet`, `devnet` and `testnet`.

## Check verdicts

| Verdict | Reason | Fires when |
| --- | --- | --- |
| BLOCK | `ACCOUNT_MISSING` | NEAR only: the account does not exist |
| BLOCK | `LOOKALIKE_ACCOUNT` | The account is in nobody's registry and imitates a verified account (rules below) |
| BLOCK | `ACCOUNT_NOT_VENDORS` | The claimed vendor has verified accounts on this chain and this is not one, or the account is registered to a different vendor |
| HOLD | `NOT_IN_REGISTRY` | The claimed domain is not registered, or no domain was given and the reverse index has no match |
| HOLD | `CHAIN_NOT_VERIFIED` | The claimed vendor has no verified account on this chain (including its own address verified only on another chain) |
| HOLD | `COOLING_OFF` | The account is the vendor's but still pending |
| HOLD | `NEW_ACCOUNT` | NEAR: created under 30 days ago |
| HOLD | `RECENT_FULL_ACCESS_KEY` | NEAR: a full-access key was added in the last 7 days |
| HOLD | `RECENT_CODE_CHANGE` | NEAR: contract code changed in the last 7 days |
| HOLD | `PAYEE_CHANGED` | This payer last paid this domain at a different account |
| HOLD | `SIGNALS_UNAVAILABLE` | NEAR: any signal could not be read |
| PAY | `VERIFIED_MATCH` | The account is the vendor's, active, past cooling-off, and nothing else fired |

BLOCK beats HOLD. `VERIFIED_MATCH` is still listed on a HOLD so a human sees the account is
the vendor's. With no vendor claimed, the reverse index decides: an account found there is
treated as a claim of that vendor. Every reason carries a one-sentence `detail`.

**Interpretation to confirm:** the brief says ACCOUNT_NOT_VENDORS means "not one of theirs on any
chain". Taken literally, every account on a chain the vendor never verified would BLOCK, and the
"wrong chain" HOLD could never fire. The engine therefore BLOCKs only when the vendor has accounts
on this chain (so we can say this one is not theirs), and HOLDs with CHAIN_NOT_VERIFIED when it
has none there.

## Resolve verdicts

PAY with the account when the registry resolves an active account on that chain and its signals
are clean. Otherwise HOLD with `account: null` and `NOT_IN_REGISTRY`, `CHAIN_NOT_VERIFIED`,
`COOLING_OFF`, or the signal reasons (for example `NEW_ACCOUNT`) next to `VERIFIED_MATCH`.

## Look-alike rules

Only for accounts nobody registered. Deterministic string rules, all thresholds in
`PAYEE_CHECK_CONFIG.lookalike`.

| Chain | Rule |
| --- | --- |
| NEAR | Same own name under a different parent (`northwind.vendors.testnet`, `northwind.tg`) |
| NEAR | Confusables after normalizing: 0/o, 1/l/i, rn/m, vv/w (`n0rthwind`, `acrne-supply`) |
| NEAR | Vendor name token plus a bait word, separated or joined (`northwind-billing`, `northwindhq`) |
| NEAR | Edit distance 2 or less from a verified own name (names of 5+ chars) |
| NEAR hex ids | Same first 4 and last 4 characters as a verified hex id |
| EVM | Same first 4 and last 4 hex characters as a verified address on any EVM chain, or edit distance 3 or less |
| Solana | Same first 4 and last 4 base58 characters as a verified address |

NEAR comparisons stay within one network. `lookalikeOf` names the imitated vendor domain.

## Signals per chain

| Chain | Checks |
| --- | --- |
| NEAR | Registry, look-alike, history, and on-chain: existence, contract, creation block and age, full-access keys added in 7 days, code change in 7 days |
| EVM | Registry, look-alike, history only. `signals.supported` is false |
| Solana | Registry, look-alike, history only. `signals.supported` is false |

How NEAR signals are read (JSON-RPC, `QUICKNODE_NEAR_RPC_URL`, else `NEAR_RPC_URL`; historical
queries go to `NEAR_ARCHIVE_RPC_URL` if set, else the same URL, which must then be archival):

- Existence, contract, code hash: `view_account` at final.
- The block about 7 days ago: final block plus one block, calibrated on real timestamps (testnet
  measured at about 0.6 s per block on Nov 8).
- Full-access keys added: `view_access_key_list` now vs then, diffed by public key. A key that was
  function-call then and full-access now counts as added.
- Code change: code hash now vs then. If the account did not exist then, any code is new.
- Creation: binary search on `view_account` at `block_id`. Absent a week ago means search only the
  last week; otherwise probe 30 days back first. Skipped heights are stepped over.
- Every call has an 8 s timeout and one retry (network errors, timeouts, HTTP 5xx and 429).

Cache, behind `SignalsCache` (default in-memory LRU; the API can plug in sqlite): creation forever;
current state, keys, code and the 7-day height for 10 minutes.

## RPC cost per check

Measured on the simulated chain in test/near-signals.test.ts, and on real testnet for the young
account:

| NEAR account | Cold cache | Within 10 min | After 10 min |
| --- | --- | --- | --- |
| Created this week | 25 (26 on real testnet) | 0 | 5 |
| Older than 30 days, clean | 35 | 0 | 6 |
| Missing | 1 | 0 | 1 |
| EVM or Solana | 0 | 0 | 0 |

The 7-day window lookup (2 calls) is shared by all accounts for 10 minutes. Most of the cold cost is
the one-time creation search, cached forever.

## Fixtures and tests

`pnpm --filter @wardline/payee-check test` runs offline: the engine cases, the look-alike rules, a
simulated chain for the signals provider (skipped heights, timeouts, retries, broken archive), and a
replay of real testnet responses in `fixtures/testnet-recording.json`.

`pnpm --filter @wardline/payee-check record-fixtures` re-records. It needs an archival endpoint, holds
a hard budget of 50 live calls, skips any account whose worst case would exceed it, and never
writes the endpoint URL (QuickNode URLs contain the key). The Nov 8 recording used 27 calls against
the public FastNEAR archival endpoint, not QuickNode.

## Known limits

- **Direct mode is private from Wardline, not from the RPC provider.** The `view_account` calls name the
  payee, so whoever runs the RPC endpoint can see which accounts the caller checks.
- **No on-chain signals for EVM or Solana.** No age, key, code or delegation checks there. A verified EVM
  address that is later compromised still PAYs. EIP-55 checksums are not validated (no keccak dependency).
- **Look-alike rules are string rules.** They miss imitations that share no token or shape with the real
  name, and they can false-positive: any registered name token (such as "supply" from `acme-supply`)
  plus a bait word is flagged. Every look-alike check reads the full vendor list.
- **The creation search assumes the account was not deleted and recreated** in the searched range.
- **"7 days" is approximate**, calibrated on two block timestamps per 10 minutes.
- **Signals for a NEAR network other than the provider's** come back as SIGNALS_UNAVAILABLE.
- **History is only as good as what the caller records.** PAYEE_CHANGED needs a `PaymentHistory`.
- **A clean PAY means these specific checks passed**, against the registry and chain state at that moment.
  It does not prove the vendor is honest or that the domain was not itself compromised.
