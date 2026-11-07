# Payee Shield

Redline is the verified-payee layer for AI agents. A vendor proves once that its payout accounts belong to its website domain. The record lives in a registry contract on NEAR, and agents read it before money moves.

## Problem

Agents can be handed the wrong account: a look-alike name, an "our bank details changed" email, or a poisoned address copied from history. A valid payment to the wrong account cannot be taken back.

## Resolve and check

- **Resolve:** "pay northwind.com on chain X" returns the vendor's verified account, so the agent never handles a raw address. Use this whenever the vendor's website is known.
- **Check:** "is this address really northwind.com's?" returns PAY, HOLD or BLOCK with reasons. Use this before paying any raw address.

## Accounts

Accounts are CAIP-10 strings, `<namespace>:<reference>:<address>`: `near:testnet:northwind.testnet`, `eip155:84532:0xabc...`, `solana:devnet:7xKX...`. A bare NEAR account id is normalized to `near:<network>:<id>`.

## Vendor proof file

A vendor serves `https://<domain>/.well-known/redline-payee.json`:

```json
{
  "version": 2,
  "domain": "northwind.com",
  "name": "Northwind Trading",
  "issued_at": "2026-11-07T00:00:00Z",
  "accounts": [
    { "account": "near:testnet:northwind.testnet", "proof": { "type": "nep413", "public_key": "ed25519:...", "nonce": "...", "signature": "..." } },
    { "account": "eip155:84532:0xabc...", "proof": { "type": "eip191", "signature": "0x..." } },
    { "account": "solana:devnet:7xKX...", "proof": { "type": "solana-ed25519", "signature": "..." } }
  ]
}
```

Each account signs `redline-payee:v2:<domain>:<caip10>:<issued_at>`.

| Proof | Verification |
| --- | --- |
| `nep413` | NEP-413 with recipient `redline-payee-registry` and the nonce. `public_key` must be a current full-access key on the account. Nonce and signature are base64 |
| `eip191` | Recover the signer and compare it to the address. Signature is 0x hex |
| `solana-ed25519` | Verify with the address as the public key. Signature is base58 |

Every account in a file must pass. `issued_at` cannot be in the future, over a year old, or older than the proof on record. Accounts added after a vendor's first verification wait out a cooling-off period, 72 hours in the memory registry, so a hijacked website cannot redirect payments right away.

`evidence_hash` is the sha256 of the fetched file. With two files, it is the sha256 of both file hashes.

The file is designed as the payout-account extension to the IETF draft [draft-anders-merchant-identity-assertions](https://www.ietf.org/ietf-ftp/internet-drafts/draft-anders-merchant-identity-assertions-01.html). That draft asserts who a merchant is and defines no payout accounts. If `/.well-known/merchant-identity.json` exists and its `subject` matches the domain, we store its `legalName` next to the vendor. We do not check that document's issuer signature yet, so treat the legal name as the vendor's own claim.

## Check verdicts

| Verdict | When |
| --- | --- |
| BLOCK | `ACCOUNT_MISSING`, `LOOKALIKE_ACCOUNT`, `ACCOUNT_NOT_VENDORS` |
| HOLD | `NOT_IN_REGISTRY`, `CHAIN_NOT_VERIFIED`, `COOLING_OFF`, `NEW_ACCOUNT`, `RECENT_FULL_ACCESS_KEY`, `RECENT_CODE_CHANGE`, `PAYEE_CHANGED`, or `SIGNALS_UNAVAILABLE` when signals are supported |
| PAY | `VERIFIED_MATCH` with nothing else |

On-chain signals are NEAR-only for now. For other chains `signals.supported` is false and the signal checks are skipped.

## Resolve verdicts

PAY with the account when the domain has an active verified account on that chain. Otherwise HOLD with `COOLING_OFF`, `CHAIN_NOT_VERIFIED` or `NOT_IN_REGISTRY`.

## Gaps we close

- **x402:** the offer-and-receipt extension lets a server sign its payment offers, and `did:web` ties that signing key to the website. Nothing proves the `payTo` wallet belongs to that website. A compromised server or signing key can sign an attacker's wallet.
- **AP2:** a mandate can limit payees with `payment.allowed_payees`, but it identifies a merchant by id, name and website. Nothing proves a payout account belongs to that merchant.

Plain allow, warn and block risk checks are commodity. Our edge is ownership proof, resolve-by-domain, multi-chain coverage and privacy.

## Hosted and direct mode

- **Hosted:** the SDK calls the Redline API and gets an ed25519-signed receipt for each verdict. Redline sees the request.
- **Direct:** the SDK reads the registry contract views straight from NEAR and runs the engine locally. Redline never sees who you pay. There are no receipts in this mode.

## Who owns what

| Owner | Piece |
| --- | --- |
| Alexander | API, SDK, x402 guard, MCP server, frontend, branding |
| Tharun | Payee-registry contract, `PayeeRegistryClient`, vault v2 that pays a vendor domain by resolving it at payment time |
| Lucy | `packages/payee-check`, the deterministic engine |
| Kristian | Red-team benchmark |
