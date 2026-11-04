# services/api

Owner: Alexander

Backend API, persistence, chain observer (Hono + better-sqlite3 + zod). Runs on http://127.0.0.1:8787.

All gateways are mocks for now. To swap one for the real implementation, change its line in `src/gateways/index.ts`.

While the gateways are mocks, state is reseeded on every start, so a restart also clears a paused vault. The API has no authentication yet and binds to localhost only; add auth before connecting a real owner key.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /overview | Agent version, policy, usage, headroom, unresolved payments |
| GET | /invoices | Invoice list |
| GET | /invoices/:id | Invoice detail |
| POST | /intake | Submit invoice text and run the full flow |
| GET | /review-queue | Open review items, soonest due first |
| POST | /review/:id/owner-pay | Owner pays the item's approved payable |
| POST | /review/:id/reject | Owner closes the item with no payment |
| GET | /evaluations | Evaluation runs |
| GET | /evaluations/:id | Report plus evidence check |
| GET | /history | Vendors, policy changes, agent events, incidents |
| POST | /vault/pause | Pause agent payments on the vault |

`better-sqlite3` is pinned to exactly 12.9.0. It is the newest npm release with prebuilt binaries for Node 20, 22, and 24. Later 12.x releases dropped Node 20 binaries, so installing them on Node 20 needs a C++ compiler.
