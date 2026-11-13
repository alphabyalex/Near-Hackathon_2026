# Docs

Two kinds of documentation live in this repo. Know which one you want.

## The published docs

What users and developers read, at `#/docs` in the app. They are markdown files in
[`apps/web/src/docs/content`](../apps/web/src/docs/content), grouped by [`nav.ts`](../apps/web/src/docs/nav.ts) beside them.
To change a page, edit its file. To add one, add a file and list its name in `nav.ts`; a test fails if the two disagree
or if a link points at a page or heading that doesn't exist.

| Group | Pages |
| --- | --- |
| Introduction | Introduction, How a payment is proven, Glossary |
| The Mutual | Deposit and WARD, Fees and yield, Loss coverage, Redeem and the sell wait |
| Groups | Groups and budgets, Tiers and reputation |
| Governance | Governance |
| Build | Quickstart, Proof headers and errors, Payee checks, SDK and x402 guard, MCP server, API reference |
| Security | The spending cap, Limits and risks, Contracts |

Writing rules: sentence case, no em dashes, no hype words, and never call WARD stable or guaranteed. A page opens with
one plain sentence and says what it is for. Facts come from the contracts and `llms.txt`; if a page and a contract
disagree, the contract is right and the page is the bug.

Page markup is a small subset of markdown: `##` and `###` headings, lists, tables, fenced code (consecutive fences with
`tab="Name"` become tabs), `:::note`, `:::important` and `:::limitation` callouts, and `::developer-tabs{path=ai}` or
`::contracts` for the live code panels and the contract table.

## Engineering notes

Written for the people building Wardline, kept next to the code.

| File | What it is |
| --- | --- |
| [`BRAND.md`](BRAND.md) | The Horizon brand: colour, type, components, motion and the rules about what never to do |
| [`DAO.md`](DAO.md) | Governance in the contracts: group DAOs, WARD-holder votes, tiers and the fee flow |
| [`PAYEE_SHIELD.md`](PAYEE_SHIELD.md) | The payee check: the problem, verdicts and evidence tiers |
| [`PAYEE_REGISTRY.md`](PAYEE_REGISTRY.md) | The opt-in public payee registry contract |
| [`RELEASE_GUARD.md`](RELEASE_GUARD.md) | Tying payment authority to a release of the agent |
| [`VAULT_RULES.md`](VAULT_RULES.md) | The business vault contract, in plain language |
| [`CONTEXT.md`](CONTEXT.md) | The project's context and direction |
| [`OWNERSHIP.md`](OWNERSHIP.md) | Who owns which folder |
| [`DISCLOSURES.md`](DISCLOSURES.md) | Where the code came from and what it depends on |

### The invoice-agent evaluation

An earlier line of work, an invoice-handling agent and the Gym that tests it. These describe that work, not the Mutual.

| File | What it is |
| --- | --- |
| [`AGENT.md`](AGENT.md) | The invoice agent |
| [`KRISTIAN-ROUND-2.md`](KRISTIAN-ROUND-2.md) | Live agent, the compromise demo and proof capture |
| [`REDTEAM.md`](REDTEAM.md) | The red-team benchmark of fictional payment-fraud cases |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | What the vault protects and who attacks it |
| [`LIMITATIONS.md`](LIMITATIONS.md) | What the evaluation evidence does and doesn't show |

### Working folders

- [`status/`](status): each person's running report on what they shipped, what is blocked and what they need
- [`design/`](design): the reference designs the app was built from
- [`screenshots/`](screenshots): reference screenshots of the app
- [`skills/`](skills): agent skills that ship with the repo
