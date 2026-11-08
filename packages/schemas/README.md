# packages/schemas

Owner: Alexander (shared)

Shared zod schemas and TS types everyone uses. One file per concept in `src/`, each with a valid example in `examples/`.

**Schema changes go through Alexander.** If you need a change, write it under "Requests" in `docs/status/<yourname>.md` and keep working against a local stub.

## Conventions

- Amounts are integer strings in atomic units (`amount_atomic`).
- Timestamps are nanosecond integer strings (`*_ns`).
- Every schema is exported as `XSchema`, with its TS type exported as `X`.
- `pnpm --filter @wardline/schemas test` checks every example against its schema.

## Usage

```ts
import { DecisionSchema, type Decision } from "@wardline/schemas";
```
