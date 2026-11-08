# Release Guard Specification

## Overview

Release Guard ties on-chain payment authority in Wardline directly to the exact release manifest of the deployed AI agent. When an agent requests a payment from its vault, it supplies a manifest digest. If the supplied digest does not match the active binding enrolled by the business owner, the vault rejects the payment immediately with `RELEASE_MISMATCH` and emits a structured NEP-297 event.

## Manifest Scope

The agent release manifest is a canonical JSON document committing to all critical components that govern agent behavior. The SHA-256 digest of this manifest is enrolled in the vault contract during `activate_agent`.

A valid release manifest must cover:

1. **Model Identifier**: Exact model name, provider, and snapshot tag (for example, `anthropic:claude-3-5-sonnet-20241022`).
2. **System Prompt**: Cryptographic digest of the complete system prompt and instruction templates provided to the model.
3. **Tool List and Versions**: Full catalog of available tools, function definitions, parameters, and version hashes.
4. **Policy Revision**: Version number and commitment of company accounting rules and match guidelines.
5. **Gateway Build**: Build hash or commit SHA of the payment gateway binary or container image mediating agent calls.
6. **Dependency Lockfile Hash**: SHA-256 digest of the root lockfile (`pnpm-lock.yaml`, `Cargo.lock`, or `poetry.lock`) ensuring deterministic environment state.

### Canonical Manifest Schema

```json
{
  "schema_version": 1,
  "model": {
    "provider": "anthropic",
    "model_id": "claude-3-5-sonnet-20241022",
    "temperature": 0.0
  },
  "prompt_digest": "sha256:...",
  "tools": [
    { "name": "match_invoice", "version": "1.2.0", "digest": "sha256:..." },
    { "name": "verify_payee", "version": "1.0.4", "digest": "sha256:..." }
  ],
  "policy_revision": 3,
  "gateway_build": "git:8f3b129",
  "dependencies_digest": "sha256:..."
}
```

## Trust Model and Boundaries

The NEAR vault contract is an immutable, non-upgradeable state machine on-chain. It does not inspect the contents of prompt templates or verify compiler artifacts directly:
- **Contract Enforcement**: The contract only compares 32-byte digests (`sha256:...`). It checks `request.manifest_digest == binding.manifest_digest`.
- **Gateway Responsibility**: The API gateway or inference runner holds the agent function-call key and is trusted to measure its own runtime environment, compute the manifest digest truthfully, and submit it with each payment request.
- **Key Separation**: The agent key enrolled in the vault is restricted via NEAR function-call access permissions to only invoke `request_payment` on that specific vault contract.

## Conservative Authority Tier

To guard against regressions during agent upgrades:
1. When a new binding is activated via `activate_agent(binding, expected_revision)`, the vault automatically initializes spending authority at the `conservative_caps` tier if configured in `VaultConfig`.
2. The conservative caps specify a lower initial `weekly_cap` and `per_payment_cap`.
3. Spending authority cannot be raised automatically through good test history or agent self-certification.
4. Only an explicit, owner-signed transaction invoking `raise_binding_caps()` elevates the vault spending limit to the full policy ceiling.

## NEP-297 Event Format

When a payment request provides a manifest digest that contradicts the active binding, the vault logs a standardized event before returning the structured rejection:

```json
{
  "standard": "wardline",
  "version": "1.0.0",
  "event": "release_mismatch",
  "data": [{
    "agent_account_id": "agent.tenant.testnet",
    "expected_digest": "sha256:aaa...",
    "actual_digest": "sha256:bbb..."
  }]
}
```
