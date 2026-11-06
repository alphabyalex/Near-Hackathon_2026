# `@spendgym/vault-client`

Typed gateway for a Spend Gym vault on NEAR sandbox or testnet.

The client waits for `FINAL` execution when it submits `request_payment`. A thrown transport error is never treated as a known payment failure and is never retried automatically. Instead, the client reads the payable and linked operation and returns `OBSERVATION_AMBIGUOUS` with `retry_allowed: false`.

That distinction is required because a transaction can execute successfully even when an observer loses the response. Automatic retries at the client layer could otherwise create confusing duplicate submissions. The vault remains the idempotency boundary.

The near-api-js adapter is pinned to 7.3.1 and the workspace therefore requires Node 22.22.2 or newer.
