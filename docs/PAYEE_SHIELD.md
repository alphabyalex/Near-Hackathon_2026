# Payee Shield

Wardline checks who an AI agent is about to pay. A vendor links its payout accounts to its website domain once. We verify that the vendor controls each account and that the domain lists it, and we say at which trust level. The record lives in a registry contract on NEAR, and agents read it before money moves.

## Problem

Agents can be handed the wrong account: a look-alike name, an "our bank details changed" email, or a poisoned address copied from history. A valid payment to the wrong account cannot be taken back.

## Resolve and check

- **Resolve:** "pay northwind.example on chain X" returns the account linked to that domain, so the agent never handles a raw address. Use this whenever the vendor's website is known.
- **Check:** "is this address the one linked to northwind.example?" returns PAY, HOLD or BLOCK with reasons. Use this before paying any raw address.

## Accounts

Accounts are CAIP-10 strings, `<namespace>:<reference>:<address>`: `near:testnet:northwind.testnet`, `eip155:84532:0xabc...`, `solana:devnet:7xKX...`. A bare NEAR account id is normalized to `near:<network>:<id>`.

## Trust levels

Every answer carries an `evidenceTier`. A wallet signature plus a domain file shows control and linkage, not legal ownership, so each level states what it does not establish.

| Tier | What we verified | What it does not establish |
| --- | --- | --- |
| `T0_NONE` | Nothing for this vendor and account | Anything |
| `T1_WALLET_CONTROL` | The account signed our challenge, so someone holds its key | Any link to the vendor or its domain |
| `T2_DOMAIN_LINKED` | T1, and the vendor's domain serves a valid file listing the account | Legal ownership. Whoever controls both the website and the key can link an account, including an attacker who took over both |
| `T3_RELATIONSHIP` | T2, and this payer's owner approved the account after its cooling-off period, or this payer has paid it before | That the approval or earlier payment was right. It is your own history, not an outside check |
| `T4_EXTERNAL_KYB` | Reserved for an external business-verification provider | We never set it today |

PAY needs at least T2. T3 is per payer and only appears when the caller authenticates as that payer. An email from the same domain is never extra evidence: whoever controls the domain controls its mail too.

## Vendor link file

A vendor serves `https://<domain>/.well-known/wardline-payee.json`:

```json
{
  "version": 2,
  "domain": "northwind.example",
  "name": "Northwind Trading",
  "issued_at": "2026-11-07T00:00:00Z",
  "accounts": [
    { "account": "near:testnet:northwind.testnet", "proof": { "type": "nep413", "public_key": "ed25519:...", "nonce": "...", "signature": "..." } },
    { "account": "eip155:84532:0xabc...", "proof": { "type": "eip191", "signature": "0x..." } },
    { "account": "solana:devnet:7xKX...", "proof": { "type": "solana-ed25519", "signature": "..." } }
  ]
}
```

Each account signs `wardline-payee:v2:<domain>:<caip10>:<issued_at>`.

| Signature | Verification |
| --- | --- |
| `nep413` | NEP-413 with recipient `wardline-payee-registry` and the nonce. `public_key` must be a current full-access key on the account. Nonce and signature are base64 |
| `eip191` | Recover the signer and compare it to the address. Signature is 0x hex |
| `solana-ed25519` | Verify with the address as the public key. Signature is base58 |

Every account in a file must pass. `issued_at` cannot be in the future, over a year old, or older than the file on record. Accounts added after a vendor's first verification wait out a cooling-off period, 72 hours in the memory registry, so a hijacked website cannot redirect payments right away.

`evidence_hash` is the sha256 of the fetched file. With two files, it is the sha256 of both file hashes.

The file is designed as the payout-account extension to the IETF draft [draft-anders-merchant-identity-assertions](https://www.ietf.org/ietf-ftp/internet-drafts/draft-anders-merchant-identity-assertions-01.html), which describes who a merchant is and defines no payout accounts. If `/.well-known/merchant-identity.json` exists and its `subject` matches the domain, we store its `legalName` labeled `vendor-claimed`. We do not verify its signature: a self-issued signature only shows the domain made the claim, and draft -01 leaves third-party issuance and delegation open. The label changes only once that is settled.

## Check verdicts

| Verdict | When |
| --- | --- |
| BLOCK | `ACCOUNT_MISSING`, `LOOKALIKE_ACCOUNT`, `ACCOUNT_NOT_VENDORS` |
| HOLD | `NOT_IN_REGISTRY`, `CHAIN_NOT_VERIFIED`, `COOLING_OFF`, `NEW_ACCOUNT`, `RECENT_FULL_ACCESS_KEY`, `RECENT_CODE_CHANGE`, `PAYEE_CHANGED`, or `SIGNALS_UNAVAILABLE` when signals are supported |
| PAY | `VERIFIED_MATCH` with nothing else |

On-chain signals are NEAR-only for now. For other chains `signals.supported` is false and the signal checks are skipped.

## Resolve verdicts

PAY with the account when the domain has an active linked account on that chain. Otherwise HOLD with `COOLING_OFF`, `CHAIN_NOT_VERIFIED` or `NOT_IN_REGISTRY`.

## Approvals stay out of the agent's reach

- Owner actions (approving a payee, paying from the review queue, pausing, issuing API keys) need a session from a NEP-413 sign-in by an owner or approver NEAR account. Agents never hold those keys.
- API keys belong to one payer. A default key can only check. Recording payments, which can clear `PAYEE_CHANGED` and raise T3, needs the `record` scope. Give that to the system that settles payments, not to the agent.

## What goes on chain

The registry holds the domain, vendor name, accounts, their status, `evidence_hash` and timestamps. Invoices, payer history, approvals, API keys and anything personal stay off chain, in the API's database or on the payer's side in direct mode.

## Gaps we close

- **x402:** the offer-and-receipt extension lets a server sign its payment offers, and `did:web` ties that signing key to the website. Nothing checks that the `payTo` wallet is linked to that website. A compromised server or signing key can sign an attacker's wallet.
- **AP2:** AP2 identifies a merchant by id, name and website, and nothing in the protocol proves a payout account belongs to that merchant. Researchers also showed an agent can end up approving a payment with no payee restriction when a tool returns no payee (Aviv et al., ["Beyond the Mandate"](https://arxiv.org/pdf/2608.23858), scenario AM1).

Plain allow, warn and block risk checks are commodity. Our edge is verified account control with a domain link at a stated trust level, resolve-by-domain, multi-chain coverage and privacy.

## Hosted and direct mode

- **Hosted:** the SDK calls the Wardline API and gets an ed25519-signed receipt for each verdict, covering the evidence tier. Wardline sees the request.
- **Direct:** the SDK reads the registry contract views straight from NEAR and runs the engine locally. Wardline never sees who you pay. There are no receipts in this mode.

## Who owns what

| Owner | Piece |
| --- | --- |
| Alexander | API, SDK, x402 guard, MCP server, frontend, branding |
| Tharun | Payee-registry contract, `PayeeRegistryClient`, vault v2 that pays a vendor domain by resolving it at payment time, hosting the owner routes |
| Lucy | `packages/payee-check`, the deterministic engine |
| Kristian | Red-team benchmark |
