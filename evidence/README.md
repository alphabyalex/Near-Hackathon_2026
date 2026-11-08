# evidence

Owner: Lucy

Published evaluation evidence. Every folder with a `suite-commitment.json` is checked by
`pnpm --filter @wardline/evaluator verify:evidence`, which recomputes every digest from the files.

| Path | What |
| --- | --- |
| example-run/ | Example run on the public dev fixtures, salt revealed so anyone can verify it end to end |
| assessment/ | Hidden suite commitment (public, before the run) and assessment results |
| local/ | Your own local runs (gitignored) |

Each folder:

| File | What |
| --- | --- |
| suite-commitment.json | Salted commitment over the suite manifest (scenario hashes, counts, rubric version, harness id) |
| suite-manifest.json, suite-salt.hex | Present only once revealed (always for dev) |
| registry.stub.json | Stand-in for the evidence contract: commitments and report digests we will register on chain |
| comparison.md | All agents side by side on identical cases |
| runs/<agent>/ | report.json (EvaluationReport), report.md, digests.json, and run-record.json for dev runs |

Assessment run records stay in fixtures/private until reveal because raw agent output can quote
hidden invoice text; only their digests are public.

The example run uses local stubs (rules baseline, adapter, vault sim) and a simulated compromised
agent, not a model. See docs/LIMITATIONS.md.
