# Opt-In Public Payee Registry Specification

## Overview

Redline Payee Registry (`contracts/payee-registry`) is a public directory contract deployed on NEAR. Vendors can opt in to publish verified domain-to-account bindings so that any AI agent or accounts-payable workflow across the ecosystem can resolve or verify payout destinations.

By default, vendor records inside a tenant's vault remain strictly private to that vault. The public payee registry provides a shared, decentralized directory for vendors who explicitly choose to be publicly discoverable.

## Core Design Principles

1. **Control and Linkage, Not Legal Ownership**: The registry verifies that a specific payout account is controlled and linked to a verified domain at an explicit evidence tier (such as `T2` domain-linked via DNS TXT or well-known URI). It makes no legal ownership claims.
2. **CAIP-10 Account Identifiers**: All accounts are stored as standardized CAIP-10 strings:
   - NEAR: `near:testnet:account.testnet` or `near:mainnet:account.near`
   - EVM: `eip155:84532:0x...` (normalized to lowercase hexadecimal)
   - Solana: `solana:devnet:...` (case-preserved)
3. **Attestor-Only First Listing**: Initial vendor registration can only be submitted by the designated `attestor` role via `attest_vendor`.
4. **Self-Service Updates with Cooling-Off**: Once registered, any verified NEAR account belonging to the vendor may propose updates via `propose_update`. Updates enter a mandatory cooling-off window (configured at deployment or default 72 hours) before becoming active.
5. **Public Listing Does Not Bypass Vault Approval**: Even if a vendor is listed in the public payee registry, a tenant's vault never automatically routes payments to it. Any endpoint change in a vault must still be proposed and explicitly approved by that vault's independent approver.

## Contract Interface

### State Changing Methods

- `attest_vendor(input: AttestVendorInput) -> RegistryVendorView`:
  Callable exclusively by the designated `attestor` account. Normalizes CAIP-10 accounts, initializes the vendor record, and activates the initial accounts immediately.
- `propose_update(domain: String, accounts: Vec<String>, evidence_hash: String, issued_at: String, legal_name: Option<String>, evidence_tier: Option<String>) -> RegistryVendorView`:
  Callable by any active NEAR account listed under the vendor domain. New accounts enter a `PendingCooldown` state with `activates_at_ns = now + cooldown_ns`.
- `revoke_vendor(domain: String)`:
  Callable by the registry owner, attestor, or any active account listed for the vendor. Marks the vendor revoked. Revoked vendors cannot be resolved.

### View Methods

- `resolve(domain: String, chain: String) -> Option<String>`:
  Resolves a vendor domain and chain prefix (such as `"near"`, `"eip155"`, `"solana"`) to the active payout account. Returns `None` during cooldown or if revoked.
- `is_verified_payee(account: String, domain: String) -> bool`:
  Checks if a CAIP-10 account is currently active and verified for the specified domain.
- `get_vendor(domain: String) -> Option<RegistryVendorView>`:
  Returns the complete vendor record including all accounts, statuses (`active` or `pending`), and evidence hashes.
- `get_vendor_by_account(caip10: String) -> Option<RegistryVendorView>`:
  Reverse lookup finding which vendor domain is associated with a given payout address.
- `list_vendors(from_index: Option<u64>, limit: Option<u64>) -> Vec<RegistryVendorView>`:
  Paginated listing of all non-revoked vendor entries.

## Client Integration

`@redline/vault-client` exports `PayeeRegistryClient`, which implements the browser-safe `PayeeRegistry` interface. It performs view calls directly via NEAR RPC without requiring Node filesystem modules or secret keys for reads:

```typescript
import { PayeeRegistryClient } from "@redline/vault-client";

const registry = new PayeeRegistryClient({
  registryId: "payee-registry.redline-labs.testnet",
  rpcUrl: "https://rpc.testnet.near.org",
});

const resolvedAccount = await registry.resolve("acme.com", "near");
const isVerified = await registry.isVerifiedPayee("near:testnet:vendor.testnet", "acme.com");
```
