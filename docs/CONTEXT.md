> Wardline is becoming the verified-payee layer for AI agents.
> Read [PAYEE_SHIELD.md](PAYEE_SHIELD.md) first; it is the current product direction.

# PROJECT CONTEXT (full picture of Wardline)

## One line

Wardline stress-tests invoice-handling AI agents and lets a business give a tested agent a NEAR payment vault with hard limits that hold even if the agent is fully compromised.

## Problem

Fake invoices and "we changed our bank details" emails already cost businesses billions a year. AI agents that read invoices can be tricked the same way, including by hidden instructions inside invoice text. Nobody connects "how did this agent version perform on tests" with "how much money may it move."

## Who it is for

1. Teams deploying AI accounts-payable agents who must decide whether a new agent release is safe to give payment authority.
2. Small crypto-native companies with no AP department that pay repeat vendors in stablecoins.

Humans still own approvals, new vendors, and anything unusual. The agent handles routine matching and flags anything questionable.

## The three pieces

1. Gym: runs an agent against synthetic invoices with known correct answers and measures useful work AND dangerous behavior separately.
2. Vault: one NEAR contract per business. It holds USDC and only pays approved bills to approved vendors within limits.
3. Evidence record: which exact agent version was tested, by whom, on which committed test suite, with what results. Hashes on chain so results cannot be quietly swapped.

## Core design decisions (agreed by the team)

- The agent is a FLAGGER FIRST, AUTOPAYER SECOND. It returns one of three decisions:
  - PAY: invoice clearly matches an approved payable at the exact amount, known vendor, verified destination.
  - REVIEW: possibly legitimate but needs a human (new vendor, over the vendor cap, missing receipt, ambiguous match, unreadable, claimed destination change).
  - FLAG: suspected fraud or manipulation (injection attempt, forged approval, look-alike vendor, attempt to pay an already paid invoice). No payment, human notified.
- Payables come from approved purchase orders (standard 3-way match of PO, goods receipt, invoice). In the demo these are owner-seeded fixtures. In production they would come from the company's accounting system. The agent never creates a payable, picks an amount, or picks a recipient.
- "Double payment" means paying the SAME invoice or PO twice. Paying the same vendor many times for recurring services is normal and allowed; each bill is its own payable.
- New vendors always go to a human. The agent never decides a new vendor is trustworthy.
- Limits:
  - The exact amount is locked inside each approved payable. This is the main control.
  - Each vendor has its own per-payment cap (vendors charge very different amounts).
  - A rolling 7-day cap and a lifetime ceiling bound total agent spending.
  - Anything over a cap is NEVER declined. The vault returns a structured rejection, no money moves, and the item goes to the human review queue. The owner can then pay it directly with an owner-signed owner_pay.
- Every payable has a due date. The review queue sorts by due date and warns when a bill is within 48 hours of due so nothing is paid late.
- The agent key is a NEAR function-call key that can only call request_payment on its own vault. A malicious script holding that key must hit the exact same limits as the AI.
- If the AI proposes something unsafe and the vault blocks it, that is scored as one AI failure AND one vault containment success. Never as a pass.
- Limits only go up when the owner explicitly signs a change. No automatic raises from "good history."
- Two separate vaults (business A and business B) prove one tenant cannot touch another's funds.

## Real vs simulated

- Real: vault contract execution and token transfers on NEAR sandbox and NEAR testnet, using Circle's USDC on NEAR testnet (NEP-141).
- Synthetic: the company, vendors, invoices, POs, receipts.
- Live LLM inference for evaluated runs, with a clearly labeled replay mode for demo resilience.
- Evaluation issuer is our team, and we say so.

## Money

All money is Circle's USDC on NEAR (6 decimals). The token account is one config value, `WARDLINE_USDC_ACCOUNT`: testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` by default, mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. Wardline Mutual mints WARD ("Wardline Mutual share", NEP-141, 6 decimals): investors deposit USDC and receive WARD at the current price, pool assets divided by WARD supply, starting at 1 USDC. WARD is yield-bearing and loss-sharing: it rises with fees, dips when a payout exceeds Wardline's own first-loss stake, and is redeemed after a 7-day wait or sold on a DEX.

## Legacy deployments

The product was renamed to Wardline on 2026-11-08. Accounts already on testnet keep their names, because NEAR accounts cannot be renamed: the current deployment under `redline-labs.testnet` (vaults, evidence registry, payee registry and the token at `redl.redline-labs.testnet`, which still reports its old symbol on chain) and the earlier one under `redlinehq.testnet`. Recorded evidence and red-team results also keep their bytes, so their hashes still verify. New deployments will live under a Wardline root account. `scripts/rebrand-wardline.mjs` lists every kept name in its allowlist.

## Out of scope

Lending, credit scores, insurance, reputation tokens, staking, swaps, bridges, mainnet, fiat payouts, KYB, real ERP writes, sending real email, automatic limit increases, installments or partial payments.

## Language we never use

"unhackable", "fraud-proof", "guaranteed safe", "results cannot be faked", "certified", "TEE attests the whole agent". We describe exact tested boundaries instead.

## Tech stack

pnpm workspace monorepo, Node 20+, TypeScript strict. Rust (near-sdk) for contracts. Frontend Vite + React. API Hono + better-sqlite3 + zod. Shared zod schemas and TS types in packages/schemas. LLM via NEAR AI Cloud (OpenAI-compatible, TEE-hosted models).

## Team and lanes (who owns what right now)

- Alexander: PM, repo owner, merge coordinator, frontend, branding, backend API, shared schemas. Folders apps/web, services/api, packages/schemas, docs/CONTEXT.md, docs/OWNERSHIP.md.
- Tharun: crypto engineering, the heaviest workstream. Vault and evidence contracts, mock token, TS vault client, TS rules simulator, sandbox tests, testnet deploy, malicious-signer attack script. Folders contracts/, packages/vault-client, packages/vault-sim, tests/sandbox, scripts/contracts, docs/VAULT_RULES.md.
- Kristian: the AI agent, baselines, replay mode, version manifests, decision-to-request adapter. Folders services/agent, docs/AGENT.md.
- Lucy: the Gym. Test invoices (public dev set and hidden assessment set), deterministic scoring, reports, suite commitments, evidence verification, threat model. Folders services/evaluator, fixtures/, evidence/, scripts/eval, docs/THREAT_MODEL.md, docs/LIMITATIONS.md.

Lucy writes the hidden test invoices and Kristian never sees them, so our scores stay honest.

## How the pieces connect

Invoice arrives at the API (Alexander). The API calls the agent (Kristian) through the AgentRunner interface and gets PAY, REVIEW, or FLAG. On PAY, Kristian's adapter builds a PaymentRequest and the API sends it through the VaultGateway (Tharun's vault-client) to the vault contract. Cap rejections and REVIEW or FLAG decisions become ReviewItems in the human queue. The Gym (Lucy) runs the same agent against fixtures using Tharun's vault-sim, scores it, and publishes a report and commitments to Tharun's evidence contract. The UI (Alexander) shows all of it.

## Schedule (UTC, all 2026)

- Nov 4: restricted-key payment works in sandbox and a forbidden call fails; 12 dev invoices exist; agent decides on dev invoices; UI runs on mock data.
- Nov 6: vertical slice, invoice to decision to vault to receipt to report.
- Nov 8: money invariants pass; assessment protocol frozen.
- Nov 9: testnet deploy with two vaults; agent candidate frozen; assessment runs.
- Nov 11: code freeze except fixes.
- Nov 12: a non-author runs the README from a fresh checkout; record demo.
- Nov 13: submission package ready.
- Nov 14: submit by 18:00 UTC (hard deadline 23:59 UTC).

## Hackathon requirements that affect code

- Public repo by the deadline with a README that has "do X, see Y" steps; Claude Code and Codex screen projects first for reproducibility.
- Demo video posted on X tagging @NEARProtocol and #NEARHackathon.
- One submission, cannot be edited. Tracks: AI Security & Defense (security) primary, plus Agent Economy (agents), plus Real-World Money (realworld) only if payments work end to end.

# LANES FOR NOW, AND WHY THEY WILL CHANGE

For the time being, stay in your lane: only edit the folders listed for you and only push to your own branch. This is temporary. The idea will evolve and get more detailed, and lanes will bleed into each other as we build, which is completely expected. When that happens Alexander (PM) will send updated prompts. Until then, if you need something outside your lane, write it under "Requests" in your status file and keep working against a local stub. Use the full context above to make good decisions, not to edit other people's folders.
