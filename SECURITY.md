# Security

Wardline moves money for AI agents, so we want to hear about problems early.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub: on this repository, open **Security**, then **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it.

We will acknowledge a report within 3 days and tell you what we plan to do about it. Please give us a reasonable time to fix it before you disclose it publicly.

## Scope

In scope: anything that lets a model call be paid without a valid proof, pays a reservation twice, gets past a member allowance or a budget's deposit, gets a look-alike or unlinked account a PAY verdict, forges or replays a receipt, signature or approval, or reads or changes another owner's data.

Out of scope: the offline demo providers in `services/demo-provider` (they are dishonest on purpose), the simulated contracts used in sim mode, and testnet funds, which have no value.

## What this repository never contains

Private keys, seed phrases and API keys live only in a local, gitignored `.env`. The keys in `apps/web/e2e/keys.ts` and the sim TEE key in `services/demo-provider` are derived from published labels on purpose; they are test keys and protect nothing.
